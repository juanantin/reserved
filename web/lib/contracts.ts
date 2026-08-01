import { ethers } from "ethers";
import { tokenInfo } from "@/config/token";

// BNB Chain mainnet, hex chain id as MetaMask/EIP-1193 wallets expect it.
export const BSC_CHAIN_ID_HEX = "0x38"; // 56
export const BSC_CHAIN_PARAMS = {
  chainId: BSC_CHAIN_ID_HEX,
  chainName: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: ["https://bsc-dataseed.bnbchain.org"],
  blockExplorerUrls: ["https://bscscan.com"],
};

// Public read-only RPC — no key needed, safe to call directly from the browser.
// Used for the always-visible treasury figures (no wallet connection required).
export function getReadProvider() {
  return new ethers.JsonRpcProvider(BSC_CHAIN_PARAMS.rpcUrls[0], tokenInfo.chainId);
}

// Minimal fragments — only what this site actually calls.
export const TOKEN_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function treasury() view returns (address)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

export const VAULT_ABI = [
  "function reserveAssetCount() view returns (uint256)",
  "function getReserveBalances() view returns (address[] tokens, uint256[] balances)",
  "function previewRedeem(uint256 rsvdAmount) view returns (address[] tokens, uint256[] amounts)",
  "function redeem(uint256 rsvdAmount)",
];

// Small stand-alone fragment for reading name/symbol/decimals off arbitrary
// reserve-asset tokens (bStocks) so the UI can label them without a hardcoded list.
export const ERC20_META_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

export function getTokenContract(runner: ethers.ContractRunner) {
  return new ethers.Contract(tokenInfo.tokenAddress, TOKEN_ABI, runner);
}

export function getVaultContract(runner: ethers.ContractRunner) {
  return new ethers.Contract(tokenInfo.vaultAddress, VAULT_ABI, runner);
}
