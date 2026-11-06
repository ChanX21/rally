// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin-contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin-contracts/utils/Pausable.sol";

import {RallyToken} from "./RallyToken.sol";

/// @title RallyLedger
/// @notice Public history of Rally points and dispute rulings. Every point change must match a
/// published policy version, so admin changes cannot quietly rewrite what earlier records mean.
/// @dev Rally's database is the source of truth and this contract mirrors it. Nothing here affects
/// matching. Only addresses, codes and hashes belong on-chain: never names, text or locations.
contract RallyLedger is AccessControl, Pausable {
    /// @dev The order is part of the backend's interface. See backend/src/domain/reward-policy.ts.
    enum Action {
        OnTime,
        HostCompleted,
        Vouched,
        Late,
        LateCancel,
        NoShow,
        ComplaintUpheld,
        FalseComplaint,
        RallyCompleted
    }

    enum Category {
        NoShowAppeal,
        Misconduct,
        FalseCheckin,
        Other
    }

    enum Outcome {
        Upheld,
        Dismissed,
        False
    }

    uint256 public constant ACTION_COUNT = 9;
    /// @notice No single action can move a balance further than this, whatever the admin publishes.
    int32 public constant MAX_AMOUNT = 100;

    bytes32 public constant POLICY_ROLE = keccak256("POLICY_ROLE");
    bytes32 public constant WRITER_ROLE = keccak256("WRITER_ROLE");
    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");

    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    RallyToken public immutable token;

    uint32 public latestPolicy;
    mapping(uint32 version => int32[ACTION_COUNT] amounts) private _policies;

    /// @notice Penalties that exceeded the balance. Earnings repay this before minting.
    mapping(address subject => uint256 owed) public debt;
    mapping(address subject => mapping(Action action => uint256 total)) public actionCounts;
    mapping(address subject => uint256 total) public disputesAgainst;
    mapping(address subject => uint256 total) public upheldAgainst;
    mapping(address raiser => uint256 total) public disputesRaised;
    /// @notice Retries with a used key do nothing, so a retried transaction cannot double-mint.
    mapping(bytes32 key => bool used) public usedKeys;

    event PolicyPublished(uint32 indexed version, int32[ACTION_COUNT] amounts);
    event Recorded(
        address indexed subject,
        Action indexed action,
        int32 delta,
        uint32 policyVersion,
        bytes32 ref,
        bytes32 evidenceHash,
        bytes32 key
    );
    event Ruling(
        address indexed subject,
        address indexed raiser,
        bytes32 indexed disputeRef,
        Category category,
        Outcome outcome,
        bytes32 evidenceHash
    );

    error ZeroAddress();
    error WrongPolicyVersion(uint32 expected, uint32 given);
    error AmountOutOfRange(Action action, int32 amount);
    error UnknownPolicy(uint32 version);
    error DeltaMismatch(int32 expected, int32 given);

    constructor(address admin, address operator, int32[ACTION_COUNT] memory initialAmounts) {
        if (admin == address(0) || operator == address(0)) revert ZeroAddress();
        token = new RallyToken();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(POLICY_ROLE, operator);
        _grantRole(WRITER_ROLE, operator);
        _grantRole(RESOLVER_ROLE, operator);
        _publish(1, initialAmounts);
    }

    /// @notice Publishes the next policy. Published versions never change.
    function publishPolicy(uint32 version, int32[ACTION_COUNT] calldata amounts) external onlyRole(POLICY_ROLE) {
        _publish(version, amounts);
    }

    function policy(uint32 version) external view returns (int32[ACTION_COUNT] memory) {
        return _policies[version];
    }

    /// @notice Balance minus debt. This is the number the app shows, and it can be negative.
    function netOf(address subject) external view returns (int256) {
        return int256(token.balanceOf(subject)) - int256(debt[subject]);
    }

    /// @notice Applies one point change.
    /// @param ref Per-person reference, so two people's records do not show they met.
    /// @param key Unique per change. A key that was already used makes this a no-op.
    function record(
        address subject,
        Action action,
        int32 delta,
        uint32 policyVersion,
        bytes32 ref,
        bytes32 evidenceHash,
        bytes32 key
    ) external onlyRole(WRITER_ROLE) whenNotPaused {
        if (subject == address(0)) revert ZeroAddress();
        if (usedKeys[key]) return;
        if (policyVersion == 0 || policyVersion > latestPolicy) revert UnknownPolicy(policyVersion);
        int32 expected = _policies[policyVersion][uint256(action)];
        if (delta != expected) revert DeltaMismatch(expected, delta);

        usedKeys[key] = true;
        actionCounts[subject][action] += 1;
        emit Recorded(subject, action, delta, policyVersion, ref, evidenceHash, key);

        if (delta >= 0) _earn(subject, uint256(int256(delta)));
        else _penalise(subject, uint256(-int256(delta)));
    }

    /// @notice Records a ruling on a dispute. Any points follow as separate `record` calls.
    function recordRuling(
        bytes32 disputeRef,
        address subject,
        address raiser,
        Category category,
        Outcome outcome,
        bytes32 evidenceHash,
        bytes32 key
    ) external onlyRole(RESOLVER_ROLE) whenNotPaused {
        if (subject == address(0) || raiser == address(0)) revert ZeroAddress();
        if (usedKeys[key]) return;

        usedKeys[key] = true;
        disputesRaised[raiser] += 1;
        // An appeal is the person's own case, so it does not count as a complaint against them.
        if (category != Category.NoShowAppeal) {
            disputesAgainst[subject] += 1;
            if (outcome == Outcome.Upheld) upheldAgainst[subject] += 1;
        }
        emit Ruling(subject, raiser, disputeRef, category, outcome, evidenceHash);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function _publish(uint32 version, int32[ACTION_COUNT] memory amounts) private {
        if (version != latestPolicy + 1) revert WrongPolicyVersion(latestPolicy + 1, version);
        for (uint256 i = 0; i < ACTION_COUNT; i++) {
            int32 amount = amounts[i];
            // The original three earning actions and the appended completion action earn.
            bool valid = (i <= uint256(Action.Vouched) || i == uint256(Action.RallyCompleted))
                ? amount >= 0 && amount <= MAX_AMOUNT
                : amount <= 0 && amount >= -MAX_AMOUNT;
            if (!valid) revert AmountOutOfRange(Action(i), amount);
        }
        latestPolicy = version;
        _policies[version] = amounts;
        emit PolicyPublished(version, amounts);
    }

    function _earn(address subject, uint256 amount) private {
        uint256 owed = debt[subject];
        uint256 repaid = amount < owed ? amount : owed;
        if (repaid > 0) debt[subject] = owed - repaid;
        if (amount > repaid) token.mint(subject, amount - repaid);
    }

    function _penalise(address subject, uint256 amount) private {
        uint256 balance = token.balanceOf(subject);
        uint256 burned = amount < balance ? amount : balance;
        if (burned > 0) token.burn(subject, burned);
        if (amount > burned) debt[subject] += amount - burned;
    }
}
