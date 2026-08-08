const { expect } = require("chai");
const { ethers } = require("hardhat");

const FIXED_SUPPLY = ethers.parseUnits("1000000000", 18); // 1B RSVD

async function deployBare() {
  const [owner, treasury, alice] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("ReservedToken");
  const token = await Token.deploy("Reserved", "RSVD", owner.address, treasury.address);
  await token.waitForDeployment();

  const Initializer = await ethers.getContractFactory("MockSupplyInitializer");
  const initializer = await Initializer.deploy();
  await initializer.waitForDeployment();

  const call = (fn, args) => initializer.interface.encodeFunctionData(fn, args);
  return { token, initializer, call, owner, treasury, alice };
}

describe("ReservedToken.postDeploy", function () {
  it("deploys with no supply at all — the constructor no longer mints", async function () {
    const { token, owner } = await deployBare();
    expect(await token.totalSupply()).to.equal(0n);
    expect(await token.balanceOf(owner.address)).to.equal(0n);
  });

  it("runs the initializer against the token's own storage, not the initializer's", async function () {
    const { token, initializer, call, owner } = await deployBare();
    await token.postDeploy(await initializer.getAddress(), call("mintTo", [owner.address, FIXED_SUPPLY]));

    expect(await token.totalSupply()).to.equal(FIXED_SUPPLY);
    expect(await token.balanceOf(owner.address)).to.equal(FIXED_SUPPLY);
    // The initializer's own storage must be untouched — it only lent its code.
    expect(await initializer.taxBps()).to.equal(0n);
  });

  it("preserves the constructor's tax settings across the delegatecall", async function () {
    const { token, initializer, call, owner, treasury } = await deployBare();
    await token.postDeploy(await initializer.getAddress(), call("mintTo", [owner.address, FIXED_SUPPLY]));

    expect(await token.taxBps()).to.equal(300n);
    expect(await token.treasury()).to.equal(treasury.address);
    expect(await token.owner()).to.equal(owner.address);
    expect(await token.isTaxExempt(owner.address)).to.equal(true);
  });

  it("is owner-only", async function () {
    const { token, initializer, call, alice, owner } = await deployBare();
    await expect(
      token.connect(alice).postDeploy(await initializer.getAddress(), call("mintTo", [owner.address, FIXED_SUPPLY]))
    ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
  });

  it("bubbles up the initializer's revert reason instead of failing silently", async function () {
    const { token, initializer, call } = await deployBare();
    await expect(token.postDeploy(await initializer.getAddress(), call("boom", []))).to.be.revertedWith(
      "initializer exploded"
    );
  });

  it("closes once the initializer has minted a supply", async function () {
    const { token, initializer, call, owner } = await deployBare();
    const addr = await initializer.getAddress();
    await token.postDeploy(addr, call("mintTo", [owner.address, FIXED_SUPPLY]));

    await expect(token.postDeploy(addr, call("mintTo", [owner.address, FIXED_SUPPLY]))).to.be.reverted;
  });

  // The next three tests document behaviour that is currently accepted, not desired.
  // They exist so that if postDeploy is ever removed or fenced in, these fail loudly
  // and force a deliberate decision rather than silently passing.
  it("KNOWN RISK: stays open indefinitely while a payload leaves totalSupply at zero", async function () {
    const { token, initializer, call } = await deployBare();
    const addr = await initializer.getAddress();

    await token.postDeploy(addr, call("noop", []));
    await token.postDeploy(addr, call("noop", []));
    await token.postDeploy(addr, call("noop", []));

    expect(await token.totalSupply()).to.equal(0n);
    // Still callable — the guard reads mutable state, it is not a one-shot latch.
    await expect(token.postDeploy(addr, call("noop", []))).to.not.be.reverted;
  });

  it("KNOWN RISK: MAX_TAX_BPS is not enforceable while postDeploy is reachable", async function () {
    const { token, initializer, call } = await deployBare();

    await expect(token.setTaxBps(9_000)).to.be.revertedWithCustomError(token, "TaxTooHigh");

    await token.postDeploy(await initializer.getAddress(), call("setTaxBpsRaw", [9_000]));
    expect(await token.taxBps()).to.equal(9_000n);
    expect(await token.MAX_TAX_BPS()).to.equal(500n);
  });

  it("KNOWN RISK: Ownable2Step's accept step is bypassable while postDeploy is reachable", async function () {
    const { token, initializer, call, alice } = await deployBare();

    await token.transferOwnership(alice.address);
    expect(await token.owner()).to.not.equal(alice.address); // not accepted yet

    await token.postDeploy(await initializer.getAddress(), call("setOwnerRaw", [alice.address]));
    expect(await token.owner()).to.equal(alice.address);
  });
});
