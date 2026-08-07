// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Minimal WBNB stand-in — mints 1:1 on deposit(), burns on withdraw(), same shape
/// as the real canonical WBNB. Exists so the stranded-funds recovery path documented in
/// TreasuryConverterV2's header can be exercised as a real test rather than trusted as a
/// comment: that path is the reason the migration hatch was removed, so it needs to
/// actually work. Never deployed to a live network.
contract MockWBNB is ERC20 {
    constructor() ERC20("Wrapped BNB", "WBNB") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "MockWBNB: withdraw failed");
    }
}
