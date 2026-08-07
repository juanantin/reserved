// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Like MockERC20, but with a settable decimals() — used to test
/// TreasuryConverter's _requireEighteenDecimals assertions against a non-18-decimal
/// token (e.g. simulating a USDT-like 6-decimal stablecoin). Not deployed to any live
/// network.
contract MockERC20CustomDecimals is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
