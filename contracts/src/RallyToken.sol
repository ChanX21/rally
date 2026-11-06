// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin-contracts/token/ERC20/ERC20.sol";

/// @title RallyToken
/// @notice Non-transferable reward token. It can only be earned or lost through RallyLedger, so
/// nobody can move tokens away before a penalty or sell what they earned.
contract RallyToken is ERC20 {
    /// @notice The ledger that deployed this token, and the only account that can mint or burn.
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    address public immutable ledger;

    error NonTransferable();
    error NotLedger();

    modifier onlyLedger() {
        if (msg.sender != ledger) revert NotLedger();
        _;
    }

    constructor() ERC20("Rally", "RALLY") {
        ledger = msg.sender;
    }

    /// @notice Points are whole numbers, so 10 points shows as 10 RALLY.
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function mint(address to, uint256 amount) external onlyLedger {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyLedger {
        _burn(from, amount);
    }

    function transfer(address, uint256) public pure override returns (bool) {
        revert NonTransferable();
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        revert NonTransferable();
    }

    function approve(address, uint256) public pure override returns (bool) {
        revert NonTransferable();
    }
}
