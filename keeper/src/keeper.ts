import { Contract, JsonRpcProvider, NonceManager, Wallet, formatEther, formatUnits, parseUnits } from "ethers";
import { config, resolveBStocks, BStockConfig } from "./config";
import { TREASURY_CONVERTER_ABI, ERC20_ABI } from "./abis";
import { logger } from "./logger";
import { buyViaBinanceFallback } from "./binanceFallback";

export interface KeeperContext {
  provider: JsonRpcProvider;
  wallet: Wallet;
  converter: Contract;
  rsvd: Contract;
  bstocks: BStockConfig[];
}

export async function buildContext(): Promise<KeeperContext> {
  const provider = new JsonRpcProvider(config.rpcUrl);
  const wallet = new Wallet(config.keeperPrivateKey, provider);
  // A single cycle can send several transactions back-to-back (sellRsvd, then a
  // checkpoint + buyReserveAsset + depositReserveAsset per bStock). Re-querying the
  // node for the "pending" nonce before each one is racy — on a fast/automining chain
  // the node can report a stale nonce for a transaction it just mined microseconds
  // earlier. NonceManager tracks the nonce locally instead, incrementing it after each
  // send rather than re-asking the node every time.
  const nonceManager = new NonceManager(wallet);
  const converter = new Contract(config.converterAddress, TREASURY_CONVERTER_ABI, nonceManager);
  const rsvd = new Contract(config.rsvdAddress, ERC20_ABI, provider);

  // Read WBNB from the contract itself rather than trusting a hand-entered env var —
  // TreasuryConverter already resolved and stored it (from router.WETH()) at deploy
  // time, so this is the one source of truth, not a second place to typo an address.
  const wbnb: string = await converter.WBNB();
  const bstocks = resolveBStocks(config.rawBStocks, wbnb);

  return { provider, wallet, converter, rsvd, bstocks };
}

/// Returns { ready, secondsRemaining } — whether `subject`'s TWAP checkpoint is old
/// enough (>= minTwapWindow) for a checkpoint-consuming call to succeed. If the
/// checkpoint has never been set (timestamp 0), records one and reports not-ready, so
/// the next cycle (after minTwapWindow) can proceed.
async function ensureCheckpointReady(
  ctx: KeeperContext,
  subject: string,
  updateFn: () => Promise<unknown>,
  minTwapWindow: bigint
): Promise<{ ready: boolean; secondsRemaining: number }> {
  const [, timestamp] = await ctx.converter.twapCheckpoints(subject);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (timestamp === 0n) {
    logger.info(`No TWAP checkpoint yet for ${subject} — recording one now, will be ready next cycle.`);
    await updateFn();
    return { ready: false, secondsRemaining: Number(minTwapWindow) };
  }

  const elapsed = nowSeconds - Number(timestamp);
  if (BigInt(elapsed) < minTwapWindow) {
    return { ready: false, secondsRemaining: Number(minTwapWindow) - elapsed };
  }
  return { ready: true, secondsRemaining: 0 };
}

async function trySellRsvd(ctx: KeeperContext): Promise<void> {
  const converterAddress = await ctx.converter.getAddress();
  const [balance, decimals, maxSpend, minTwapWindow] = await Promise.all([
    ctx.rsvd.balanceOf(converterAddress),
    ctx.rsvd.decimals(),
    ctx.converter.maxRsvdSpendPerTx(),
    ctx.converter.minTwapWindow(),
  ]);

  const minToSell = parseUnits(config.minRsvdToSell, decimals);
  if (balance < minToSell) {
    logger.info(`RSVD balance (${formatUnits(balance, decimals)}) below dust threshold — skipping sellRsvd.`);
    return;
  }

  const rsvdAddress = config.rsvdAddress;
  const { ready, secondsRemaining } = await ensureCheckpointReady(
    ctx,
    rsvdAddress,
    () => ctx.converter.updateTwapCheckpoint().then((tx: { wait: () => Promise<unknown> }) => tx.wait()),
    minTwapWindow
  );
  if (!ready) {
    logger.info(`RSVD/BNB TWAP window not elapsed yet — ${secondsRemaining}s remaining, skipping sellRsvd this cycle.`);
    return;
  }

  const amountIn = balance < maxSpend ? balance : maxSpend;
  logger.info(`Selling ${formatUnits(amountIn, decimals)} RSVD — trusting the contract's own TWAP floor (minOut=0).`);
  try {
    const tx = await ctx.converter.sellRsvd(amountIn, 0n);
    const receipt = await tx.wait();
    logger.info(`sellRsvd confirmed: ${receipt.hash}`);
  } catch (err) {
    logger.error("sellRsvd reverted:", (err as Error).message);
  }
}

