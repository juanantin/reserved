const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mintInitialSupply } = require("./helpers/supply");

// A transfer tax and a Uniswap-V3-style pool can coexist, but only in one direction of
// bookkeeping.
//
// V3 pools measure their own balance across the swap callback and revert with "IIA"
// (Insufficient Input Amount) unless they received the full `amountIn`. Deducting the tax
// from a sell therefore leaves the pool short and every non-exempt sale reverts — which
// is what happened on RSVDTST, where only the tax-exempt deployer could sell.
//
// ReservedToken charges the sell tax ON TOP instead: the pool receives `value` whole, the
// treasury receives the skim, and the seller pays both. These tests hold that invariant
// open, because deducting instead would silently restore the honeypot.

const WAD = 10n ** 18n;
const SUPPLY = 1_000_000_000n * WAD;
const FEE = 2500;

async function deployFixture() {
  const [owner, treasury, alice, , , , , , , funder] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("ReservedToken");
  const token = await Token.deploy("Reserved", "RSVD", owner.address, treasury.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  await mintInitialSupply(token, owner.address, SUPPLY);

  const WBNB = await ethers.getContractFactory("MockWBNB");
  const wbnb = await WBNB.deploy();
  await wbnb.waitForDeployment();
  const wbnbAddress = await wbnb.getAddress();

  const Factory = await ethers.getContractFactory("MockUniswapV3Factory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();

  const Router = await ethers.getContractFactory("MockSwapRouter");
  const router = await Router.deploy(await factory.getAddress());
  await router.waitForDeployment();
  await router.setWETH9(wbnbAddress);
  await router.setRate(WAD / 10_000n);

  const [t0, t1] =
    BigInt(tokenAddress) < BigInt(wbnbAddress) ? [tokenAddress, wbnbAddress] : [wbnbAddress, tokenAddress];
  const Pool = await ethers.getContractFactory("MockUniswapV3Pool");
  const pool = await Pool.deploy(t0, t1, FEE, 50);
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();
  await factory.setPool(tokenAddress, wbnbAddress, FEE, poolAddress);

  await wbnb.connect(funder).deposit({ value: ethers.parseEther("20") });
  await wbnb.connect(funder).transfer(poolAddress, ethers.parseEther("20"));

  // Stock the pool with both legs. The owner is exempt, so this seeding transfer is
  // untaxed and lands whole — as it does at launch.
  await token.transfer(poolAddress, 10_000_000n * WAD);

  await token.setAmmPair(poolAddress, true);
  await token.transfer(alice.address, 1_000_000n * WAD);

  return { owner, treasury, alice, token, tokenAddress, wbnb, wbnbAddress, router, pool, poolAddress };
}

function sellParams(ctx, amountIn) {
  return {
    tokenIn: ctx.tokenAddress,
    tokenOut: ctx.wbnbAddress,
    fee: FEE,
    recipient: ctx.alice.address,
    deadline: Math.floor(Date.now() / 1000) + 600,
    amountIn,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0,
  };
}

describe("sell tax through a V3 pool", function () {
  const AMOUNT = 100_000n * WAD;
  const TAX = (AMOUNT * 300n) / 10_000n;

  it("a non-exempt holder can sell, and the pool receives the full input", async function () {
    const ctx = await deployFixture();
    expect(await ctx.token.isTaxExempt(ctx.alice.address)).to.equal(false);

    const poolBefore = await ctx.token.balanceOf(ctx.poolAddress);
    await ctx.token.connect(ctx.alice).approve(await ctx.router.getAddress(), AMOUNT);
    await expect(ctx.router.connect(ctx.alice).exactInputSingle(sellParams(ctx, AMOUNT))).to.not.be.reverted;

    // The whole point: short-changing the pool here is what produced IIA.
    expect((await ctx.token.balanceOf(ctx.poolAddress)) - poolBefore).to.equal(AMOUNT);
  });

  it("charges the seller the tax on top and credits the treasury", async function () {
    const ctx = await deployFixture();
    const aliceBefore = await ctx.token.balanceOf(ctx.alice.address);

    await ctx.token.connect(ctx.alice).approve(await ctx.router.getAddress(), AMOUNT);
    await ctx.router.connect(ctx.alice).exactInputSingle(sellParams(ctx, AMOUNT));

    expect(await ctx.token.balanceOf(ctx.treasury.address)).to.equal(TAX);
    expect(aliceBefore - (await ctx.token.balanceOf(ctx.alice.address))).to.equal(AMOUNT + TAX);
  });

  it("KNOWN LIMITATION: a holder cannot sell 100% of their balance", async function () {
    const ctx = await deployFixture();
    // Trim the holding first so the pool's WBNB inventory is not the binding constraint —
    // the point here is the token's balance requirement, not the mock's liquidity.
    const keep = 100_000n * WAD;
    await ctx.token.connect(ctx.alice).transfer(ctx.owner.address, (await ctx.token.balanceOf(ctx.alice.address)) - keep);
    const balance = await ctx.token.balanceOf(ctx.alice.address);

    await ctx.token.connect(ctx.alice).approve(await ctx.router.getAddress(), balance);
    await expect(
      ctx.router.connect(ctx.alice).exactInputSingle(sellParams(ctx, balance))
    ).to.be.revertedWithCustomError(ctx.token, "ERC20InsufficientBalance");

    // A max button has to offer at most 100/(1 + tax) of the balance; 97% is safely
    // inside that once integer rounding on both the split and the skim is accounted for.
    const sellable = (balance * 97n) / 100n;
    await expect(ctx.router.connect(ctx.alice).exactInputSingle(sellParams(ctx, sellable))).to.not.be.reverted;
  });

  it("buys stay deducted from the output, which the pool never inspects", async function () {
    const ctx = await deployFixture();
    await ctx.wbnb.connect(ctx.alice).deposit({ value: ethers.parseEther("1") });
    await ctx.wbnb.connect(ctx.alice).approve(await ctx.router.getAddress(), ethers.parseEther("1"));

    const before = await ctx.token.balanceOf(ctx.alice.address);
    await expect(
      ctx.router.connect(ctx.alice).exactInputSingle({
        ...sellParams(ctx, ethers.parseEther("1")),
        tokenIn: ctx.wbnbAddress,
        tokenOut: ctx.tokenAddress,
      })
    ).to.not.be.reverted;

    const received = (await ctx.token.balanceOf(ctx.alice.address)) - before;
    const treasury = await ctx.token.balanceOf(ctx.treasury.address);
    // Buyer got the output minus the skim; gross is the two together.
    expect(treasury).to.equal(((received + treasury) * 300n) / 10_000n);
  });

  it("an exempt seller pays nothing and the pool is still made whole", async function () {
    const ctx = await deployFixture();
    await ctx.token.setTaxExempt(ctx.alice.address, true);
    const poolBefore = await ctx.token.balanceOf(ctx.poolAddress);

    await ctx.token.connect(ctx.alice).approve(await ctx.router.getAddress(), AMOUNT);
    await ctx.router.connect(ctx.alice).exactInputSingle(sellParams(ctx, AMOUNT));

    expect((await ctx.token.balanceOf(ctx.poolAddress)) - poolBefore).to.equal(AMOUNT);
    expect(await ctx.token.balanceOf(ctx.treasury.address)).to.equal(0n);
  });
});
