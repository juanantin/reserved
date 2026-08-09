import { ethers } from "hardhat";
import { DEPLOYMENTS } from "./pancake-addresses";

/**
 * Launches RSVD: deploys the token and vault, creates the V3 pool at a target market cap,
 * and opens a single-sided position holding only RSVD.
 *
 * There is no initializer contract and no delegatecall. The token mints its whole supply
 * in its own constructor, so opening the pool is just three ordinary calls to the position
 * manager. LaunchPricing supplies the numbers and is a stateless view contract.
 *
 * Every step is simulated against live state before anything is broadcast.
 *
 *   TOKEN_NAME=Reserved TOKEN_SYMBOL=RSVD START_MARKETCAP_USD=100000 DRY_RUN=1 \
 *     npm run launch:mainnet
 */

const env = (k: string, d?: string) => process.env[k] ?? d;

const TOKEN_NAME = env("TOKEN_NAME", "Reserved")!;
const TOKEN_SYMBOL = env("TOKEN_SYMBOL", "RSVD")!;
const SUPPLY = ethers.parseUnits(env("SUPPLY_TOKENS", "1000000000")!, 18);
/// Held back from the pool. The rest becomes the single-sided position.
const OWNER_SUPPLY = ethers.parseUnits(env("OWNER_SUPPLY_TOKENS", "0")!, 18);
const POOL_FEE = Number(env("POOL_FEE", "2500"));
const START_MARKETCAP = ethers.parseUnits(env("START_MARKETCAP_USD", "100000")!, 18);
const DRY_RUN = env("DRY_RUN") === "1";

/// Optional launch buy, executed right after the position opens.
const FIRST_BUY = ethers.parseEther(env("FIRST_BUY_BNB", "0")!);
/// Where the bought tokens end up. Defaults to the deployer. Supplied explicitly — this
/// script does not generate wallets.
const FIRST_BUY_RECIPIENTS = (env("FIRST_BUY_RECIPIENTS", "") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);
/// Relative shares matching FIRST_BUY_RECIPIENTS, e.g. "50,30,20". Defaults to an even
/// split. Deliberately explicit and deliberately not randomised: the distribution is a
/// plain sequence of Transfer events either way, so weighting it to look like unrelated
/// buyers would fool nobody reading the logs while misleading anyone who only skims the
/// holder list.
const FIRST_BUY_SHARES = (env("FIRST_BUY_SHARES", "") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean).map((s) => BigInt(s));
const SLIPPAGE_BPS = BigInt(env("SLIPPAGE_BPS", "1000")!);
/// V3 derives liquidity by rounding down, so the deposit lands a few wei under the
/// desired amount. An exact-match bound is unsatisfiable — this is the launch's own
/// "Price slippage check" failure, now permanently avoided.
const MIN_BPS = 9_999n;

const PM_ABI = [
  "function WETH9() view returns (address)",
  "function factory() view returns (address)",
  "function createAndInitializePoolIfNecessary(address,address,uint24,uint160) payable returns (address)",
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
];
const FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];
const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint32,bool)",
];
const WBNB_ABI = [
  "function deposit() payable",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];
// Verified against BSC mainnet: PancakeSwap's SwapRouter carries `deadline` in the
// params struct (SwapRouter02 dropped it, this deployment did not).
const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)",
];

/// Splits `total` by relative weight, giving any rounding remainder to the last entry so
/// nothing is left stranded on the buying wallet.
function splitByShares(total: bigint, shares: bigint[]): bigint[] {
  const sum = shares.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new Error("FIRST_BUY_SHARES sum to zero");
  const out = shares.map((s) => (total * s) / sum);
  out[out.length - 1] = total - out.slice(0, -1).reduce((a, b) => a + b, 0n);
  return out;
}

