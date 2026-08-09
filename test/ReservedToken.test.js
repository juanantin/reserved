const { expect } = require("chai");
const { ethers } = require("hardhat");

// ReservedToken is deliberately a plain ERC20 now. Most of what this file used to assert
// — tax rates, AMM pair registration, exemptions, pausing, an owner-only delegatecall —
// tested behaviour that no longer exists. What remains is the contract's actual promise:
// a fixed supply minted once, burnable for vault redemption, and no way for anyone to
// change anything afterwards.

const FIXED_SUPPLY = ethers.parseUnits("1000000000", 18); // 1B RSVD

async function deployToken() {
  const [owner, alice, bob] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("ReservedToken");
  const token = await Token.deploy("Reserved", "RSVD", FIXED_SUPPLY, owner.address);
  await token.waitForDeployment();
  return { token, owner, alice, bob };
}

describe("ReservedToken", function () {
  it("mints the whole supply once, to the recipient", async function () {
    const { token, owner } = await deployToken();
    expect(await token.totalSupply()).to.equal(FIXED_SUPPLY);
    expect(await token.balanceOf(owner.address)).to.equal(FIXED_SUPPLY);
    expect(await token.name()).to.equal("Reserved");
    expect(await token.symbol()).to.equal("RSVD");
    expect(await token.decimals()).to.equal(18);
  });

  it("rejects a zero recipient or a zero supply", async function () {
    const Token = await ethers.getContractFactory("ReservedToken");
    await expect(
      Token.deploy("Reserved", "RSVD", FIXED_SUPPLY, ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(Token, "ZeroAddress");
    await expect(
      Token.deploy("Reserved", "RSVD", 0, (await ethers.getSigners())[0].address)
    ).to.be.revertedWithCustomError(Token, "ZeroSupply");
  });

  it("exposes no owner, no mint and no privileged entry point at all", async function () {
    const { token } = await deployToken();
    for (const fn of [
      "owner",
      "mint",
      "pause",
      "unpause",
      "setTaxBps",
      "setTreasury",
      "setAmmPair",
      "setTaxExempt",
      "postDeploy",
      "transferOwnership",
    ]) {
      expect(token[fn], `${fn} should not exist`).to.equal(undefined);
    }

    // Everything the ABI does expose is either ERC20 or ERC20Burnable.
    const allowed = new Set([
      "name", "symbol", "decimals", "totalSupply", "balanceOf", "transfer",
      "allowance", "approve", "transferFrom", "burn", "burnFrom",
    ]);
    const exposed = token.interface.fragments
      .filter((f) => f.type === "function")
      .map((f) => f.name);
    expect(exposed.filter((n) => !allowed.has(n))).to.deep.equal([]);
  });

  it("transfers the full amount — no skim on any counterparty", async function () {
    const { token, owner, alice, bob } = await deployToken();
    const amount = ethers.parseUnits("1000", 18);

    await token.transfer(alice.address, amount);
    expect(await token.balanceOf(alice.address)).to.equal(amount);

    // Including into a contract, which a pair would have been.
    await token.connect(alice).transfer(bob.address, amount);
    expect(await token.balanceOf(bob.address)).to.equal(amount);
    expect(await token.balanceOf(alice.address)).to.equal(0n);
  });

  it("lets a holder move their entire balance, which the taxed version could not", async function () {
    const { token, owner, alice } = await deployToken();
    const amount = ethers.parseUnits("1000", 18);
    await token.transfer(alice.address, amount);

    await expect(token.connect(alice).transfer(owner.address, amount)).to.not.be.reverted;
    expect(await token.balanceOf(alice.address)).to.equal(0n);
  });

  it("burns, reducing total supply — the mechanic ReservedVault.redeem needs", async function () {
    const { token, owner, alice } = await deployToken();
    const amount = ethers.parseUnits("300", 18);
    await token.transfer(alice.address, amount);

    await token.connect(alice).burn(amount);
    expect(await token.totalSupply()).to.equal(FIXED_SUPPLY - amount);
    expect(await token.balanceOf(alice.address)).to.equal(0n);
  });

  it("supports burnFrom with an allowance, as the vault uses on redeem", async function () {
    const { token, owner, alice, bob } = await deployToken();
    const amount = ethers.parseUnits("300", 18);
    await token.transfer(alice.address, amount);
    await token.connect(alice).approve(bob.address, amount);

    await token.connect(bob).burnFrom(alice.address, amount);
    expect(await token.totalSupply()).to.equal(FIXED_SUPPLY - amount);
  });
});
