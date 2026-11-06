// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";

import {RallyLedger} from "../src/RallyLedger.sol";

/// @notice Deploys RallyLedger, which deploys RallyToken, with policy version 1.
/// @dev Set RALLY_ADMIN (holds DEFAULT_ADMIN_ROLE) and RALLY_OPERATOR (the backend relayer).
contract DeployLedger is Script {
    function run() external returns (RallyLedger ledger) {
        address admin = vm.envAddress("RALLY_ADMIN");
        address operator = vm.envAddress("RALLY_OPERATOR");

        // OnTime, HostCompleted, Vouched, Late, LateCancel, NoShow, ComplaintUpheld, FalseComplaint, RallyCompleted.
        // Must match DEFAULT_AMOUNTS in backend/src/domain/reward-policy.ts.
        int32[9] memory amounts = [int32(10), 5, 25, -5, -10, -20, -15, -10, 10];

        vm.startBroadcast();
        ledger = new RallyLedger(admin, operator, amounts);
        vm.stopBroadcast();

        console.log("RallyLedger deployed at", address(ledger));
        console.log("RallyToken deployed at", address(ledger.token()));
    }
}
