// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ReservedToken} from "./ReservedToken.sol";

/// @title ReservedVault
/// @notice Holds the reserve of tokenized stocks (bStocks, plain BEP-20 tokens) backing
/// RSVD. Holders redeem RSVD for a pro-rata share of every reserve asset the vault holds
/// by burning it here. The keeper bot deposits bStocks it has acquired via depositAsset.
contract ReservedVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    ReservedToken public immutable rsvd;

    /// @notice Operational bot address allowed to deposit acquired bStocks and register new ones.
    address public keeper;

    address[] public reserveAssets;
    mapping(address => bool) public isReserveAsset;

    event KeeperUpdated(address indexed previousKeeper, address indexed newKeeper);
    event ReserveAssetAdded(address indexed token);
    event AssetDeposited(address indexed token, address indexed from, uint256 amount);
    event Redeemed(address indexed account, uint256 rsvdBurned, uint256 supplyBeforeBurn);

    error ZeroAddress();
    error ZeroAmount();
    error NotKeeper();
    error NothingToRedeem();

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    constructor(address rsvd_, address initialOwner_, address keeper_) Ownable(initialOwner_) {
        if (rsvd_ == address(0) || keeper_ == address(0)) revert ZeroAddress();
        rsvd = ReservedToken(rsvd_);
        keeper = keeper_;
        emit KeeperUpdated(address(0), keeper_);
    }

    function setKeeper(address newKeeper) external onlyOwner {
        if (newKeeper == address(0)) revert ZeroAddress();
        emit KeeperUpdated(keeper, newKeeper);
        keeper = newKeeper;
    }

    /// @notice Register a bStock as a tracked reserve asset without depositing (e.g. to
    /// show it in the reserve list ahead of the first buy). Safe to call repeatedly.
    function registerReserveAsset(address token) public onlyKeeper {
        if (token == address(0)) revert ZeroAddress();
        if (!isReserveAsset[token]) {
            isReserveAsset[token] = true;
            reserveAssets.push(token);
            emit ReserveAssetAdded(token);
        }
    }

    /// @notice Keeper deposits bStocks it has acquired into the vault, registering the
    /// asset on first deposit. Caller must have approved this contract beforehand.
    function depositAsset(address token, uint256 amount) external onlyKeeper nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        registerReserveAsset(token);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit AssetDeposited(token, msg.sender, amount);
    }

    /// @notice Number of distinct reserve assets currently tracked.
    function reserveAssetCount() external view returns (uint256) {
        return reserveAssets.length;
    }

    /// @notice Full list of tracked reserve assets and the vault's current balance of each.
    function getReserveBalances() external view returns (address[] memory tokens, uint256[] memory balances) {
        uint256 len = reserveAssets.length;
        tokens = new address[](len);
        balances = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            tokens[i] = reserveAssets[i];
            balances[i] = IERC20(reserveAssets[i]).balanceOf(address(this));
        }
    }

    /// @notice Preview the reserve-asset payout for redeeming `rsvdAmount`, without redeeming.
    function previewRedeem(uint256 rsvdAmount) public view returns (address[] memory tokens, uint256[] memory amounts) {
        uint256 supply = rsvd.totalSupply();
        uint256 len = reserveAssets.length;
        tokens = new address[](len);
        amounts = new uint256[](len);
        if (supply == 0) return (tokens, amounts);
        for (uint256 i = 0; i < len; i++) {
            address token = reserveAssets[i];
            tokens[i] = token;
            uint256 bal = IERC20(token).balanceOf(address(this));
            amounts[i] = (bal * rsvdAmount) / supply;
        }
    }

    /// @notice Burn `rsvdAmount` of the caller's RSVD for a pro-rata share of every
    /// reserve asset the vault holds, computed against total supply before the burn.
    /// Caller must have approved this contract to burn on their behalf
    /// (ReservedToken.approve(vault, rsvdAmount)).
    function redeem(uint256 rsvdAmount) external nonReentrant {
        if (rsvdAmount == 0) revert ZeroAmount();

        uint256 supplyBeforeBurn = rsvd.totalSupply();
        (address[] memory tokens, uint256[] memory amounts) = previewRedeem(rsvdAmount);

        bool anyPayout = false;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] > 0) {
                anyPayout = true;
                break;
            }
        }
        if (!anyPayout) revert NothingToRedeem();

        // Effects before interactions: burn first, then pay out.
        rsvd.burnFrom(msg.sender, rsvdAmount);

        for (uint256 i = 0; i < tokens.length; i++) {
            if (amounts[i] > 0) {
                IERC20(tokens[i]).safeTransfer(msg.sender, amounts[i]);
            }
        }

        emit Redeemed(msg.sender, rsvdAmount, supplyBeforeBurn);
    }
}