async function tryBuyBstock(ctx: KeeperContext, bstock: BStockConfig): Promise<void> {
  const converterAddress = await ctx.converter.getAddress();
  const [allowed, pairAddr, priceFeed, requireFloor, maxSpend, minTwapWindow, bnbBalance] = await Promise.all([
    ctx.converter.isAllowedReserveAsset(bstock.address),
    ctx.converter.bStockUsdtPair(bstock.address),
    ctx.converter.priceFeed(),
    ctx.converter.requirePriceFloorForBuys(),
    ctx.converter.maxBnbSpendPerTx(),
    ctx.converter.minTwapWindow(),
    ctx.provider.getBalance(converterAddress),
  ]);

  if (!allowed) {
    logger.warn(`${bstock.symbol} is not allowlisted on the converter — skipping.`);
    return;
  }

  const ZERO = "0x0000000000000000000000000000000000000000";
  const priceFloorAvailable = pairAddr !== ZERO && priceFeed !== ZERO;
  if (!priceFloorAvailable && requireFloor) {
    logger.warn(`${bstock.symbol} has no configured USDT pair/price feed and requirePriceFloorForBuys is on — skipping.`);
    return;
  }

  const minToBuy = parseUnits(config.minBnbToBuy, 18);
  if (bnbBalance < minToBuy) {
    logger.info(`BNB balance (${formatEther(bnbBalance)}) below dust threshold — skipping ${bstock.symbol} buy.`);
    return;
  }

  if (priceFloorAvailable) {
    const { ready, secondsRemaining } = await ensureCheckpointReady(
      ctx,
      bstock.address,
      () => ctx.converter.updateBStockTwapCheckpoint(bstock.address).then((tx: { wait: () => Promise<unknown> }) => tx.wait()),
      minTwapWindow
    );
    if (!ready) {
      logger.info(`${bstock.symbol}/USDT TWAP window not elapsed yet — ${secondsRemaining}s remaining, skipping this cycle.`);
      return;
    }
  }

  const bnbIn = bnbBalance < maxSpend ? bnbBalance : maxSpend;

  // Simulate first (no state change, no gas spent on a doomed tx) — if the on-chain
  // route can't fill this size without excessive slippage, buyReserveAsset's own
  // BelowMinOut check (or the router itself) will revert here just like it would for
  // a real tx. Route that case to the Binance fallback instead of retrying forever.
  try {
    await ctx.converter.buyReserveAsset.staticCall(bnbIn, 0n, bstock.address, bstock.path);
  } catch (simErr) {
    logger.warn(`${bstock.symbol} on-chain buy simulation failed (likely thin liquidity): ${(simErr as Error).message}`);
    try {
      await buyViaBinanceFallback(bstock.symbol, formatEther(bnbIn));
    } catch (fallbackErr) {
      logger.error(`Binance fallback for ${bstock.symbol} unavailable: ${(fallbackErr as Error).message}`);
    }
    return;
  }

  logger.info(`Buying ${bstock.symbol} with ${formatEther(bnbIn)} BNB — trusting the contract's own price floor (minOut=0).`);
  let bought = 0n;
  try {
    const tx = await ctx.converter.buyReserveAsset(bnbIn, 0n, bstock.address, bstock.path);
    const receipt = await tx.wait();
    logger.info(`buyReserveAsset confirmed: ${receipt.hash}`);
    const bStockToken = new Contract(bstock.address, ERC20_ABI, ctx.provider);
    bought = await bStockToken.balanceOf(converterAddress);
  } catch (err) {
    logger.error(`buyReserveAsset for ${bstock.symbol} reverted:`, (err as Error).message);
    return;
  }

  if (bought === 0n) return;
  logger.info(`Depositing ${bstock.symbol} balance into the vault.`);
  try {
    const tx = await ctx.converter.depositReserveAsset(bstock.address, bought);
    const receipt = await tx.wait();
    logger.info(`depositReserveAsset confirmed: ${receipt.hash}`);
  } catch (err) {
    logger.error(`depositReserveAsset for ${bstock.symbol} reverted:`, (err as Error).message);
  }
}

export async function runCycle(ctx: KeeperContext): Promise<void> {
  const walletAddress = await ctx.wallet.getAddress();
  const [converterKeeper, converterOwner] = await Promise.all([ctx.converter.keeper(), ctx.converter.owner()]);
  if (walletAddress.toLowerCase() !== converterKeeper.toLowerCase() && walletAddress.toLowerCase() !== converterOwner.toLowerCase()) {
    throw new Error(
      `Configured wallet ${walletAddress} is neither the converter's keeper (${converterKeeper}) nor its owner — ` +
        "every call in this cycle would revert with NotKeeper. Fix KEEPER_PRIVATE_KEY or converter.setKeeper()."
    );
  }

  logger.info(`--- Keeper cycle starting (${walletAddress}) ---`);
  await trySellRsvd(ctx);
  for (const bstock of ctx.bstocks) {
    await tryBuyBstock(ctx, bstock);
  }
  logger.info("--- Keeper cycle complete ---");
}
