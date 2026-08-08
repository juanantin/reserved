import { ethers } from "hardhat";
import type { Contract } from "ethers";
import { DEPLOYMENTS } from "./pancake-addresses";

/**
 * Seeds an already-launched pool with BNB, in two legs:
 *
 *   1. a swap, which puts BNB into the pool and walks the price up, and
 *   2. a single-sided WBNB position below spot, which is a standing bid holders can
 *      sell into and what makes the pair read as two-sided.
 *
 * Both legs simulate against live state before broadcasting. Run with DRY_RUN=1 to stop
 * after the simulations.
 *
 *   TOKEN=0x... DRY_RUN=1 npm run seed:mainnet
 *   TOKEN=0x... npm run seed:mainnet
 *
 * Note the buy is NOT a test of the transfer tax if it runs from the token owner —
 * the constructor marks the owner tax-exempt. Use a non-exempt wallet for that.
 */

const env = (k: string, d?: string) => process.env[k] ?? d;

const TOKEN = env("TOKEN")!;
const POOL_FEE = Number(env("POOL_FEE", "2500"));
const BUY_BNB = ethers.parseEther(env("BUY_BNB", "0.005")!);
const LIQUIDITY_BNB = ethers.parseEther(env("LIQUIDITY_BNB", "0.005")!);
/// How far below spot the bid position reaches, in ticks. 2000 ≈ 18% below.
const BID_WIDTH_TICKS = Number(env("BID_WIDTH_TICKS", "2000"));
const SLIPPAGE_BPS = BigInt(env("SLIPPAGE_BPS", "500")!); // 5%
const DRY_RUN = env("DRY_RUN") === "1";

const MIN_TICK = -887272;

const PM_ABI = [
  "function WETH9() view returns (address)",
  "function factory() view returns (address)",
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
];
const FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];
const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint32 feeProtocol,bool unlocked)",
  "function tickSpacing() view returns (int24)",
  "function liquidity() view returns (uint128)",
];
const WBNB_ABI = [
  "function deposit() payable",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)", "function symbol() view returns (string)"];

// PancakeSwap forked Uniswap's SwapRouter, but Uniswap later dropped `deadline` from the
// params struct in SwapRouter02 and it is not obvious from an address which shape a given
// deployment carries. Try both and report which one answered — the initializer's own
// ISwapRouter assumes the deadline variant, so this doubles as a check on init's
// first-buy path, which has never run on-chain.
const ROUTER_ABI_WITH_DEADLINE = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
];
const ROUTER_ABI_NO_DEADLINE = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
];

const floorTo = (t: number, s: number) => Math.floor(t / s) * s;

