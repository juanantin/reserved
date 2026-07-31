import { ethers } from "hardhat";

// Removes all of the caller's liquidity from the PancakeSwap V2 pool created by
// create-pool.ts, sending both legs (token + BNB) back to the caller's wallet. Use
// this to unwind a self-funded mainnet dry run (see README's "Mainnet dry run"
// section) before deploying the real token.
const PANCAKE_ROUTER = process.env.PANCAKE_ROUTER || "0x10ED43C718714eb63d5aA57B78B54704E256024";
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || "";
const PAIR_ADDRESS = process.env.PAIR_ADDRESS || "";

const ROUTER_ABI = [
  "function removeLiquidityETH(address token, uint liquidity, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external returns (uint amountToken, uint amountETH)",
];
const PAIR_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
];

async function main() {
  if (!TOKEN_ADDRESS || !PAIR_ADDRESS) {
    throw new Error("Set TOKEN_ADDRESS and PAIR_ADDRESS env vars first (PAIR_ADDRESS is printed by create-pool.ts).");
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account configured — check contracts/.env.");
  }

  const pair = new ethers.Contract(PAIR_ADDRESS, PAIR_ABI, deployer);
  const router = new ethers.Contract(PANCAKE_ROUTER, ROUTER_ABI, deployer);

  const lpBalance: bigint = await pair.balanceOf(deployer.address);
  if (lpBalance === 0n) {
    throw new Error("This wallet holds no LP tokens for this pair — nothing to remove.");
  }
  console.log("Deployer:", deployer.address);
  console.log("LP tokens held:", ethers.formatUnits(lpBalance, 18));

  await (await pair.approve(PANCAKE_ROUTER, lpBalance)).wait();
  console.log("Approved router to spend LP tokens.");

  const deadline = Math.floor(Date.now() / 1000) + 60 * 10;
  const tx = await router.removeLiquidityETH(TOKEN_ADDRESS, lpBalance, 0, 0, deployer.address, deadline);
  const receipt = await tx.wait();
  console.log("removeLiquidityETH tx:", receipt.hash);
  console.log("Liquidity removed — both legs sent back to", deployer.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
