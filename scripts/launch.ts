import { ethers } from "hardhat";

/**
 * Launch script: deploys ReservedToken + ReservedVault + UniswapV3TokenInitializer,
 * then drives the initializer through ReservedToken.postDeploy to mint supply, create
 * the V3 pool, and seed single-sided liquidity.
 *
 * Run with DRY_RUN=1 first. That does every on-chain precondition check and then
 * eth_call's the real postDeploy — pool creation, liquidity mint and the optional first
 * buy all execute against live state — without broadcasting anything. If the dry run is
 * clean the real send will behave the same, barring a price move between the two.
 *
 *   DRY_RUN=1 npm run launch:testnet
 *   npm run launch:testnet
 *
 * Nothing here is recoverable once broadcast: ReservedToken is not upgradeable, and
 * postDeploy stops accepting calls the moment the initializer mints a supply.
 */

// ---------------------------------------------------------------------------
// Router / pool addresses.
//
// VERIFY THESE against PancakeSwap's published deployment list before a mainnet run.
// They are the single most expensive thing in this file to get wrong: a bad position
// manager address means the delegatecall reverts (cheap), but a valid-looking address
// pointing at the wrong deployment means liquidity lands in a pool nobody trades.
// The script checks each one has code and that the position manager answers WETH9(),
// which catches typos and wrong-chain addresses but cannot tell you it is the router
// your users will actually route through.
// ---------------------------------------------------------------------------
type Deployment = {
  positionManager: string;
  swapRouter: string;
  stablecoin: string;
  label: string;
};

const DEPLOYMENTS: Record<number, Deployment> = {
  56: {
    label: "BSC mainnet / PancakeSwap V3",
    positionManager: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
    swapRouter: "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
    stablecoin: "0x55d398326f99059fF775485246999027B3197955", // USDT (18 dp on BSC)
  },
  97: {
    label: "BSC testnet / PancakeSwap V3",
    positionManager: "0x427bF5b37357632377eCbEC9de3626C71A5396c1",
    swapRouter: "0x9a489505a00cE272eAa5e07Dba6491314CaE3796",
    stablecoin: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd", // testnet USDT
  },
};