async function main() {
  if (!TOKEN) throw new Error("Set TOKEN to the launched token address");

  const [signer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const deployment = DEPLOYMENTS[Number(net.chainId)];
  if (!deployment) throw new Error(`No deployment configured for chain ${net.chainId}`);

  const pm = new ethers.Contract(deployment.positionManager, PM_ABI, signer);
  const wbnbAddress: string = await pm.WETH9();
  const factory = new ethers.Contract(await pm.factory(), FACTORY_ABI, ethers.provider);
  const poolAddress: string = await factory.getPool(TOKEN, wbnbAddress, POOL_FEE);
  if (poolAddress === ethers.ZeroAddress) throw new Error(`No pool for ${TOKEN}/WBNB at fee ${POOL_FEE}`);

  const pool = new ethers.Contract(poolAddress, POOL_ABI, ethers.provider);
  const token = new ethers.Contract(TOKEN, ERC20_ABI, ethers.provider);
  const wbnb = new ethers.Contract(wbnbAddress, WBNB_ABI, signer);

  const slot0Before = await pool.slot0();
  const tickSpacing = Number(await pool.tickSpacing());
  const symbol = await token.symbol();
  const tokenIsToken0 = BigInt(TOKEN) < BigInt(wbnbAddress);

  console.log(`\nNetwork   : ${deployment.label}`);
  console.log(`Signer    : ${signer.address}`);
  console.log(`Balance   : ${ethers.formatEther(await ethers.provider.getBalance(signer.address))} BNB`);
  console.log(`Token     : ${TOKEN} (${symbol}), token${tokenIsToken0 ? "0" : "1"}`);
  console.log(`Pool      : ${poolAddress}`);
  console.log(`Tick      : ${slot0Before.tick} (spacing ${tickSpacing})`);
  console.log(`Liquidity : ${await pool.liquidity()}`);
  console.log(`Buy       : ${ethers.formatEther(BUY_BNB)} BNB`);
  console.log(`Bid       : ${ethers.formatEther(LIQUIDITY_BNB)} BNB, ${BID_WIDTH_TICKS} ticks below spot`);
  console.log(`Mode      : ${DRY_RUN ? "DRY RUN" : "LIVE — this broadcasts"}`);

  // --- wrap -----------------------------------------------------------------
  const total = BUY_BNB + LIQUIDITY_BNB;
  console.log(`\nWrapping ${ethers.formatEther(total)} BNB...`);
  if (!DRY_RUN) {
    await (await wbnb.deposit({ value: total })).wait();
    await (await wbnb.approve(deployment.swapRouter, BUY_BNB)).wait();
    await (await wbnb.approve(deployment.positionManager, LIQUIDITY_BNB)).wait();
    console.log(`  WBNB balance ${ethers.formatEther(await wbnb.balanceOf(signer.address))}`);
  } else {
    console.log("  skipped (dry run) — swap simulation below therefore cannot run either");
  }

  // --- leg 1: buy -----------------------------------------------------------
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const baseParams = {
    tokenIn: wbnbAddress,
    tokenOut: TOKEN,
    fee: POOL_FEE,
    recipient: signer.address,
    amountIn: BUY_BNB,
    sqrtPriceLimitX96: 0n,
  };

  let router: Contract | null = null;
  let buildParams: ((minOut: bigint) => any) | null = null;
  let expectedOut = 0n;

  for (const [label, abi, withDeadline] of [
    ["with deadline", ROUTER_ABI_WITH_DEADLINE, true],
    ["without deadline", ROUTER_ABI_NO_DEADLINE, false],
  ] as const) {
    const candidate = new ethers.Contract(deployment.swapRouter, abi, signer);
    const mk = (minOut: bigint) =>
      withDeadline
        ? { ...baseParams, deadline, amountOutMinimum: minOut }
        : { ...baseParams, amountOutMinimum: minOut };
    try {
      expectedOut = await candidate.exactInputSingle.staticCall(mk(0n));
      router = candidate;
      buildParams = mk;
      console.log(`\nRouter shape: ExactInputSingleParams ${label}`);
      break;
    } catch (err: any) {
      console.log(`\nRouter shape ${label}: rejected (${err.shortMessage ?? err.message})`);
    }
  }

  if (!router || !buildParams) {
    throw new Error(
      "Neither router params shape simulated successfully. If DRY_RUN, that is expected — " +
        "the swap needs the WBNB approval, which a dry run skips."
    );
  }

  const minOut = (expectedOut * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  console.log(`  expected out : ${ethers.formatUnits(expectedOut, 18)} ${symbol}`);
  console.log(`  min out      : ${ethers.formatUnits(minOut, 18)} (${SLIPPAGE_BPS} bps tolerance)`);

  if (!DRY_RUN) {
    const tx = await router.exactInputSingle(buildParams(minOut));
    console.log(`  tx ${tx.hash}`);
    await tx.wait();
    const received = await token.balanceOf(signer.address);
    console.log(`  holder balance now ${ethers.formatUnits(received, 18)} ${symbol}`);
  }

  // --- leg 2: bid-side position --------------------------------------------
  const slot0After = DRY_RUN ? slot0Before : await pool.slot0();
  const currentTick = Number(slot0After.tick);

  // A WBNB-only position must sit entirely at or below spot: for token1 that means
  // tickUpper <= currentTick.
  const tickUpper = floorTo(currentTick, tickSpacing);
  const tickLower = Math.max(floorTo(tickUpper - BID_WIDTH_TICKS, tickSpacing), floorTo(MIN_TICK, tickSpacing) + tickSpacing);
  if (tickLower >= tickUpper) throw new Error(`Bad bid range [${tickLower}, ${tickUpper}]`);

  const amount0Desired = tokenIsToken0 ? 0n : LIQUIDITY_BNB;
  const amount1Desired = tokenIsToken0 ? LIQUIDITY_BNB : 0n;

  console.log(`\nBid position: ticks [${tickLower}, ${tickUpper}], spot ${currentTick}`);
  const mintParams = {
    token0: tokenIsToken0 ? TOKEN : wbnbAddress,
    token1: tokenIsToken0 ? wbnbAddress : TOKEN,
    fee: POOL_FEE,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
    // Leave rounding slack. An exact-match bound is unsatisfiable — that is the bug
    // that blocked the launch itself.
    amount0Min: amount0Desired - amount0Desired / 10_000n,
    amount1Min: amount1Desired - amount1Desired / 10_000n,
    recipient: signer.address,
    deadline,
  };

  if (DRY_RUN) {
    console.log("  DRY_RUN — stopping before the mint.");
    return;
  }

  const mintTx = await pm.mint(mintParams);
  console.log(`  tx ${mintTx.hash}`);
  await mintTx.wait();

  // --- report ---------------------------------------------------------------
  const slot0End = await pool.slot0();
  console.log("\nResult:");
  console.log(`  pool ${symbol} : ${ethers.formatUnits(await token.balanceOf(poolAddress), 18)}`);
  console.log(`  pool WBNB     : ${ethers.formatEther(await wbnb.balanceOf(poolAddress))}`);
  console.log(`  tick          : ${slot0Before.tick} -> ${slot0End.tick}`);
  console.log(`  liquidity     : ${await pool.liquidity()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
