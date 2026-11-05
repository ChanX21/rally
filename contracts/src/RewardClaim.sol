// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin-contracts/access/Ownable2Step.sol";
import {ECDSA} from "@openzeppelin-contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin-contracts/utils/cryptography/EIP712.sol";
import {Pausable} from "@openzeppelin-contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin-contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";

/// @title RewardClaim
/// @notice Optional funded pool that pays out rewards earned in Rally's off-chain ledger.
/// @dev Rally works with no contract at all, and nothing here affects matching. A voucher shows
/// that the Rally backend considers an account eligible. It is not proof of physical presence.
///
/// The voucher format must match backend/src/services/reward-voucher.ts.
contract RewardClaim is EIP712, Ownable2Step, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(address account,uint256 amount,uint256 nonce,uint256 expiry)");

    /// @notice The token this pool pays out, such as USDC.
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    IERC20 public immutable token;

    /// @notice The backend key allowed to authorize claims.
    address public signer;

    /// @notice Per-user replay protection. The backend derives one fixed nonce per ledger entry.
    mapping(address account => mapping(uint256 nonce => bool used)) public usedNonces;

    event Claimed(address indexed account, uint256 indexed nonce, uint256 amount);
    event SignerUpdated(address indexed previousSigner, address indexed newSigner);
    event Withdrawn(address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error NotAccount();
    error VoucherExpired();
    error NonceAlreadyUsed();
    error InvalidSignature();

    constructor(IERC20 token_, address signer_, address owner_) EIP712("RallyRewardClaim", "1") Ownable(owner_) {
        if (address(token_) == address(0) || signer_ == address(0)) revert ZeroAddress();
        token = token_;
        signer = signer_;
        emit SignerUpdated(address(0), signer_);
    }

    /// @notice Pays a voucher to its account. Only that account can submit it, which proves the
    /// caller controls the wallet and stops anyone front-running a claim.
    function claim(uint256 amount, uint256 nonce, uint256 expiry, bytes calldata signature) external whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp > expiry) revert VoucherExpired();
        if (usedNonces[msg.sender][nonce]) revert NonceAlreadyUsed();

        // msg.sender is part of the signed data, so a voucher for anyone else fails here.
        bytes32 digest = hashClaim(msg.sender, amount, nonce, expiry);
        if (ECDSA.recover(digest, signature) != signer) revert InvalidSignature();

        usedNonces[msg.sender][nonce] = true;
        emit Claimed(msg.sender, nonce, amount);
        token.safeTransfer(msg.sender, amount);
    }

    /// @notice The EIP-712 digest. The domain binds it to this chain ID and contract.
    function hashClaim(address account, uint256 amount, uint256 nonce, uint256 expiry) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, account, amount, nonce, expiry)));
    }

    /// @notice Rotates the backend key. Unexpired vouchers from the old key stop working at once.
    function setSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        emit SignerUpdated(signer, newSigner);
        signer = newSigner;
    }

    /// @notice Recovers unclaimed funds from the pool.
    function withdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        emit Withdrawn(to, amount);
        token.safeTransfer(to, amount);
    }

    /// @notice Stops claims if the signer is compromised or abuse is detected.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
