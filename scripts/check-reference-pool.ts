import { ethers } from "hardhat";
import { DEPLOYMENTS } from "./pancake-addresses";

/**
 * Reads the native/stablecoin pool that UniswapV3TokenInitializer prices the launch
 * against, and reports whether its slot0 can be decoded by the initializer as written.
 *
 * UniswapV3TokenInitializer's IUniswapV3Pool declares `uint8 feeProtocol` — Uniswap V3's
 * shape. PancakeSwap V3 returns `uint32` there, packing feeProtocol0 | (feeProtocol1<<16).
 * Solidity's ABI decoder rejects a value that does not fit the declared type, so a
 * protocol fee above 255 makes _getInitialSqrtPriceX96 revert and takes the whole launch
 * with it. This tells you which case you are in, without spending anything.
 *
 *   POOL_FEE=2500 npm run check:pool:mainnet
 *
 * Check the fee tier you will actually launch with — feeProtocol is per pool.
 */

const POOL_FEE = Number(process.env.POOL_FEE || "2500");
const SLOT0_SELECTOR = "0x3850c7bd";
const UINT8_MAX = 255n;

const POSITION_MANAGER_ABI = [
  "function WETH9() view returns (address)",
  "function factory() view returns (address)",
];
const FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];

function word(raw: string, index: number): bigint {
  const start = 2 + index * 64;
  const hex = raw.slice(start, start + 64);
  if (hex.length < 64) throw new Error(`slot0 returned fewer than ${index + 1} words`);
  return BigInt("0x" + hex);
}

async function main() {
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const deployment = DEPLOYMENTS[chainId];
  if (!deployment) throw new Error(`No PancakeSwap deployment configured for chain ${chainId}`);

  console.log(`\nNetwork   : ${deployment.label} (chain ${chainId})`);
  console.log(`Fee tier  : ${POOL_FEE} (${POOL_FEE / 10_000}%)`);

  const pm = new ethers.Contract(deployment.positionManager, POSITION_MANAGER_ABI, ethers.provider);
  const wrappedNative: string = await pm.WETH9();
  const factoryAddress: string = await pm.factory();
  const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, ethers.provider);

  console.log(`Native    : ${wrappedNative}`);
  console.log(`Stablecoin: ${deployment.stablecoin}`);
  console.log(`Factory   : ${factoryAddress}`);

  const pool: string = await factory.getPool(wrappedNative, deployment.stablecoin, POOL_FEE);
  if (pool === ethers.ZeroAddress) {
    console.log(`\nFAIL: no native/stablecoin pool exists at fee tier ${POOL_FEE}.`);
    console.log("The initializer reads its reference price from that pool, so the launch");
    console.log("would revert. Pick a tier where the pair exists.");
    process.exitCode = 1;
    return;
  }
  console.log(`Pool      : ${pool}`);

  const raw = await ethers.provider.call({ to: pool, data: SLOT0_SELECTOR });
  const sqrtPriceX96 = word(raw, 0);
  const feeProtocol = word(raw, 5);

  console.log(`\nsqrtPriceX96 : ${sqrtPriceX96}`);
  console.log(`feeProtocol  : ${feeProtocol}`);

  if (feeProtocol > UINT8_MAX) {
    console.log(`\nBLOCKER: feeProtocol (${feeProtocol}) does not fit in uint8.`);
    console.log("UniswapV3TokenInitializer declares `uint8 feeProtocol` in IUniswapV3Pool,");
    console.log("so decoding this pool's slot0 reverts and the launch fails at its first step.");
    console.log("Fix: widen that field to `uint32`. A Uniswap pool's uint8 return decodes");
    console.log("cleanly as uint32, so the wider type is correct against both DEXes.");
    process.exitCode = 1;
    return;
  }

  if (feeProtocol === 0n) {
    console.log("\nOK: feeProtocol is zero, so the uint8 declaration decodes today.");
  } else {
    console.log(`\nOK FOR NOW: feeProtocol is ${feeProtocol}, which still fits in uint8.`);
  }
  console.log("This is a live reading, not a guarantee — PancakeSwap can change a pool's");
  console.log("protocol fee at any time, and a value above 255 breaks the launch path.");
  console.log("Widening the field to uint32 removes the dependency entirely.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