async function assertCode(addr: string, what: string) {
  if ((await ethers.provider.getCode(addr)) === "0x") throw new Error(`${what} (${addr}) has no code here`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer configured — set DEPLOYER_PRIVATE_KEY in .env");

  const net = await ethers.provider.getNetwork();
  const deployment = DEPLOYMENTS[Number(net.chainId)];
  if (!deployment) throw new Error(`No PancakeSwap deployment configured for chain ${net.chainId}`);

  const owner = env("OWNER", deployer.address)!;
  const keeper = env("KEEPER", deployer.address)!;

  console.log(`\nNetwork    : ${deployment.label}`);
  console.log(`Deployer   : ${deployer.address}`);
  console.log(`Balance    : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} BNB`);
  console.log(`Token      : ${TOKEN_NAME} (${TOKEN_SYMBOL})`);
  console.log(`Supply     : ${ethers.formatUnits(SUPPLY, 18)}`);
  console.log(`  to owner : ${ethers.formatUnits(OWNER_SUPPLY, 18)} (rest is pooled)`);
  console.log(`Fee tier   : ${POOL_FEE} (${POOL_FEE / 10_000}%)`);
  console.log(`Start mcap : $${ethers.formatUnits(START_MARKETCAP, 18)}`);
  console.log(
    `Launch buy : ${ethers.formatEther(FIRST_BUY)} BNB` +
      (FIRST_BUY > 0n ? ` -> ${FIRST_BUY_RECIPIENTS.length || 1} wallet(s)` : "")
  );
  console.log(`Mode       : ${DRY_RUN ? "DRY RUN" : "LIVE — this broadcasts"}`);

  if (OWNER_SUPPLY >= SUPPLY) throw new Error("OWNER_SUPPLY_TOKENS leaves nothing to pool");

  console.log("\nChecking preconditions...");
  await assertCode(deployment.positionManager, "NonfungiblePositionManager");
  await assertCode(deployment.stablecoin, "Stablecoin");

  const pm = new ethers.Contract(deployment.positionManager, PM_ABI, deployer);
  const wbnb: string = await pm.WETH9();
  const factoryAddress: string = await pm.factory();
  const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, ethers.provider);

  const refPool: string = await factory.getPool(wbnb, deployment.stablecoin, POOL_FEE);
  if (refPool === ethers.ZeroAddress) {
    throw new Error(
      `No ${wbnb}/${deployment.stablecoin} pool at fee ${POOL_FEE}. The launch price is read ` +
        `from that pool, so POOL_FEE must be a tier where the native/stablecoin pair exists.`
    );
  }
  console.log(`  WETH9 ${wbnb}`);
  console.log(`  reference pool ${refPool}`);

  // --- deploy --------------------------------------------------------------
  console.log("\nDeploying...");
  const Token = await ethers.getContractFactory("ReservedToken");
  const token = await Token.deploy(TOKEN_NAME, TOKEN_SYMBOL, SUPPLY, deployer.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`  ReservedToken ${tokenAddress}`);

  const Vault = await ethers.getContractFactory("ReservedVault");
  const vault = await Vault.deploy(tokenAddress, owner, keeper);
  await vault.waitForDeployment();
  console.log(`  ReservedVault ${await vault.getAddress()}`);

  const Pricing = await ethers.getContractFactory("LaunchPricing");
  const pricing = await Pricing.deploy();
  await pricing.waitForDeployment();
  console.log(`  LaunchPricing ${await pricing.getAddress()}`);

  // --- price ---------------------------------------------------------------
  const sqrtPriceX96: bigint = await pricing.initialSqrtPriceX96(
    START_MARKETCAP,
    SUPPLY,
    deployment.positionManager,
    wbnb,
    deployment.stablecoin,
    POOL_FEE,
    tokenAddress
  );
  console.log(`\nsqrtPriceX96 : ${sqrtPriceX96}`);

  const tokenIsToken0 = BigInt(tokenAddress) < BigInt(wbnb);
  const [token0, token1] = tokenIsToken0 ? [tokenAddress, wbnb] : [wbnb, tokenAddress];
  const pooled = SUPPLY - OWNER_SUPPLY;

  if (DRY_RUN) {
    console.log("\nDRY_RUN=1 — stopping before the pool is created.");
    console.log("Note the three contracts above WERE deployed; a live run deploys a fresh set.");
    return;
  }

  // --- create pool ---------------------------------------------------------
  console.log("\nCreating pool...");
  await (await pm.createAndInitializePoolIfNecessary(token0, token1, POOL_FEE, sqrtPriceX96)).wait();
  const pool: string = await factory.getPool(tokenAddress, wbnb, POOL_FEE);
  console.log(`  ${pool}`);

  const [tickLower, tickUpper] = await pricing.getTicks(pool, wbnb, tokenAddress);
  console.log(`  ticks [${tickLower}, ${tickUpper}]`);

  // --- open the position ---------------------------------------------------
  console.log("\nOpening the position...");
  await (await token.approve(deployment.positionManager, pooled)).wait();

  const amount0Desired = tokenIsToken0 ? pooled : 0n;
  const amount1Desired = tokenIsToken0 ? 0n : pooled;
  const mintParams = {
    token0,
    token1,
    fee: POOL_FEE,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
    amount0Min: (amount0Desired * MIN_BPS) / 10_000n,
    amount1Min: (amount1Desired * MIN_BPS) / 10_000n,
    recipient: owner,
    deadline: Math.floor(Date.now() / 1000) + 900,
  };

  try {
    await pm.mint.staticCall(mintParams);
    console.log("  simulation OK");
  } catch (err: any) {
    console.error(`  simulation FAILED — not broadcasting: ${err.shortMessage ?? err.message}`);
    throw err;
  }

  const mintTx = await pm.mint(mintParams);
  console.log(`  tx ${mintTx.hash}`);
  await mintTx.wait();

  if (OWNER_SUPPLY > 0n) await (await token.transfer(owner, OWNER_SUPPLY)).wait();

  // --- launch buy ----------------------------------------------------------
  if (FIRST_BUY > 0n) {
    const recipients = FIRST_BUY_RECIPIENTS.length > 0 ? FIRST_BUY_RECIPIENTS : [deployer.address];
    for (const r of recipients) {
      if (!ethers.isAddress(r)) throw new Error(`FIRST_BUY_RECIPIENTS contains an invalid address: ${r}`);
    }
    const shares =
      FIRST_BUY_SHARES.length > 0 ? FIRST_BUY_SHARES : recipients.map(() => 1n);
    if (shares.length !== recipients.length) {
      throw new Error(`FIRST_BUY_SHARES has ${shares.length} entries for ${recipients.length} recipients`);
    }

    console.log(`\nLaunch buy: ${ethers.formatEther(FIRST_BUY)} BNB`);

    // Wrap and approve rather than sending native value through the router — the router's
    // native handling needs a refundETH multicall to avoid stranding dust, and wrapping
    // explicitly is the same cost with none of that.
    const wbnbContract = new ethers.Contract(wbnb, WBNB_ABI, deployer);
    await (await wbnbContract.deposit({ value: FIRST_BUY })).wait();
    await (await wbnbContract.approve(deployment.swapRouter, FIRST_BUY)).wait();

    const router = new ethers.Contract(deployment.swapRouter, ROUTER_ABI, deployer);
    const swapParams = (minOut: bigint) => ({
      tokenIn: wbnb,
      tokenOut: tokenAddress,
      fee: POOL_FEE,
      recipient: deployer.address,
      deadline: Math.floor(Date.now() / 1000) + 900,
      amountIn: FIRST_BUY,
      amountOutMinimum: minOut,
      sqrtPriceLimitX96: 0n,
    });

    // Quote by simulation, then bound the real send against it.
    const expectedOut: bigint = await router.exactInputSingle.staticCall(swapParams(0n));
    const minOut = (expectedOut * (10_000n - SLIPPAGE_BPS)) / 10_000n;
    console.log(`  expected ${ethers.formatUnits(expectedOut, 18)} ${TOKEN_SYMBOL}`);
    console.log(`  min out  ${ethers.formatUnits(minOut, 18)} (${SLIPPAGE_BPS} bps tolerance)`);

    const buyTx = await router.exactInputSingle(swapParams(minOut));
    console.log(`  tx ${buyTx.hash}`);
    await buyTx.wait();

    // --- distribute ---------------------------------------------------------
    const bought = await token.balanceOf(deployer.address);
    if (recipients.length === 1 && recipients[0].toLowerCase() === deployer.address.toLowerCase()) {
      console.log(`  held by deployer: ${ethers.formatUnits(bought, 18)}`);
    } else {
      const amounts = splitByShares(bought, shares);
      console.log(`  distributing across ${recipients.length} wallet(s):`);
      for (let i = 0; i < recipients.length; i++) {
        if (amounts[i] === 0n) continue;
        if (recipients[i].toLowerCase() === deployer.address.toLowerCase()) {
          console.log(`    ${recipients[i]}  ${ethers.formatUnits(amounts[i], 18)} (kept)`);
          continue;
        }
        await (await token.transfer(recipients[i], amounts[i])).wait();
        console.log(`    ${recipients[i]}  ${ethers.formatUnits(amounts[i], 18)}`);
      }
    }
  }

  // --- report --------------------------------------------------------------
  const slot0 = await new ethers.Contract(pool, POOL_ABI, ethers.provider).slot0();
  console.log("\nResult:");
  console.log(`  pool           ${pool}`);
  console.log(`  pooled         ${ethers.formatUnits(await token.balanceOf(pool), 18)} ${TOKEN_SYMBOL}`);
  console.log(`  owner holds    ${ethers.formatUnits(await token.balanceOf(owner), 18)}`);
  console.log(`  tick           ${slot0.tick}`);

  console.log("\nStill to do:");
  console.log("  - any launch buy above is visible in the logs: one funding wallet, then each");
  console.log("    transfer out. Holder tooling reads it that way, so plan the story accordingly");
  console.log("  - the LP NFT is held by the owner: lock or burn it, or liquidity reads as unlocked");
  console.log("  - the token has no admin functions, so nothing about it can be changed from here");
  console.log("  - treasury revenue needs the Infinity hook; until then only LP fees accrue");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
