import { ethers } from "hardhat";
import { DEPLOYMENTS } from "./pancake-addresses";

/**
 * Withdraws every V3 position the caller holds for a given token, and collects the fees.
 *
 * Nothing here destroys anything: a token and its pool are immutable and permanent. This
 * only pulls your own liquidity out, leaving the pool empty and the price wherever the
 * last trade left it. Anyone else still holding the token is left with no market, so
 * check the holder list before running it on anything but a throwaway.
 *
 *   TOKEN=0x... DRY_RUN=1 npm run close:positions:mainnet
 *   TOKEN=0x... npm run close:positions:mainnet
 */

const env = (k: string, d?: string) => process.env[k] ?? d;

const TOKEN = env("TOKEN")!;
const DRY_RUN = env("DRY_RUN") === "1";
/// Burning the (now empty) position NFT refunds a little gas and tidies your wallet.
const BURN_EMPTY = env("BURN_EMPTY", "1") === "1";

const MAX_UINT128 = (1n << 128n) - 1n;

const PM_ABI = [
  "function WETH9() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function tokenOfOwnerByIndex(address,uint256) view returns (uint256)",
  "function positions(uint256) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)",
  "function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) payable returns (uint256 amount0,uint256 amount1)",
  "function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) payable returns (uint256 amount0,uint256 amount1)",
  "function burn(uint256) payable",
];
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

async function main() {
  if (!TOKEN) throw new Error("Set TOKEN to the token whose positions you want to close");

  const [signer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const deployment = DEPLOYMENTS[Number(net.chainId)];
  if (!deployment) throw new Error(`No deployment configured for chain ${net.chainId}`);

  const pm = new ethers.Contract(deployment.positionManager, PM_ABI, signer);
  const wbnb: string = await pm.WETH9();
  const token = new ethers.Contract(TOKEN, ERC20_ABI, ethers.provider);
  const symbol = await token.symbol();

  const wanted = new Set([TOKEN.toLowerCase(), wbnb.toLowerCase()]);

  console.log(`\nNetwork : ${deployment.label}`);
  console.log(`Wallet  : ${signer.address}`);
  console.log(`Token   : ${TOKEN} (${symbol})`);
  console.log(`Mode    : ${DRY_RUN ? "DRY RUN" : "LIVE — this broadcasts"}`);

  const count = Number(await pm.balanceOf(signer.address));
  console.log(`\nScanning ${count} position NFT(s)...`);

  const matches: { tokenId: bigint; liquidity: bigint; owed0: bigint; owed1: bigint }[] = [];
  for (let i = 0; i < count; i++) {
    const tokenId: bigint = await pm.tokenOfOwnerByIndex(signer.address, i);
    const p = await pm.positions(tokenId);
    if (!wanted.has(p.token0.toLowerCase()) || !wanted.has(p.token1.toLowerCase())) continue;
    console.log(
      `  #${tokenId}  fee ${p.fee}  ticks [${p.tickLower}, ${p.tickUpper}]  ` +
        `liquidity ${p.liquidity}  owed ${p.tokensOwed0}/${p.tokensOwed1}`
    );
    matches.push({ tokenId, liquidity: p.liquidity, owed0: p.tokensOwed0, owed1: p.tokensOwed1 });
  }

  if (matches.length === 0) {
    console.log("\nNo positions found for this pair on this wallet.");
    return;
  }

  if (DRY_RUN) {
    console.log(`\nDRY_RUN=1 — would close ${matches.length} position(s). Nothing broadcast.`);
    return;
  }

  const bnbBefore = await ethers.provider.getBalance(signer.address);
  const tokenBefore = await token.balanceOf(signer.address);
  const deadline = Math.floor(Date.now() / 1000) + 900;

  for (const m of matches) {
    console.log(`\nClosing #${m.tokenId}...`);
    if (m.liquidity > 0n) {
      // Minimums of zero: this is a withdrawal, not a trade, and a bound here would only
      // create a way for the call to fail on dust.
      const tx = await pm.decreaseLiquidity({
        tokenId: m.tokenId,
        liquidity: m.liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline,
      });
      await tx.wait();
      console.log(`  decreaseLiquidity ${tx.hash}`);
    }

    // collect() sweeps both the withdrawn principal and any accrued fees.
    const ctx = await pm.collect({
      tokenId: m.tokenId,
      recipient: signer.address,
      amount0Max: MAX_UINT128,
      amount1Max: MAX_UINT128,
    });
    await ctx.wait();
    console.log(`  collect ${ctx.hash}`);

    if (BURN_EMPTY) {
      try {
        const btx = await pm.burn(m.tokenId);
        await btx.wait();
        console.log(`  burn ${btx.hash}`);
      } catch (err: any) {
        console.log(`  burn skipped (${err.shortMessage ?? "not empty"})`);
      }
    }
  }

  const bnbAfter = await ethers.provider.getBalance(signer.address);
  const tokenAfter = await token.balanceOf(signer.address);
  const decimals = Number(await token.decimals());

  console.log("\nRecovered:");
  console.log(`  ${symbol}: ${ethers.formatUnits(tokenAfter - tokenBefore, decimals)}`);
  console.log(`  BNB    : ${ethers.formatEther(bnbAfter - bnbBefore)} (net of gas)`);
  console.log("\nThe token and pool still exist and always will — this only emptied them.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
