// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin-contracts/token/ERC20/IERC20.sol";

import {RewardClaim} from "../src/RewardClaim.sol";

/// @notice Requires explicit authorization before running against a public network. See README.
contract Deploy is Script {
    function run() external returns (RewardClaim pool) {
        IERC20 token = IERC20(vm.envAddress("REWARD_TOKEN"));
        address rewardSigner = vm.envAddress("REWARD_SIGNER");
        address owner = vm.envAddress("REWARD_OWNER");

        vm.startBroadcast();
        pool = new RewardClaim(token, rewardSigner, owner);
        vm.stopBroadcast();

        console.log("RewardClaim deployed at", address(pool));
    }
}
