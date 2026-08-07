import { ethers } from "hardhat";

// Exercises buy/sell/tax/burn/redeem against the live mainnet pool using a
// SECOND wallet you control (SECOND_WALLET_PRIVATE_KEY), separate from the
// deployer — never paste a mainnet private key into chat; set this directly
// in contracts/.env on your machine. Fund that second wallet with a little
// BNB for gas plus whatever you want to test-buy with before running this.
//
// Uses PancakeSwap's fee-on-transfer-safe swap functions
// (...SupportingFeeOnTransferTokens): RSVDTEST's buy/sell tax means the pair
// receives/sends less than the router's naive amountIn/amountOut, so the
// plain swap functions would revert with "PancakeSwap: K" on the sell leg.
const PANCAKE_ROUTER = process.env.PANCAKE_ROUTER || "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || "";
const VAULT_ADDRESS = process.env.VAULT_ADDRESS || "";
const BUY_BNB_AMOUNT = process.env.BUY_BNB_AMOUNT || "0.005";
const SELL_FRACTION_BPS = 5000n; // sell back half of what was bought

const RPC_SETTLE_MS = 3000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ROUTER_ABI = [
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) external payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) external",
  "function WETH() external pure returns (address)",
];

async function main() {
  if (!TOKEN_ADDRESS || !VAULT_ADDRESS) {
    throw new Error("Set TOKEN_ADDRESS and VAULT_ADDRESS env vars first.");
  }
  const secondKey = process.env.SECOND_WALLET_PRIVATE_KEY;
  if (!secondKey) {
    throw new Error(
      "Set SECOND_WALLET_PRIVATE_KEY (in contracts/.env, never in chat) to a second wallet you control, funded with a bit of BNB."
    );
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account configured — check contracts/.env.");
  }
  const buyer = new ethers.Wallet(secondKey, ethers.provider);

  const token: any = await ethers.getContractAt("ReservedToken", TOKEN_ADDRESS);
  const vault: any = await ethers.getContractAt("ReservedVault", VAULT_ADDRESS);
  const router = new ethers.Contract(PANCAKE_ROUTER, ROUTER_ABI, buyer);

  console.log("Deployer:", deployer.address);
  console.log("Second wallet (buyer):", buyer.address);
  console.log("Token:", TOKEN_ADDRESS);
  console.log("Vault:", VAULT_ADDRESS);

  const buyerBnbBal = await ethers.provider.getBalance(buyer.address);
  console.log(`Second wallet BNB balance: ${ethers.formatEther(buyerBnbBal)}`);

  const treasuryAddr = await token.treasury();
  const wbnb: string = await router.WETH();

  // 1. BUY: BNB -> RSVDTEST, taxed.
  const treasuryBeforeBuy: bigint = await token.balanceOf(treasuryAddr);
  const buyerTokenBeforeBuy: bigint = await token.balanceOf(buyer.address);
  await (
    await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
      0,
      [wbnb, TOKEN_ADDRESS],
      buyer.address,
      Math.floor(Date.now() / 1000) + 600,
      { value: ethers.parseEther(BUY_BNB_AMOUNT) }
    )
  ).wait();
  await sleep(RPC_SETTLE_MS);
  const treasuryAfterBuy: bigint = await token.balanceOf(treasuryAddr);
  const buyerTokenAfterBuy: bigint = await token.balanceOf(buyer.address);
  const tokensReceived = buyerTokenAfterBuy - buyerTokenBeforeBuy;
  console.log(`\n[1] BUY: spent ${BUY_BNB_AMOUNT} BNB`);
  console.log(`    second wallet received ${ethers.formatUnits(tokensReceived, 18)} RSVDTEST`);
  console.log(`    treasury gained ${ethers.formatUnits(treasuryAfterBuy - treasuryBeforeBuy, 18)} RSVDTEST (tax)`);

  // 2. SELL: sell back half, taxed.
  const sellAmount = (tokensReceived * SELL_FRACTION_BPS) / 10000n;
  await (await token.connect(buyer).approve(PANCAKE_ROUTER, sellAmount)).wait();
  await sleep(RPC_SETTLE_MS);
  const treasuryBeforeSell: bigint = await token.balanceOf(treasuryAddr);
  await (
    await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
      sellAmount,
      0,
      [TOKEN_ADDRESS, wbnb],
      buyer.address,
      Math.floor(Date.now() / 1000) + 600
    )
  ).wait();
  await sleep(RPC_SETTLE_MS);
  const treasuryAfterSell: bigint = await token.balanceOf(treasuryAddr);
  console.log(`\n[2] SELL: sold back ${ethers.formatUnits(sellAmount, 18)} RSVDTEST`);
  console.log(`    treasury gained ${ethers.formatUnits(treasuryAfterSell - treasuryBeforeSell, 18)} RSVDTEST (tax)`);

  // 3. BURN: burn a quarter of what's left directly.
  const buyerBalBeforeBurn: bigint = await token.balanceOf(buyer.address);
  const burnAmount = buyerBalBeforeBurn / 4n;
  const supplyBeforeBurn: bigint = await token.totalSupply();
  await (await token.connect(buyer).burn(burnAmount)).wait();
  await sleep(RPC_SETTLE_MS);
  const supplyAfterBurn: bigint = await token.totalSupply();
  console.log(`\n[3] BURN: burned ${ethers.formatUnits(burnAmount, 18)} RSVDTEST`);
  console.log(`    supply ${ethers.formatUnits(supplyBeforeBurn, 18)} -> ${ethers.formatUnits(supplyAfterBurn, 18)}`);

  // 4. Deposit a mock bStock as a stand-in (real bStock acquisition is the
  // not-yet-built keeper's job) so redeem() has something real to pay out.
  const Mock = await ethers.getContractFactory("MockERC20");
  const mockBStock: any = await Mock.deploy("Mock bNVDA", "mNVDAB");
  await mockBStock.waitForDeployment();
  const mockAddress = await mockBStock.getAddress();
  const depositAmount = ethers.parseUnits("1000", 18);
  await (await mockBStock.mint(deployer.address, depositAmount)).wait();
  await (await mockBStock.approve(VAULT_ADDRESS, depositAmount)).wait();
  await (await vault.connect(deployer).depositAsset(mockAddress, depositAmount)).wait();
  await sleep(RPC_SETTLE_MS);
  console.log(`\n[4] Deployed mock bStock ${mockAddress} and deposited ${ethers.formatUnits(depositAmount, 18)} into the vault`);

  // 5. REDEEM: second wallet redeems all remaining RSVDTEST.
  const buyerRsvdBal: bigint = await token.balanceOf(buyer.address);
  const supplyBeforeRedeem: bigint = await token.totalSupply();
  const vaultMockBalBeforeRedeem: bigint = await mockBStock.balanceOf(VAULT_ADDRESS);
  const expectedPayout = (vaultMockBalBeforeRedeem * buyerRsvdBal) / supplyBeforeRedeem;

  await (await token.connect(buyer).approve(VAULT_ADDRESS, buyerRsvdBal)).wait();
  await (await vault.connect(buyer).redeem(buyerRsvdBal)).wait();
  await sleep(RPC_SETTLE_MS);
  const buyerMockBalAfter: bigint = await mockBStock.balanceOf(buyer.address);
  const buyerRsvdAfter: bigint = await token.balanceOf(buyer.address);
  console.log(`\n[5] REDEEM: redeemed ${ethers.formatUnits(buyerRsvdBal, 18)} RSVDTEST`);
  console.log(`    received mock bStock: ${ethers.formatUnits(buyerMockBalAfter, 18)} (expected ${ethers.formatUnits(expectedPayout, 18)})`);
  console.log(`    remaining RSVDTEST balance: ${ethers.formatUnits(buyerRsvdAfter, 18)} (expected 0)`);

  console.log(
    "\nDone. Tax should be ~3% on both buy and sell, burn should cut supply by exactly the burn amount, " +
      "and redeem should zero out the second wallet's RSVDTEST balance while paying out the expected mock bStock."
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
