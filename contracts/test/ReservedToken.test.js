const { expect } = require("chai");
const { ethers } = require("hardhat");

const FIXED_SUPPLY = ethers.parseUnits("1000000000", 18); // 1B RSVD

async function deployToken() {
  const [owner, treasury, pair, alice, bob] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("ReservedToken");
  const token = await Token.deploy("Reserved", "RSVD", FIXED_SUPPLY, owner.address, treasury.address);
  await token.waitForDeployment();
  return { token, owner, treasury, pair, alice, bob };
}

describe("ReservedToken", function () {
  it("mints the fixed supply to the initial owner and no more can ever be minted", async function () {
    const { token, owner } = await deployToken();
    expect(await token.totalSupply()).to.equal(FIXED_SUPPLY);
    expect(await token.balanceOf(owner.address)).to.equal(FIXED_SUPPLY);
    expect(token.mint).to.be.undefined;
  });

  it("does not tax plain wallet-to-wallet transfers", async function () {
    const { token, owner, alice, bob } = await deployToken();
    await token.connect(owner).transfer(alice.address, ethers.parseUnits("1000", 18));
    await token.connect(alice).transfer(bob.address, ethers.parseUnits("400", 18));
    expect(await token.balanceOf(bob.address)).to.equal(ethers.parseUnits("400", 18));
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("600", 18));
  });

  it("taxes buys (transfer from a registered AMM pair) at the configured rate", async function () {
    const { token, owner, treasury, pair, alice } = await deployToken();
    await token.connect(owner).setAmmPair(pair.address, true);
    await token.connect(owner).transfer(pair.address, ethers.parseUnits("10000", 18));

    const buyAmount = ethers.parseUnits("1000", 18);
    await token.connect(pair).transfer(alice.address, buyAmount);

    const expectedTax = (buyAmount * 300n) / 10000n; // 3%
    expect(await token.balanceOf(alice.address)).to.equal(buyAmount - expectedTax);
    expect(await token.balanceOf(treasury.address)).to.equal(expectedTax);
  });

  it("taxes sells (transfer to a registered AMM pair) at the configured rate", async function () {
    const { token, owner, treasury, pair, alice } = await deployToken();
    await token.connect(owner).setAmmPair(pair.address, true);
    const startAmount = ethers.parseUnits("1000", 18);
    await token.connect(owner).transfer(alice.address, startAmount);

    const sellAmount = ethers.parseUnits("400", 18);
    await token.connect(alice).transfer(pair.address, sellAmount);

    const expectedTax = (sellAmount * 300n) / 10000n;
    expect(await token.balanceOf(pair.address)).to.equal(sellAmount - expectedTax);
    expect(await token.balanceOf(treasury.address)).to.equal(expectedTax);
    expect(await token.balanceOf(alice.address)).to.equal(startAmount - sellAmount);
  });

  it("does not tax exempt accounts even when touching a pair", async function () {
    const { token, owner, treasury, pair, alice } = await deployToken();
    await token.connect(owner).setAmmPair(pair.address, true);
    await token.connect(owner).setTaxExempt(alice.address, true);
    await token.connect(owner).transfer(pair.address, ethers.parseUnits("10000", 18));

    const buyAmount = ethers.parseUnits("500", 18);
    await token.connect(pair).transfer(alice.address, buyAmount);

    expect(await token.balanceOf(alice.address)).to.equal(buyAmount);
    expect(await token.balanceOf(treasury.address)).to.equal(0n);
  });

  it("lets the owner adjust the tax rate but never above the hard cap", async function () {
    const { token, owner } = await deployToken();
    await token.connect(owner).setTaxBps(500);
    expect(await token.taxBps()).to.equal(500n);

    await expect(token.connect(owner).setTaxBps(501)).to.be.revertedWithCustomError(token, "TaxTooHigh");
  });

  it("only the owner can change tax rate, pairs, exemptions, or treasury", async function () {
    const { token, alice, pair, treasury } = await deployToken();
    await expect(token.connect(alice).setTaxBps(100)).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    await expect(token.connect(alice).setAmmPair(pair.address, true)).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    await expect(token.connect(alice).setTaxExempt(alice.address, true)).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    await expect(token.connect(alice).setTreasury(treasury.address)).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
  });

  it("supports burn-on-redeem: holders can burn their own tokens, reducing total supply", async function () {
    const { token, owner, alice } = await deployToken();
    await token.connect(owner).transfer(alice.address, ethers.parseUnits("1000", 18));
    await token.connect(alice).burn(ethers.parseUnits("300", 18));
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("700", 18));
    expect(await token.totalSupply()).to.equal(FIXED_SUPPLY - ethers.parseUnits("300", 18));
  });

  it("supports burnFrom with an allowance, as used by the vault on redeem", async function () {
    const { token, owner, alice, bob } = await deployToken();
    await token.connect(owner).transfer(alice.address, ethers.parseUnits("1000", 18));
    await token.connect(alice).approve(bob.address, ethers.parseUnits("300", 18));
    await token.connect(bob).burnFrom(alice.address, ethers.parseUnits("300", 18));
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("700", 18));
    expect(await token.totalSupply()).to.equal(FIXED_SUPPLY - ethers.parseUnits("300", 18));
  });

  it("ownership transfer requires the new owner to accept (Ownable2Step)", async function () {
    const { token, owner, alice, bob } = await deployToken();

    await token.connect(owner).transferOwnership(alice.address);
    expect(await token.owner()).to.equal(owner.address);
    expect(await token.pendingOwner()).to.equal(alice.address);
    await expect(token.connect(alice).setTaxBps(100)).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");

    await expect(token.connect(bob).acceptOwnership()).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");

    await token.connect(alice).acceptOwnership();
    expect(await token.owner()).to.equal(alice.address);
    await expect(token.connect(owner).setTaxBps(100)).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
  });
});