const env = (k: string, fallback?: string) => process.env[k] ?? fallback;
const required = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing required env var ${k}`);
  return v;
};

const TOKEN_NAME = env("TOKEN_NAME", "Reserved")!;
const TOKEN_SYMBOL = env("TOKEN_SYMBOL", "RSVD")!;
const INITIAL_SUPPLY = ethers.parseUnits(env("INITIAL_SUPPLY_TOKENS", "1000000000")!, 18);
const OWNER_SUPPLY = ethers.parseUnits(env("OWNER_SUPPLY_TOKENS", "0")!, 18);
const POOL_FEE = Number(env("POOL_FEE", "2500")); // PancakeSwap V3 tiers: 100 / 500 / 2500 / 10000
const START_MARKETCAP = ethers.parseUnits(env("START_MARKETCAP_USD", "100000")!, 18);
const FIRST_BUY = ethers.parseEther(env("FIRST_BUY_BNB", "0")!);
const DRY_RUN = env("DRY_RUN") === "1";

// Addresses that receive the first buy, supplied explicitly — this script does not
// generate them. The initializer expects them offset by WALLET_KEY (see maskWallets).
const FIRST_BUY_WALLETS = (env("FIRST_BUY_WALLETS", "") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const POSITION_MANAGER_ABI = [
  "function WETH9() view returns (address)",
  "function factory() view returns (address)",
];
const FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];
const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)",
];

/**
 * The initializer takes wallets as uint256, each offset by the key, and recovers them
 * with `address(uint160(masked - seed))`. So masked = uint160(address) + seed.
 */
function maskWallets(wallets: string[], seed: bigint): bigint[] {
  return wallets.map((w) => {
    if (!ethers.isAddress(w)) throw new Error(`FIRST_BUY_WALLETS contains an invalid address: ${w}`);
    return BigInt(ethers.getAddress(w)) + seed;
  });
}

async function assertHasCode(addr: string, what: string) {
  const code = await ethers.provider.getCode(addr);
  if (code === "0x") throw new Error(`${what} (${addr}) has no code on this network`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer configured — set DEPLOYER_PRIVATE_KEY in .env");
  }

  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const deployment = DEPLOYMENTS[chainId];
  if (!deployment) {
    throw new Error(`No PancakeSwap deployment configured for chain ${chainId}`);
  }

  const owner = env("OWNER", deployer.address)!;
  const treasury = env("TREASURY", deployer.address)!;
  const keeper = env("KEEPER", deployer.address)!;

  console.log(`\nNetwork      : ${deployment.label} (chain ${chainId})`);
  console.log(`Deployer     : ${deployer.address}`);
  console.log(`Balance      : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} BNB`);
  console.log(`Owner        : ${owner}`);
  console.log(`Treasury     : ${treasury}`);
  console.log(`Supply       : ${ethers.formatUnits(INITIAL_SUPPLY, 18)} ${TOKEN_SYMBOL}`);
  console.log(`  to owner   : ${ethers.formatUnits(OWNER_SUPPLY, 18)} (rest goes to the pool)`);
  console.log(`Fee tier     : ${POOL_FEE} (${POOL_FEE / 10_000}%)`);
  console.log(`Start mcap   : $${ethers.formatUnits(START_MARKETCAP, 18)}`);
  console.log(`First buy    : ${ethers.formatEther(FIRST_BUY)} BNB across ${FIRST_BUY_WALLETS.length} wallet(s)`);
  console.log(`Mode         : ${DRY_RUN ? "DRY RUN (nothing broadcast)" : "LIVE — this broadcasts"}`);

  if (OWNER_SUPPLY > INITIAL_SUPPLY) {
    throw new Error("OWNER_SUPPLY_TOKENS exceeds INITIAL_SUPPLY_TOKENS");
  }
  if (FIRST_BUY > 0n && FIRST_BUY_WALLETS.length === 0) {
    // _splitSwappedAmount indexes wallets[length - 1]; an empty list underflows and reverts.
    throw new Error("FIRST_BUY_BNB is set but FIRST_BUY_WALLETS is empty — the initializer would revert");
  }

  // --- preconditions -------------------------------------------------------
  console.log("\nChecking preconditions...");
  await assertHasCode(deployment.positionManager, "NonfungiblePositionManager");
  await assertHasCode(deployment.swapRouter, "SwapRouter");
  await assertHasCode(deployment.stablecoin, "Stablecoin");

  const pm = new ethers.Contract(deployment.positionManager, POSITION_MANAGER_ABI, ethers.provider);
  const wrappedNative: string = await pm.WETH9();
  const factoryAddress: string = await pm.factory();
  await assertHasCode(wrappedNative, "Wrapped native (WETH9)");
  await assertHasCode(factoryAddress, "Factory");
  console.log(`  position manager -> WETH9 ${wrappedNative}, factory ${factoryAddress}`);

  // _getInitialSqrtPriceX96 prices the launch off the wrapped-native/stablecoin pool at
  // the SAME fee tier as the token pool. If that reference pool does not exist the
  // delegatecall reverts when it calls slot0() on address(0).
  const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, ethers.provider);
  const refPool: string = await factory.getPool(wrappedNative, deployment.stablecoin, POOL_FEE);
  if (refPool === ethers.ZeroAddress) {
    throw new Error(
      `No ${wrappedNative}/${deployment.stablecoin} pool at fee tier ${POOL_FEE}. ` +
        `The initializer reads its reference price from that pool, so POOL_FEE must be a tier ` +
        `where the native/stablecoin pair actually exists.`
    );
  }
  const refSlot0 = await new ethers.Contract(refPool, POOL_ABI, ethers.provider).slot0();
  console.log(`  reference pool   ${refPool} (sqrtPriceX96 ${refSlot0.sqrtPriceX96})`);

  // --- deploy --------------------------------------------------------------
  console.log("\nDeploying...");
  const Token = await ethers.getContractFactory("ReservedToken");
  const token = await Token.deploy(TOKEN_NAME, TOKEN_SYMBOL, owner, treasury);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`  ReservedToken             ${tokenAddress}`);

  const Vault = await ethers.getContractFactory("ReservedVault");
  const vault = await Vault.deploy(tokenAddress, owner, keeper);
  await vault.waitForDeployment();
  console.log(`  ReservedVault             ${await vault.getAddress()}`);

  const Initializer = await ethers.getContractFactory("UniswapV3TokenInitializer");
  const initializer = await Initializer.deploy();
  await initializer.waitForDeployment();
  const initializerAddress = await initializer.getAddress();
  console.log(`  UniswapV3TokenInitializer ${initializerAddress}`);

  // --- build the init payload ---------------------------------------------
  const walletKey = BigInt(env("WALLET_KEY", ethers.hexlify(ethers.randomBytes(31)))!);
  const payload = initializer.interface.encodeFunctionData("init", [
    deployment.positionManager,
    deployment.swapRouter,
    deployment.stablecoin,
    INITIAL_SUPPLY,
    OWNER_SUPPLY,
    POOL_FEE,
    walletKey,
    maskWallets(FIRST_BUY_WALLETS, walletKey),
    START_MARKETCAP,
  ]);

  // --- simulate ------------------------------------------------------------
  console.log("\nSimulating postDeploy (eth_call against live state)...");
  try {
    await token.postDeploy.staticCall(initializerAddress, payload, { value: FIRST_BUY });
    console.log("  simulation OK");
  } catch (err: any) {
    console.error("  simulation FAILED — not broadcasting:");
    console.error(`  ${err.shortMessage ?? err.message}`);
    throw err;
  }

  if (DRY_RUN) {
    console.log("\nDRY_RUN=1 — stopping before postDeploy. Nothing further was broadcast.");
    console.log("Note the three contracts above WERE deployed; re-run without DRY_RUN to launch,");
    console.log("which will deploy a fresh set.");
    return;
  }

  // --- launch --------------------------------------------------------------
  console.log("\nCalling postDeploy...");
  const tx = await token.postDeploy(initializerAddress, payload, { value: FIRST_BUY });
  console.log(`  tx ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  mined in block ${receipt?.blockNumber}, gas used ${receipt?.gasUsed}`);

  // --- read back -----------------------------------------------------------
  const pool: string = await factory.getPool(tokenAddress, wrappedNative, POOL_FEE);
  console.log("\nResult:");
  console.log(`  pool            ${pool}`);
  console.log(`  totalSupply     ${ethers.formatUnits(await token.totalSupply(), 18)} ${TOKEN_SYMBOL}`);
  console.log(`  owner balance   ${ethers.formatUnits(await token.balanceOf(owner), 18)}`);
  console.log(`  isAmmPair(pool) ${await token.isAmmPair(pool)}`);
  console.log(`  taxBps          ${await token.taxBps()}`);
  if (pool !== ethers.ZeroAddress) {
    const slot0 = await new ethers.Contract(pool, POOL_ABI, ethers.provider).slot0();
    console.log(`  pool sqrtPriceX96 ${slot0.sqrtPriceX96} (tick ${slot0.tick})`);
  }

  console.log("\nStill to do:");
  console.log("  - postDeploy is now closed (totalSupply != 0), but stays owner-callable if supply ever returns to 0");
  console.log("  - the LP NFT is held by the owner: lock or burn it, or liquidity reads as unlocked");
  console.log("  - vault.setKeeper(...) once the keeper address is final");
  console.log("  - verify all three contracts on BscScan");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
