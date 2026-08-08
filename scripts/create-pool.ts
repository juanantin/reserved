import { ethers } from "hardhat";

// Adds the first liquidity for TOKEN_ADDRESS against native BNB on PancakeSwap V2
// (mainnet only — there's no meaningful "real pool" test on testnet, since testnet
// PancakeSwap liquidity/price data is worthless). Meant for a small, entirely
// self-funded pool (see README's "Mainnet dry run" section) — never run this
// expecting anyone besides your own wallets to trade against the pool. See that
// section for why: once a pool exists on mainnet, it's public infrastructure —
// sniper bots watch the PancakeSwap factory for new pairs and can buy within the
// same block, with no announcement needed on your part. Keep the pooled amounts
// small and the pool's lifetime short (create, test, remove liquidity, all in one
// sitting) to bound that exposure.
//
// PancakeSwap V2 Router on BSC mainnet. Double-check this against
// https://docs.pancakeswap.finance/developers/smart-contracts/pancakeswap-exchange/v2-contracts
// before trusting it — this is from training data, not a live lookup.
const PANCAKE_ROUTER = process.env.PANCAKE_ROUTER || "0x10ED43C718714eb63d5aA57B78B54704E256024E";

const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || "";
const TOKEN_AMOUNT = process.env.POOL_TOKEN_AMOUNT || ""; // human units, e.g. "100000"
const BNB_AMOUNT = process.env.POOL_BNB_AMOUNT || ""; // human units, e.g. "0.03"

const ROUTER_ABI = [
  "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)",
  "function factory() external pure returns (address)",
  "function WETH() external pure returns (address)",
];
const FACTORY_ABI = ["function getPair(address tokenA, address tokenB) external view returns (address)"];

async function main() {
  if (!TOKEN_ADDRESS || !TOKEN_AMOUNT || !BNB_AMOUNT) {
    throw new Error("Set TOKEN_ADDRESS, POOL_TOKEN_AMOUNT and POOL_BNB_AMOUNT env vars first.");
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account configured — check contracts/.env.");
  }

  const token: any = await ethers.getContractAt("ReservedToken", TOKEN_ADDRESS);
  const router = new ethers.Contract(PANCAKE_ROUTER, ROUTER_ABI, deployer);

  const tokenAmountWei = ethers.parseUnits(TOKEN_AMOUNT, 18);
  const bnbAmountWei = ethers.parseEther(BNB_AMOUNT);

  console.log("Deployer:", deployer.address);
  console.log("Token:", TOKEN_ADDRESS);
  console.log(`Adding liquidity: ${TOKEN_AMOUNT} tokens + ${BNB_AMOUNT} BNB`);

  await (await token.connect(deployer).approve(PANCAKE_ROUTER, tokenAmountWei)).wait();
  console.log("Approved router to spend tokens.");

  const deadline = Math.floor(Date.now() / 1000) + 60 * 10;
  const tx = await router.addLiquidityETH(
    TOKEN_ADDRESS,
    tokenAmountWei,
    0, // amountTokenMin — 0 is fine here: this is the first liquidity add, so there's
    0, // amountETHMin    no existing price to slip against yet.
    deployer.address,
    deadline,
    { value: bnbAmountWei }
  );
  const receipt = await tx.wait();
  console.log("addLiquidityETH tx:", receipt.hash);

  const factoryAddress: string = await router.factory();
  const wbnbAddress: string = await router.WETH();
  const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, deployer);
  const pairAddress: string = await factory.getPair(TOKEN_ADDRESS, wbnbAddress);

  console.log("\nPancakeSwap pair address:", pairAddress);
  console.log("\nNext steps:");
  console.log(`- token.setAmmPair("${pairAddress}", true) so buy/sell tax applies to this pool`);
  console.log("- keep PAIR_ADDRESS handy — remove-pool.ts needs it to pull liquidity back out later");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
