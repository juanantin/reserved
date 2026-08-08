// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A "reserve asset" that always reverts on transfer — standing in for a
/// blacklisting stablecoin, a paused token, or any other broken/malicious asset a
/// compromised keeper might register. Used only to test that ReservedVault.redeem()
/// degrades gracefully instead of bricking on a single bad asset. Never deployed to a
/// real network.
contract MockRevertingERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transfer(address, uint256) public pure override returns (bool) {
        revert("MockRevertingERC20: transfers disabled");
    }
}
