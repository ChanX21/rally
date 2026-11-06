// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin-contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin-contracts/utils/Pausable.sol";

import {RallyLedger} from "../src/RallyLedger.sol";
import {RallyToken} from "../src/RallyToken.sol";

contract RallyLedgerTest is Test {
    RallyLedger internal ledger;
    RallyToken internal token;
    address internal admin = makeAddr("admin");
    address internal operator = makeAddr("operator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    uint256 internal nextKey = 1;

    function amounts() internal pure returns (int32[8] memory) {
        return [int32(10), 5, 25, -5, -10, -20, -15, -10];
    }

    function setUp() public {
        ledger = new RallyLedger(admin, operator, amounts());
        token = ledger.token();
    }

    function apply_(address subject, RallyLedger.Action action, int32 delta) internal {
        vm.prank(operator);
        ledger.record(subject, action, delta, 1, bytes32("ref"), bytes32("hash"), bytes32(nextKey++));
    }

    function test_TokenMetadata() public view {
        assertEq(token.name(), "Rally");
        assertEq(token.symbol(), "RALLY");
        assertEq(token.decimals(), 0);
        assertEq(token.ledger(), address(ledger));
    }

    function test_RevertWhen_TransferringTokens() public {
        apply_(alice, RallyLedger.Action.OnTime, 10);
        vm.startPrank(alice);
        vm.expectRevert(RallyToken.NonTransferable.selector);
        token.transfer(bob, 1);
        vm.expectRevert(RallyToken.NonTransferable.selector);
        token.approve(bob, 1);
        vm.expectRevert(RallyToken.NonTransferable.selector);
        token.transferFrom(alice, bob, 1);
        vm.stopPrank();
    }

    function test_RevertWhen_AnyoneElseMintsOrBurns() public {
        vm.expectRevert(RallyToken.NotLedger.selector);
        token.mint(alice, 1);
        vm.expectRevert(RallyToken.NotLedger.selector);
        token.burn(alice, 1);
    }

    function test_EarningMints() public {
        apply_(alice, RallyLedger.Action.Vouched, 25);
        assertEq(token.balanceOf(alice), 25);
        assertEq(ledger.netOf(alice), 25);
        assertEq(ledger.actionCounts(alice, RallyLedger.Action.Vouched), 1);
    }

    function test_PenaltyBurnsThenAddsDebt() public {
        apply_(alice, RallyLedger.Action.OnTime, 10);
        apply_(alice, RallyLedger.Action.NoShow, -20);
        assertEq(token.balanceOf(alice), 0);
        assertEq(ledger.debt(alice), 10);
        assertEq(ledger.netOf(alice), -10);
    }

    function test_PenaltyWithNoBalanceIsAllDebt() public {
        apply_(alice, RallyLedger.Action.NoShow, -20);
        assertEq(ledger.netOf(alice), -20);
        assertEq(token.totalSupply(), 0);
    }

    function test_EarningRepaysDebtBeforeMinting() public {
        apply_(alice, RallyLedger.Action.NoShow, -20);
        apply_(alice, RallyLedger.Action.OnTime, 10);
        assertEq(token.balanceOf(alice), 0);
        assertEq(ledger.debt(alice), 10);
        apply_(alice, RallyLedger.Action.Vouched, 25);
        assertEq(token.balanceOf(alice), 15);
        assertEq(ledger.debt(alice), 0);
    }

    function test_UsedKeyIsANoOp() public {
        vm.startPrank(operator);
        ledger.record(alice, RallyLedger.Action.OnTime, 10, 1, bytes32(0), bytes32(0), bytes32("k"));
        ledger.record(alice, RallyLedger.Action.OnTime, 10, 1, bytes32(0), bytes32(0), bytes32("k"));
        vm.stopPrank();
        assertEq(token.balanceOf(alice), 10);
        assertEq(ledger.actionCounts(alice, RallyLedger.Action.OnTime), 1);
    }

    function test_RevertWhen_DeltaDoesNotMatchPolicy() public {
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(RallyLedger.DeltaMismatch.selector, int32(10), int32(99)));
        ledger.record(alice, RallyLedger.Action.OnTime, 99, 1, bytes32(0), bytes32(0), bytes32("k"));
    }

    function test_RevertWhen_PolicyUnknown() public {
        vm.startPrank(operator);
        vm.expectRevert(abi.encodeWithSelector(RallyLedger.UnknownPolicy.selector, uint32(2)));
        ledger.record(alice, RallyLedger.Action.OnTime, 10, 2, bytes32(0), bytes32(0), bytes32("k"));
        vm.expectRevert(abi.encodeWithSelector(RallyLedger.UnknownPolicy.selector, uint32(0)));
        ledger.record(alice, RallyLedger.Action.OnTime, 10, 0, bytes32(0), bytes32(0), bytes32("k"));
        vm.stopPrank();
    }

    function test_RevertWhen_SubjectIsZero() public {
        vm.prank(operator);
        vm.expectRevert(RallyLedger.ZeroAddress.selector);
        ledger.record(address(0), RallyLedger.Action.OnTime, 10, 1, bytes32(0), bytes32(0), bytes32("k"));
    }

    function test_NewPolicyKeepsOldVersionsValid() public {
        int32[8] memory next = amounts();
        next[0] = 15;
        vm.startPrank(operator);
        ledger.publishPolicy(2, next);
        ledger.record(alice, RallyLedger.Action.OnTime, 15, 2, bytes32(0), bytes32(0), bytes32("a"));
        // A retry written under the earlier version still applies at that version's amount.
        ledger.record(alice, RallyLedger.Action.OnTime, 10, 1, bytes32(0), bytes32(0), bytes32("b"));
        vm.stopPrank();
        assertEq(token.balanceOf(alice), 25);
        assertEq(ledger.latestPolicy(), 2);
        assertEq(ledger.policy(1)[0], 10);
        assertEq(ledger.policy(2)[0], 15);
    }

    function test_RevertWhen_PolicyVersionSkipsOrRepeats() public {
        vm.startPrank(operator);
        vm.expectRevert(abi.encodeWithSelector(RallyLedger.WrongPolicyVersion.selector, uint32(2), uint32(3)));
        ledger.publishPolicy(3, amounts());
        vm.expectRevert(abi.encodeWithSelector(RallyLedger.WrongPolicyVersion.selector, uint32(2), uint32(1)));
        ledger.publishPolicy(1, amounts());
        vm.stopPrank();
    }

    function test_RevertWhen_PolicyOutOfRange() public {
        int32[8] memory tooHigh = amounts();
        tooHigh[0] = 101;
        int32[8] memory earningNegative = amounts();
        earningNegative[1] = -1;
        int32[8] memory penaltyPositive = amounts();
        penaltyPositive[5] = 1;
        int32[8] memory penaltyTooBig = amounts();
        penaltyTooBig[7] = -101;

        vm.startPrank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(RallyLedger.AmountOutOfRange.selector, RallyLedger.Action.OnTime, int32(101))
        );
        ledger.publishPolicy(2, tooHigh);
        vm.expectRevert(
            abi.encodeWithSelector(RallyLedger.AmountOutOfRange.selector, RallyLedger.Action.HostCompleted, int32(-1))
        );
        ledger.publishPolicy(2, earningNegative);
        vm.expectRevert(
            abi.encodeWithSelector(RallyLedger.AmountOutOfRange.selector, RallyLedger.Action.NoShow, int32(1))
        );
        ledger.publishPolicy(2, penaltyPositive);
        vm.expectRevert(
            abi.encodeWithSelector(RallyLedger.AmountOutOfRange.selector, RallyLedger.Action.FalseComplaint, int32(-101))
        );
        ledger.publishPolicy(2, penaltyTooBig);
        vm.stopPrank();
    }

    function test_ComplaintCounts() public {
        vm.startPrank(operator);
        ledger.recordRuling(
            bytes32("d1"), alice, bob, RallyLedger.Category.Misconduct, RallyLedger.Outcome.Upheld, bytes32(0), bytes32("r1")
        );
        ledger.recordRuling(
            bytes32("d2"), alice, bob, RallyLedger.Category.Other, RallyLedger.Outcome.Dismissed, bytes32(0), bytes32("r2")
        );
        vm.stopPrank();
        assertEq(ledger.disputesRaised(bob), 2);
        assertEq(ledger.disputesAgainst(alice), 2);
        assertEq(ledger.upheldAgainst(alice), 1);
    }

    function test_AppealIsNotACountAgainstThePerson() public {
        vm.prank(operator);
        ledger.recordRuling(
            bytes32("d"), alice, alice, RallyLedger.Category.NoShowAppeal, RallyLedger.Outcome.Upheld, bytes32(0), bytes32("r")
        );
        assertEq(ledger.disputesRaised(alice), 1);
        assertEq(ledger.disputesAgainst(alice), 0);
        assertEq(ledger.upheldAgainst(alice), 0);
    }

    function test_RulingKeyIsANoOpOnRetry() public {
        vm.startPrank(operator);
        ledger.recordRuling(
            bytes32("d"), alice, bob, RallyLedger.Category.Other, RallyLedger.Outcome.Upheld, bytes32(0), bytes32("r")
        );
        ledger.recordRuling(
            bytes32("d"), alice, bob, RallyLedger.Category.Other, RallyLedger.Outcome.Upheld, bytes32(0), bytes32("r")
        );
        vm.stopPrank();
        assertEq(ledger.disputesRaised(bob), 1);
    }

    function test_RolesAreSplitBetweenAdminAndOperator() public view {
        assertTrue(ledger.hasRole(ledger.DEFAULT_ADMIN_ROLE(), admin));
        assertFalse(ledger.hasRole(ledger.DEFAULT_ADMIN_ROLE(), operator));
        assertFalse(ledger.hasRole(ledger.WRITER_ROLE(), admin));
        assertTrue(ledger.hasRole(ledger.WRITER_ROLE(), operator));
        assertTrue(ledger.hasRole(ledger.POLICY_ROLE(), operator));
        assertTrue(ledger.hasRole(ledger.RESOLVER_ROLE(), operator));
    }

    function test_RevertWhen_NotAuthorised() public {
        bytes32 writer = ledger.WRITER_ROLE();
        bytes32 resolver = ledger.RESOLVER_ROLE();
        bytes32 policyRole = ledger.POLICY_ROLE();
        bytes32 adminRole = ledger.DEFAULT_ADMIN_ROLE();
        vm.startPrank(bob);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, writer));
        ledger.record(alice, RallyLedger.Action.OnTime, 10, 1, bytes32(0), bytes32(0), bytes32("k"));
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, resolver));
        ledger.recordRuling(
            bytes32("d"), alice, bob, RallyLedger.Category.Other, RallyLedger.Outcome.Upheld, bytes32(0), bytes32("r")
        );
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, policyRole));
        ledger.publishPolicy(2, amounts());
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, adminRole));
        ledger.pause();
        vm.stopPrank();
    }

    function test_AdminCanRevokeALeakedOperator() public {
        bytes32 writer = ledger.WRITER_ROLE();
        vm.prank(admin);
        ledger.revokeRole(writer, operator);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, operator, writer));
        ledger.record(alice, RallyLedger.Action.OnTime, 10, 1, bytes32(0), bytes32(0), bytes32("k"));
    }

    function test_PauseStopsWrites() public {
        vm.prank(admin);
        ledger.pause();
        vm.prank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        ledger.record(alice, RallyLedger.Action.OnTime, 10, 1, bytes32(0), bytes32(0), bytes32("k"));
        vm.prank(admin);
        ledger.unpause();
        apply_(alice, RallyLedger.Action.OnTime, 10);
        assertEq(token.balanceOf(alice), 10);
    }

    function test_RevertWhen_ConstructorGetsZeroAddress() public {
        vm.expectRevert(RallyLedger.ZeroAddress.selector);
        new RallyLedger(address(0), operator, amounts());
        vm.expectRevert(RallyLedger.ZeroAddress.selector);
        new RallyLedger(admin, address(0), amounts());
    }

    /// Whatever the order, net always equals the sum of changes, and balance and debt never overlap.
    function testFuzz_NetEqualsSumOfDeltas(uint8[32] calldata picks) public {
        int32[8] memory table = amounts();
        int256 expected;
        for (uint256 i = 0; i < picks.length; i++) {
            uint256 index = picks[i] % 8;
            apply_(alice, RallyLedger.Action(index), table[index]);
            expected += table[index];
            assertEq(ledger.netOf(alice), expected);
            assertTrue(token.balanceOf(alice) == 0 || ledger.debt(alice) == 0);
        }
        assertEq(token.totalSupply(), token.balanceOf(alice));
    }
}
