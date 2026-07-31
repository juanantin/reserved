import { ethers } from "hardhat";

// Live BSC testnet deployment from the first testnet deploy. Override via env vars
// (TOKEN_ADDRESS=... VAULT_ADDRESS=... npm run check:testnet) after a fresh deploy
// without having to edit this file.
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || "0x8761873C64C1fB8e8174b9Ee39f11FFe4a3D8883";
const VAULT_ADDRESS = process.env.VAULT_ADDRESS || "0x0Ec27569eb6Ac155aE18161DF1F5332c8f8900ea";

// Free public BSC testnet RPC endpoints load-balance across backend nodes that
// aren't always in sync, so a balanceOf() read immediately after a transaction
// confirms can hit a replica that hasn't caught up yet. Give it a moment.
const RPC_SETTLE_MS = 3000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account configured — check contracts/.env (see scripts/deploy.ts).");
  }

  // No typechain bindings (this repo compiles offline, bypassing hardhat's usual
  // compile->typechain pipeline — see scripts/offline-compile.js), so these are
  // untyped Contract handles rather than generated typed ones.
  const token: any = await ethers.getContractAt("ReservedToken", TOKEN_ADDRESS);
  const vault: any = await ethers.getContractAt("ReservedVault", VAULT_ADDRESS);

  console.log("Deployer:", deployer.address);
  console.log("Token:", TOKEN_ADDRESS);
  console.log("Vault:", VAULT_ADDRESS);

  // Two throwaway wallets standing in for a PancakeSwap pair and a buyer — testnet
  // has no real RSVD/USDT pool, so we register an EOA as the "pair" the same way
  // token.setAmmPair() would be pointed at a real pool address later.
  const pair = ethers.Wallet.createRandom().connect(ethers.provider);
  const buyer = ethers.Wallet.createRandom().connect(ethers.provider);
  console.log("\nSimulated pair address:", pair.address);
  console.log("Test buyer address:", buyer.address);

  const gasDrip = ethers.parseEther("0.003");
  await (await deployer.sendTransaction({ to: pair.address, value: gasDrip })).wait();
  await (await deployer.sendTransaction({ to: buyer.address, value: gasDrip })).wait();
  console.log("Funded pair + buyer with 0.003 tBNB each for gas");

  // 1. Register the simulated pair.
  await (await token.connect(deployer).setAmmPair(pair.address, true)).wait();
  console.log("\n[1] Registered pair as AMM pair: OK");

  // 2. Seed the pair with RSVD (deployer is tax-exempt, so this transfer is untaxed —
  // equivalent to adding initial liquidity).
  const seedAmount = ethers.parseUnits("10000", 18);
  await (await token.connect(deployer).transfer(pair.address, seedAmount)).wait();
  await sleep(RPC_SETTLE_MS);
  console.log(`[2] Seeded pair with ${ethers.formatUnits(seedAmount, 18)} RSVD`);

  // 3. BUY: pair -> buyer, should be taxed 3% to treasury.
  const buyAmount = ethers.parseUnits("1000", 18);
  const treasuryAddr = await token.treasury();
  const treasuryBeforeBuy: bigint = await token.balanceOf(treasuryAddr);
  await (await token.connect(pair).transfer(buyer.address, buyAmount)).wait();
  await sleep(RPC_SETTLE_MS);
  const buyerBal = await token.balanceOf(buyer.address);
  const treasuryAfterBuy: bigint = await token.balanceOf(treasuryAddr);
  const expectedBuyTax = (buyAmount * 300n) / 10000n;
  const buyPass = buyerBal === buyAmount - expectedBuyTax && treasuryAfterBuy - treasuryBeforeBuy === expectedBuyTax;
  console.log(`\n[3] BUY: pair -> buyer, ${ethers.formatUnits(buyAmount, 18)} RSVD`);
  console.log(`    buyer received ${ethers.formatUnits(buyerBal, 18)} (expected ${ethers.formatUnits(buyAmount - expectedBuyTax, 18)})`);
  console.log(`    treasury gained ${ethers.formatUnits(treasuryAfterBuy - treasuryBeforeBuy, 18)} (expected ${ethers.formatUnits(expectedBuyTax, 18)})`);
  console.log(`    BUY TAX: ${buyPass ? "PASS" : "FAIL"}`);

  // 4. SELL: buyer -> pair, should also be taxed 3%.
  const sellAmount = ethers.parseUnits("400", 18);
  const treasuryBeforeSell: bigint = await token.balanceOf(treasuryAddr);
  await (await token.connect(buyer).transfer(pair.address, sellAmount)).wait();
  await sleep(RPC_SETTLE_MS);
  const treasuryAfterSell: bigint = await token.balanceOf(treasuryAddr);
  const expectedSellTax = (sellAmount * 300n) / 10000n;
  const sellPass = treasuryAfterSell - treasuryBeforeSell === expectedSellTax;
  console.log(`\n[4] SELL: buyer -> pair, ${ethers.formatUnits(sellAmount, 18)} RSVD`);
  console.log(`    treasury gained ${ethers.formatUnits(treasuryAfterSell - treasuryBeforeSell, 18)} (expected ${ethers.formatUnits(expectedSellTax, 18)})`);
  console.log(`    SELL TAX: ${sellPass ? "PASS" : "FAIL"}`);
  await sleep(RPC_SETTLE_MS);

  // 5. BURN: buyer burns half their remaining RSVD directly.
  const buyerBalBeforeBurn: bigint = await token.balanceOf(buyer.address);
  const burnAmount = buyerBalBeforeBurn / 2n;
  const supplyBeforeBurn: bigint = await token.totalSupply();
  await (await token.connect(buyer).burn(burnAmount)).wait();
  await sleep(RPC_SETTLE_MS);
  const supplyAfterBurn: bigint = await token.totalSupply();
  const burnPass = supplyBeforeBurn - supplyAfterBurn === burnAmount;
  console.log(`\n[5] BURN: buyer burns ${ethers.formatUnits(burnAmount, 18)} RSVD`);
  console.log(`    total supply ${ethers.formatUnits(supplyBeforeBurn, 18)} -> ${ethers.formatUnits(supplyAfterBurn, 18)}`);
  console.log(`    BURN: ${burnPass ? "PASS" : "FAIL"}`);

  // 6. Deploy a mock bStock (testnet has no real Binance bStocks) and have the keeper
  // (deployer, per the default deploy config) deposit it into the vault.
  const Mock = await ethers.getContractFactory("MockERC20");
  const mockBStock: any = await Mock.deploy("Mock bNVDA", "mNVDAB");
  await mockBStock.waitForDeployment();
  const mockAddress = await mockBStock.getAddress();
  console.log(`\n[6] Deployed mock bStock (stand-in — testnet has no real bStocks): ${mockAddress}`);

  const depositAmount = ethers.parseUnits("1000", 18);
  await (await mockBStock.mint(deployer.address, depositAmount)).wait();
  await (await mockBStock.approve(VAULT_ADDRESS, depositAmount)).wait();
  await (await vault.connect(deployer).depositAsset(mockAddress, depositAmount)).wait();
  await sleep(RPC_SETTLE_MS);
  const vaultMockBal = await mockBStock.balanceOf(VAULT_ADDRESS);
  const depositPass = vaultMockBal === depositAmount;
  console.log(`    keeper deposited ${ethers.formatUnits(depositAmount, 18)} mock bStock into the vault`);
  console.log(`    vault's mock bStock balance: ${ethers.formatUnits(vaultMockBal, 18)}`);
  console.log(`    DEPOSIT: ${depositPass ? "PASS" : "FAIL"}`);
  await sleep(RPC_SETTLE_MS);

  // 7. REDEEM: buyer redeems all remaining RSVD for a pro-rata share of the mock bStock.
  // Compute the expected payout ourselves from one trusted "before" snapshot rather than
  // comparing against a separate previewRedeem() read — two independent reads can land on
  // different backend replicas on this public RPC and disagree by a few wei even when the
  // contract math is correct (same class of staleness as the buy/sell/burn checks above,
  // just visible here as a tiny mismatch instead of a stale zero).
  const buyerRsvdBal = await token.balanceOf(buyer.address);
  const supplyBeforeRedeem: bigint = await token.totalSupply();
  const vaultMockBalBeforeRedeem: bigint = await mockBStock.balanceOf(VAULT_ADDRESS);
  const expectedPayout = (vaultMockBalBeforeRedeem * buyerRsvdBal) / supplyBeforeRedeem;

  await (await token.connect(buyer).approve(VAULT_ADDRESS, buyerRsvdBal)).wait();
  await (await vault.connect(buyer).redeem(buyerRsvdBal)).wait();
  await sleep(RPC_SETTLE_MS);
  const buyerMockBalAfter = await mockBStock.balanceOf(buyer.address);
  const supplyAfterRedeem = await token.totalSupply();
  const buyerRsvdAfter = await token.balanceOf(buyer.address);
  const redeemPass = buyerMockBalAfter === expectedPayout && buyerRsvdAfter === 0n;
  console.log(`\n[7] REDEEM: buyer redeems ${ethers.formatUnits(buyerRsvdBal, 18)} RSVD`);
  console.log(`    buyer received mock bStock: ${ethers.formatUnits(buyerMockBalAfter, 18)} (expected ${ethers.formatUnits(expectedPayout, 18)})`);
  console.log(`    RSVD supply: ${ethers.formatUnits(supplyBeforeRedeem, 18)} -> ${ethers.formatUnits(supplyAfterRedeem, 18)}`);
  console.log(`    buyer RSVD balance after redeem: ${ethers.formatUnits(buyerRsvdAfter, 18)} (expected 0)`);
  console.log(`    REDEEM: ${redeemPass ? "PASS" : "FAIL"}`);

  const allPass = buyPass && sellPass && burnPass && depositPass && redeemPass;
  console.log(`\n${allPass ? "All checks passed." : "One or more checks FAILED — see above."}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
