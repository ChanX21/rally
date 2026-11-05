// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin-contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin-contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin-contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin-contracts/utils/Pausable.sol";

import {RewardClaim} from "../src/RewardClaim.sol";

contract MockUSDC is ERC20("Mock USDC", "mUSDC") {
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract RewardClaimTest is Test {
    uint256 internal constant SIGNER_KEY = 0xA11CE;
    uint256 internal constant POOL_FUNDS = 1_000_000e6;

    MockUSDC internal usdc;
    RewardClaim internal pool;
    address internal signerAddress;
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal mallory = makeAddr("mallory");

    uint256 internal amount = 250_000;
    uint256 internal nonce = 42;
    uint256 internal expiry;

    event Claimed(address indexed account, uint256 indexed nonce, uint256 amount);
    event SignerUpdated(address indexed previousSigner, address indexed newSigner);
    event Withdrawn(address indexed to, uint256 amount);

    function setUp() public {
        signerAddress = vm.addr(SIGNER_KEY);
        usdc = new MockUSDC();
        pool = new RewardClaim(usdc, signerAddress, owner);
        usdc.mint(address(pool), POOL_FUNDS);
        expiry = block.timestamp + 1 hours;
    }

    function _sign(uint256 key, RewardClaim target, address account, uint256 amount_, uint256 nonce_, uint256 expiry_)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, target.hashClaim(account, amount_, nonce_, expiry_));
        return abi.encodePacked(r, s, v);
    }

    function _voucher() internal view returns (bytes memory) {
        return _sign(SIGNER_KEY, pool, alice, amount, nonce, expiry);
    }

    function test_ClaimPaysAccountOnce() public {
        bytes memory voucher = _voucher();
        vm.expectEmit(address(pool));
        emit Claimed(alice, nonce, amount);

        vm.prank(alice);
        pool.claim(amount, nonce, expiry, voucher);

        assertEq(usdc.balanceOf(alice), amount);
        assertEq(usdc.balanceOf(address(pool)), POOL_FUNDS - amount);
        assertTrue(pool.usedNonces(alice, nonce));
    }

    function test_RevertWhen_Replayed() public {
        bytes memory voucher = _voucher();
        vm.startPrank(alice);
        pool.claim(amount, nonce, expiry, voucher);
        vm.expectRevert(RewardClaim.NonceAlreadyUsed.selector);
        pool.claim(amount, nonce, expiry, voucher);
        vm.stopPrank();
    }

    /// @dev This is how the backend replaces a lapsed voucher: same nonce, later expiry.
    function test_RevertWhen_ReissuedVoucherReusesClaimedNonce() public {
        bytes memory voucher = _voucher();
        vm.prank(alice);
        pool.claim(amount, nonce, expiry, voucher);

        uint256 laterExpiry = expiry + 1 days;
        bytes memory replacement = _sign(SIGNER_KEY, pool, alice, amount, nonce, laterExpiry);
        vm.prank(alice);
        vm.expectRevert(RewardClaim.NonceAlreadyUsed.selector);
        pool.claim(amount, nonce, laterExpiry, replacement);
    }

    function test_NoncesAreIndependentPerUser() public {
        address bob = makeAddr("bob");
        bytes memory voucher = _voucher();
        vm.prank(alice);
        pool.claim(amount, nonce, expiry, voucher);

        bytes memory bobVoucher = _sign(SIGNER_KEY, pool, bob, amount, nonce, expiry);
        vm.prank(bob);
        pool.claim(amount, nonce, expiry, bobVoucher);
        assertEq(usdc.balanceOf(bob), amount);
    }

    function test_RevertWhen_Expired() public {
        bytes memory voucher = _voucher();
        vm.warp(expiry + 1);
        vm.prank(alice);
        vm.expectRevert(RewardClaim.VoucherExpired.selector);
        pool.claim(amount, nonce, expiry, voucher);
    }

    function test_ClaimAtExactExpirySucceeds() public {
        bytes memory voucher = _voucher();
        vm.warp(expiry);
        vm.prank(alice);
        pool.claim(amount, nonce, expiry, voucher);
        assertEq(usdc.balanceOf(alice), amount);
    }

    function test_RevertWhen_SubmittedBySomeoneElse() public {
        bytes memory voucher = _voucher();
        vm.prank(mallory);
        vm.expectRevert(RewardClaim.InvalidSignature.selector);
        pool.claim(amount, nonce, expiry, voucher);
        assertEq(usdc.balanceOf(mallory), 0);
    }

    function test_RevertWhen_SignedByUnauthorizedKey() public {
        bytes memory forged = _sign(0xBAD, pool, alice, amount, nonce, expiry);
        vm.prank(alice);
        vm.expectRevert(RewardClaim.InvalidSignature.selector);
        pool.claim(amount, nonce, expiry, forged);
    }

    function test_RevertWhen_ParametersTampered() public {
        bytes memory voucher = _voucher();
        vm.startPrank(alice);

        vm.expectRevert(RewardClaim.InvalidSignature.selector);
        pool.claim(amount + 1, nonce, expiry, voucher);

        vm.expectRevert(RewardClaim.InvalidSignature.selector);
        pool.claim(amount, nonce + 1, expiry, voucher);

        vm.expectRevert(RewardClaim.InvalidSignature.selector);
        pool.claim(amount, nonce, expiry + 1, voucher);
        vm.stopPrank();
    }

    function test_RevertWhen_SignatureMalformed() public {
        vm.prank(alice);
        vm.expectRevert();
        pool.claim(amount, nonce, expiry, hex"1234");
    }

    function test_RevertWhen_ZeroAmount() public {
        bytes memory voucher = _sign(SIGNER_KEY, pool, alice, 0, nonce, expiry);
        vm.prank(alice);
        vm.expectRevert(RewardClaim.ZeroAmount.selector);
        pool.claim(0, nonce, expiry, voucher);
    }

    function test_RevertWhen_PoolUnderfunded() public {
        bytes memory voucher = _sign(SIGNER_KEY, pool, alice, POOL_FUNDS + 1, nonce, expiry);
        vm.prank(alice);
        vm.expectRevert();
        pool.claim(POOL_FUNDS + 1, nonce, expiry, voucher);
        assertFalse(pool.usedNonces(alice, nonce));
    }

    function test_RevertWhen_UsedOnAnotherChain() public {
        bytes memory voucher = _voucher();
        vm.chainId(block.chainid + 1);
        vm.prank(alice);
        vm.expectRevert(RewardClaim.InvalidSignature.selector);
        pool.claim(amount, nonce, expiry, voucher);
    }

    function test_RevertWhen_UsedOnAnotherContract() public {
        RewardClaim otherPool = new RewardClaim(usdc, signerAddress, owner);
        usdc.mint(address(otherPool), POOL_FUNDS);
        bytes memory voucher = _voucher();
        vm.prank(alice);
        vm.expectRevert(RewardClaim.InvalidSignature.selector);
        otherPool.claim(amount, nonce, expiry, voucher);
    }

    function test_SignerRotationInvalidatesOldVouchers() public {
        uint256 newKey = 0xB0B;
        bytes memory oldVoucher = _voucher();

        vm.expectEmit(address(pool));
        emit SignerUpdated(signerAddress, vm.addr(newKey));
        vm.prank(owner);
        pool.setSigner(vm.addr(newKey));

        bytes memory newVoucher = _sign(newKey, pool, alice, amount, nonce, expiry);
        vm.startPrank(alice);
        vm.expectRevert(RewardClaim.InvalidSignature.selector);
        pool.claim(amount, nonce, expiry, oldVoucher);

        pool.claim(amount, nonce, expiry, newVoucher);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), amount);
    }

    function test_PauseStopsClaims() public {
        bytes memory voucher = _voucher();
        vm.prank(owner);
        pool.pause();

        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.claim(amount, nonce, expiry, voucher);

        vm.prank(owner);
        pool.unpause();
        vm.prank(alice);
        pool.claim(amount, nonce, expiry, voucher);
        assertEq(usdc.balanceOf(alice), amount);
    }

    function test_OwnerCanWithdraw() public {
        vm.expectEmit(address(pool));
        emit Withdrawn(owner, 100);
        vm.prank(owner);
        pool.withdraw(owner, 100);
        assertEq(usdc.balanceOf(owner), 100);
    }

    function test_RevertWhen_NonOwnerUsesAdminFunctions() public {
        bytes memory unauthorized = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory);
        vm.startPrank(mallory);
        vm.expectRevert(unauthorized);
        pool.setSigner(mallory);
        vm.expectRevert(unauthorized);
        pool.withdraw(mallory, 1);
        vm.expectRevert(unauthorized);
        pool.pause();
        vm.expectRevert(unauthorized);
        pool.unpause();
        vm.stopPrank();
    }

    function test_OwnershipTransferNeedsAcceptance() public {
        vm.prank(owner);
        pool.transferOwnership(alice);
        assertEq(pool.owner(), owner);
        vm.prank(alice);
        pool.acceptOwnership();
        assertEq(pool.owner(), alice);
    }

    function test_RevertWhen_ZeroAddresses() public {
        vm.expectRevert(RewardClaim.ZeroAddress.selector);
        new RewardClaim(IERC20(address(0)), signerAddress, owner);
        vm.expectRevert(RewardClaim.ZeroAddress.selector);
        new RewardClaim(usdc, address(0), owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new RewardClaim(usdc, signerAddress, address(0));

        vm.startPrank(owner);
        vm.expectRevert(RewardClaim.ZeroAddress.selector);
        pool.setSigner(address(0));
        vm.expectRevert(RewardClaim.ZeroAddress.selector);
        pool.withdraw(address(0), 1);
        vm.stopPrank();
    }

    /// @dev Fixture produced by backend/test/voucher.test.ts using viem. If the backend's EIP-712
    /// format drifts from this contract, this test fails.
    function test_AcceptsSignatureProducedByBackend() public {
        uint256 backendKey = uint256(0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1);
        address fixtureContract = address(0xC0C0c0c0C0C0c0c0c0C0c0C0C0C0C0C0C0C0c0c0);
        address fixtureAccount = address(0xB0B0b0B0B0B0B0b0B0B0B0b0b0b0b0B0b0b0B0B0);
        uint256 fixtureAmount = 250_000;
        uint256 fixtureNonce = 51993934641445269897782990687260543171695112700611433784806210735058160486557;
        uint256 fixtureExpiry = 4102444800;
        bytes memory signature =
            hex"726f37cbf189c297c4632017da3f52e11aeece0e3ddaaa5e0daeb70b6a8ac7a74e768832fa650efab2853a339eb3581f6e6f38a52282dd573f04cb36f8874ecd1b";

        vm.chainId(1337);
        deployCodeTo("RewardClaim.sol:RewardClaim", abi.encode(usdc, vm.addr(backendKey), owner), fixtureContract);
        usdc.mint(fixtureContract, fixtureAmount);

        vm.prank(fixtureAccount);
        RewardClaim(fixtureContract).claim(fixtureAmount, fixtureNonce, fixtureExpiry, signature);
        assertEq(usdc.balanceOf(fixtureAccount), fixtureAmount);
    }

    function testFuzz_ClaimPaysExactAmount(uint96 fuzzAmount, uint256 fuzzNonce, uint32 ttl) public {
        vm.assume(fuzzAmount > 0 && fuzzAmount <= POOL_FUNDS);
        uint256 fuzzExpiry = block.timestamp + ttl;
        bytes memory voucher = _sign(SIGNER_KEY, pool, alice, fuzzAmount, fuzzNonce, fuzzExpiry);
        vm.prank(alice);
        pool.claim(fuzzAmount, fuzzNonce, fuzzExpiry, voucher);
        assertEq(usdc.balanceOf(alice), fuzzAmount);
    }

    function testFuzz_RevertWhen_WrongCaller(address caller) public {
        vm.assume(caller != alice);
        bytes memory voucher = _voucher();
        vm.prank(caller);
        vm.expectRevert(RewardClaim.InvalidSignature.selector);
        pool.claim(amount, nonce, expiry, voucher);
    }
}
