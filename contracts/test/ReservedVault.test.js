const { expect } = require("chai");
const { ethers } = require("hardhat");

const FIXED_SUPPLY = ethers.parseUnits("1000000000", 18); // 1B RSVD

async function deploySystem() {
  const [owner, treasury, keeper, alice, bob] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("ReservedToken");
  const token = await Token.deploy("Reserved", "RSVD", FIXED_SUPPLY, owner.address, treasury.address);
  await token.waitForDeployment();

  const Vault = await ethers.getContractFactory("ReservedVault");
  const vault = await Vault.deploy(await token.getAddress(), owner.address, keeper.address);
  await vault.waitForDeployment();

  const Mock = await ethers.getContractFactory("MockERC20");
  const nvdab = await Mock.deploy("bNVDA", "NVDAB");
  await nvdab.waitForDeployment();
  const tslab = await Mock.deploy("bTSLA", "TSLAB");
  await tslab.waitForDeployment();

  return { token, vault, nvdab, tslab, owner, treasury, keeper, alice, bob };
}

async function depositAsset(vault, mock, keeper, amount) {
  await mock.mint(keeper.address, amount);
  await mock.connect(keeper).approve(await vault.getAddress(), amount);
  await vault.connect(keeper).depositAsset(await mock.getAddress(), amount);
}

