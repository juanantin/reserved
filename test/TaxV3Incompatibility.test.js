const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mintInitialSupply } = require("./helpers/supply");

// A transfer tax and a Uniswap-V3-style pool cannot both work on the sell side.
//
// V3 pools verify inside the swap callback that they actually received `amountIn`, and
// revert with "IIA" (Insufficient Input Amount) otherwise. ReservedToken skims 3% on a
// transfer into a registered AMM pair, so the pool is short by exactly the tax and the
// sale reverts. There is no supportingFeeOnTransferTokens variant on V3 — that function
// exists on the V2 router precisely because V2 tolerates this and V3 does not.
//
// Buys are unaffected: on a buy the taxed leg is pool -> buyer, and the pool only checks
// what it RECEIVES (WBNB, untaxed). So the token buys fine and sells revert, which is
// the exact signature every honeypot detector looks for.

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

  // The pool is a registered AMM pair, exactly as init leaves it after a launch.
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

describe("transfer tax vs V3 pools", function () {
  const AMOUNT = 100_000n * WAD;

  it("BLOCKER: a non-exempt holder cannot sell — the pool reverts with IIA", async function () {
    const ctx = await deployFixture();
    expect(await ctx.token.isTaxExempt(ctx.alice.address)).to.equal(false);

    await ctx.token.connect(ctx.alice).approve(await ctx.router.getAddress(), AMOUNT);
    await expect(
      ctx.router.connect(ctx.alice).exactInputSingle(sellParams(ctx, AMOUNT))
    ).to.be.revertedWith("IIA");
  });

  it("the same sale succeeds once that holder is tax exempt", async function () {
    const ctx = await deployFixture();
    await ctx.token.setTaxExempt(ctx.alice.address, true);

    await ctx.token.connect(ctx.alice).approve(await ctx.router.getAddress(), AMOUNT);
    await expect(ctx.router.connect(ctx.alice).exactInputSingle(sellParams(ctx, AMOUNT))).to.not.be.reverted;
  });

  it("which is why the deployer can sell and nobody else can", async function () {
    const ctx = await deployFixture();
    // The constructor marks the initial owner exempt, so the one account that tests the
    // launch is the one account for which selling works.
    expect(await ctx.token.isTaxExempt(ctx.owner.address)).to.equal(true);

    await ctx.token.approve(await ctx.router.getAddress(), AMOUNT);
    await expect(ctx.router.exactInputSingle({ ...sellParams(ctx, AMOUNT), recipient: ctx.owner.address })).to.not.be
      .reverted;
  });

  it("buys are unaffected, because the pool only checks what it receives", async function () {
    const ctx = await deployFixture();
    // Fund alice with WBNB and buy: the taxed leg is pool -> alice, which the pool's
    // input accounting never inspects.
    await ctx.wbnb.connect(ctx.alice).deposit({ value: ethers.parseEther("1") });
    await ctx.wbnb.connect(ctx.alice).approve(await ctx.router.getAddress(), ethers.parseEther("1"));

    await expect(
      ctx.router.connect(ctx.alice).exactInputSingle({
        ...sellParams(ctx, ethers.parseEther("1")),
        tokenIn: ctx.wbnbAddress,
        tokenOut: ctx.tokenAddress,
      })
    ).to.not.be.reverted;

    // And the buy WAS taxed — the treasury took its 3% out of alice's proceeds.
    expect(await ctx.token.balanceOf(ctx.treasury.address)).to.be.greaterThan(0n);
  });
});
