import { ethers } from "ethers";
import { tokenInfo, reserveAssets } from "@/config/token";

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
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  // Burning triggers a pro-rata payout of the treasury's bStock holdings to the caller
  // — confirmed by a real executed transaction (see docsContent.ts's "treasury"
  // section). No allowance needed: this burns the caller's own balance directly.
  "function burn(uint256 amount)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

// Shared by the holder-count and treasury-activity API routes for reading Transfer logs
// off arbitrary ERC20s (the token itself, or a bStock) without pulling in TOKEN_ABI.
export const ERC20_TRANSFER_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function decimals() view returns (uint8)",
];

// Small stand-alone fragment for reading name/symbol/decimals off arbitrary
// reserve-asset tokens (bStocks) so the UI can label them without a hardcoded list.
export const ERC20_META_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

// Chainlink's BNB/USD price feed proxy on BSC mainnet — used to convert the
// pool-derived BNB market cap into USD. A read-only on-chain call, no API key.
// https://bscscan.com/address/0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE
export const BNB_USD_PRICE_FEED = "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE";
export const CHAINLINK_FEED_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
];

// PancakeSwap V2 factory + USDT — used to price vault holdings for "Total Reserve
// Value" (see DashboardCard) by discovering each reserve asset's own USDT pair live
// on-chain via getPair(), rather than hardcoding per-asset pair addresses this project
// has repeatedly found to be wrong/unconfirmed when checked for real (see
// contracts/scripts/verify-launch-addresses.ts). An asset with no such pair simply
// can't be priced yet — reflected in the UI as a partial/incomplete total, not faked.
export const PANCAKE_V2_FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
export const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
export const PANCAKE_FACTORY_ABI = ["function getPair(address tokenA, address tokenB) view returns (address)"];
export const PAIR_RESERVES_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
];

// ReservedGovernanceVote — non-binding signaling only, never touches RSVD/the vault.
export const GOVERNANCE_VOTE_ABI = [
  "function voteThreshold() view returns (uint256)",
  "function candidateCount() view returns (uint256)",
  "function candidates(uint256) view returns (string symbol, string name, bool active)",
  "function getVoteCounts() view returns (uint256[] counts)",
  "function myVote(address voter) view returns (bool hasVoted, uint256 candidateId)",
  "function castVote(uint256 candidateId)",
];

export function getTokenContract(runner: ethers.ContractRunner) {
  return new ethers.Contract(tokenInfo.tokenAddress, TOKEN_ABI, runner);
}

export function getGovernanceVoteContract(runner: ethers.ContractRunner) {
  return new ethers.Contract(tokenInfo.governanceVoteAddress, GOVERNANCE_VOTE_ABI, runner);
}

const RESERVE_BALANCE_ABI = ["function balanceOf(address account) view returns (uint256)"];

// There is no vault contract holding the reserve — acquired bStocks are sent straight to
// the token contract's own address, which can hold ERC20 balances like any other account.
// So "what does the treasury hold" is just balanceOf(tokenAddress) on each allowlisted
// bStock, not an aggregate call to a vault. A balance read failing (bad address, reverting
// token) drops that one asset to zero rather than failing the whole treasury view.
export async function getTreasuryHoldings(provider: ethers.ContractRunner) {
  return Promise.all(
    reserveAssets.map(async (asset) => {
      try {
        const erc20 = new ethers.Contract(asset.address, RESERVE_BALANCE_ABI, provider);
        const balance: bigint = await erc20.balanceOf(tokenInfo.tokenAddress);
        return { address: asset.address, symbol: asset.symbol, balance };
      } catch {
        return { address: asset.address, symbol: asset.symbol, balance: BigInt(0) };
      }
    })
  );
}