describe("ReservedVault", function () {
  it("only the keeper (or owner) can deposit reserve assets", async function () {
    const { vault, nvdab, alice } = await deploySystem();
    await nvdab.mint(alice.address, 100n);
    await nvdab.connect(alice).approve(await vault.getAddress(), 100n);
    await expect(vault.connect(alice).depositAsset(await nvdab.getAddress(), 100n)).to.be.revertedWithCustomError(
      vault,
      "NotKeeper"
    );
  });

  it("registers a new reserve asset on first deposit and tracks its balance", async function () {
    const { vault, nvdab, keeper } = await deploySystem();
    await depositAsset(vault, nvdab, keeper, ethers.parseUnits("1000", 18));

    expect(await vault.reserveAssetCount()).to.equal(1n);
    expect(await vault.isReserveAsset(await nvdab.getAddress())).to.equal(true);

    const [tokens, balances] = await vault.getReserveBalances();
    expect(tokens[0]).to.equal(await nvdab.getAddress());
    expect(balances[0]).to.equal(ethers.parseUnits("1000", 18));
  });

  it("lets a holder redeem RSVD for a pro-rata share of every reserve asset", async function () {
    const { token, vault, nvdab, tslab, owner, keeper, alice } = await deploySystem();

    // Vault holds 1000 NVDAB and 500 TSLAB.
    await depositAsset(vault, nvdab, keeper, ethers.parseUnits("1000", 18));
    await depositAsset(vault, tslab, keeper, ethers.parseUnits("500", 18));

    // Alice holds 1% of total RSVD supply (10,000,000 / 1,000,000,000).
    const aliceAmount = ethers.parseUnits("10000000", 18);
    await token.connect(owner).transfer(alice.address, aliceAmount);

    await token.connect(alice).approve(await vault.getAddress(), aliceAmount);
    await vault.connect(alice).redeem(aliceAmount);

    // 1% of 1000 NVDAB = 10, 1% of 500 TSLAB = 5.
    expect(await nvdab.balanceOf(alice.address)).to.equal(ethers.parseUnits("10", 18));
    expect(await tslab.balanceOf(alice.address)).to.equal(ethers.parseUnits("5", 18));

    // RSVD was burned, not transferred to the vault.
    expect(await token.balanceOf(alice.address)).to.equal(0n);
    expect(await token.totalSupply()).to.equal(FIXED_SUPPLY - aliceAmount);
  });

  it("computes payouts against supply before the burn, so sequential redeemers both get their fair share", async function () {
    const { token, vault, nvdab, owner, keeper, alice, bob } = await deploySystem();
    await depositAsset(vault, nvdab, keeper, ethers.parseUnits("1000", 18));

    const share = ethers.parseUnits("10000000", 18); // 1% each
    await token.connect(owner).transfer(alice.address, share);
    await token.connect(owner).transfer(bob.address, share);

    await token.connect(alice).approve(await vault.getAddress(), share);
    await vault.connect(alice).redeem(share);
    expect(await nvdab.balanceOf(alice.address)).to.equal(ethers.parseUnits("10", 18));

    await token.connect(bob).approve(await vault.getAddress(), share);
    await vault.connect(bob).redeem(share);
    // Proportional redemption is neutral to the bStock-per-RSVD ratio: the vault balance
    // and total supply shrink by the same fraction, so Bob's payout equals Alice's even
    // though he redeemed against a smaller post-Alice supply. The ratio only rises when
    // the keeper deposits new bStocks without a matching burn (the "rising floor").
    const bobBalance = await nvdab.balanceOf(bob.address);
    expect(bobBalance).to.equal(ethers.parseUnits("10", 18));
  });

  it("previewRedeem matches the actual redeem payout without mutating state", async function () {
    const { token, vault, nvdab, owner, keeper, alice } = await deploySystem();
    await depositAsset(vault, nvdab, keeper, ethers.parseUnits("1000", 18));

    const amount = ethers.parseUnits("10000000", 18);
    await token.connect(owner).transfer(alice.address, amount);

    const [tokens, previewAmounts] = await vault.previewRedeem(amount);

    await token.connect(alice).approve(await vault.getAddress(), amount);
    await vault.connect(alice).redeem(amount);

    expect(await nvdab.balanceOf(alice.address)).to.equal(previewAmounts[0]);
    expect(tokens[0]).to.equal(await nvdab.getAddress());
  });

  it("reverts a redeem with no vault balance to pay out", async function () {
    const { token, vault, owner, alice } = await deploySystem();
    const amount = ethers.parseUnits("10000000", 18);
    await token.connect(owner).transfer(alice.address, amount);
    await token.connect(alice).approve(await vault.getAddress(), amount);
    await expect(vault.connect(alice).redeem(amount)).to.be.revertedWithCustomError(vault, "NothingToRedeem");
  });

  it("reverts redeeming without first approving the vault to burn on the caller's behalf", async function () {
    const { token, vault, nvdab, owner, keeper, alice } = await deploySystem();
    await depositAsset(vault, nvdab, keeper, ethers.parseUnits("1000", 18));
    const amount = ethers.parseUnits("10000000", 18);
    await token.connect(owner).transfer(alice.address, amount);
    await expect(vault.connect(alice).redeem(amount)).to.be.reverted;
  });

  it("only the owner can change the keeper", async function () {
    const { vault, alice, bob } = await deploySystem();
    await expect(vault.connect(alice).setKeeper(bob.address)).to.be.revertedWithCustomError(
      vault,
      "OwnableUnauthorizedAccount"
    );
  });

  it("ownership transfer requires the new owner to accept (Ownable2Step)", async function () {
    const { vault, owner, alice, bob } = await deploySystem();

    await vault.connect(owner).transferOwnership(alice.address);
    // Not yet transferred: old owner still privileged, new owner not yet.
    expect(await vault.owner()).to.equal(owner.address);
    expect(await vault.pendingOwner()).to.equal(alice.address);
    await expect(vault.connect(alice).setKeeper(bob.address)).to.be.revertedWithCustomError(
      vault,
      "OwnableUnauthorizedAccount"
    );

    // A stray caller can't accept on alice's behalf.
    await expect(vault.connect(bob).acceptOwnership()).to.be.revertedWithCustomError(
      vault,
      "OwnableUnauthorizedAccount"
    );

    await vault.connect(alice).acceptOwnership();
    expect(await vault.owner()).to.equal(alice.address);
    // Old owner has lost privileges now.
    await expect(vault.connect(owner).setKeeper(bob.address)).to.be.revertedWithCustomError(
      vault,
      "OwnableUnauthorizedAccount"
    );
  });

  it("redeem() skips a broken reserve asset instead of reverting the whole redemption", async function () {
    const { token, vault, nvdab, owner, keeper, alice } = await deploySystem();

    const Reverting = await ethers.getContractFactory("MockRevertingERC20");
    const badAsset = await Reverting.deploy("Broken bStock", "BROKEN");
    await badAsset.waitForDeployment();

    // Vault holds a good asset (NVDAB) and a broken one that always reverts on transfer —
    // standing in for a keeper mistakenly (or maliciously) registering a bad token.
    await depositAsset(vault, nvdab, keeper, ethers.parseUnits("1000", 18));
    await badAsset.mint(keeper.address, ethers.parseUnits("1000", 18));
    await badAsset.connect(keeper).approve(await vault.getAddress(), ethers.parseUnits("1000", 18));
    await vault.connect(keeper).depositAsset(await badAsset.getAddress(), ethers.parseUnits("1000", 18));

    const amount = ethers.parseUnits("10000000", 18); // 1%
    await token.connect(owner).transfer(alice.address, amount);
    await token.connect(alice).approve(await vault.getAddress(), amount);

    // Must not revert despite one reserve asset being broken.
    await expect(vault.connect(alice).redeem(amount))
      .to.emit(vault, "RedeemAssetSkipped")
      .withArgs(alice.address, await badAsset.getAddress(), ethers.parseUnits("10", 18));

    // The good asset still paid out, and RSVD was still burned.
    expect(await nvdab.balanceOf(alice.address)).to.equal(ethers.parseUnits("10", 18));
    expect(await badAsset.balanceOf(alice.address)).to.equal(0n);
    expect(await token.balanceOf(alice.address)).to.equal(0n);
    expect(await token.totalSupply()).to.equal(FIXED_SUPPLY - amount);

    // The skipped asset's balance stays in the vault (not lost, just not paid out here).
    expect(await badAsset.balanceOf(await vault.getAddress())).to.equal(ethers.parseUnits("1000", 18));
  });
});
