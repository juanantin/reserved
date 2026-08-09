const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const FIXED_SUPPLY = ethers.parseUnits("1000000000", 18);
const MIN_DELAY = 24 * 60 * 60; // 24h, the mainnet-appropriate default from deploy-timelock.ts

async function deploySystem() {
  const [owner, treasury, keeper, alice] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("ReservedToken");
  const token = await Token.deploy("Reserved", "RSVD", FIXED_SUPPLY, owner.address);
  await token.waitForDeployment();

  const Vault = await ethers.getContractFactory("ReservedVault");
  const vault = await Vault.deploy(await token.getAddress(), owner.address, keeper.address);
  await vault.waitForDeployment();

  const Timelock = await ethers.getContractFactory("TimelockController");
  const timelock = await Timelock.deploy(MIN_DELAY, [owner.address], [owner.address], owner.address);
  await timelock.waitForDeployment();
  const timelockAddress = await timelock.getAddress();

  // The token has no owner at all any more, so the timelock now gates the VAULT — the
  // only contract in the system that still carries admin functions. Hand ownership over:
  // transfer, then schedule+execute acceptOwnership *as* the timelock, since only the
  // pending owner can accept and the timelock only ever acts through schedule/execute.
  await vault.connect(owner).transferOwnership(timelockAddress);
  const acceptData = vault.interface.encodeFunctionData("acceptOwnership");
  const salt = ethers.id("test-accept-ownership");
  await timelock.connect(owner).schedule(await vault.getAddress(), 0, acceptData, ethers.ZeroHash, salt, MIN_DELAY);
  await time.increase(MIN_DELAY + 1);
  await timelock.connect(owner).execute(await vault.getAddress(), 0, acceptData, ethers.ZeroHash, salt);

  return { token, vault, timelock, owner, treasury, keeper, alice };
}

describe("Timelock-gated vault ownership", function () {
  it("hands ownership to the timelock, not the deployer, after the accept flow", async function () {
    const { vault, timelock } = await deploySystem();
    expect(await vault.owner()).to.equal(await timelock.getAddress());
  });

  it("the original owner can no longer call onlyOwner functions directly", async function () {
    const { vault, owner } = await deploySystem();
    await expect(vault.connect(owner).setKeeper(owner.address)).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
  });

  it("a scheduled admin change cannot execute before the delay elapses", async function () {
    const { vault, timelock, owner, keeper, alice } = await deploySystem();
    const data = vault.interface.encodeFunctionData("setKeeper", [alice.address]);
    const salt = ethers.id("change-tax");
    await timelock.connect(owner).schedule(await vault.getAddress(), 0, data, ethers.ZeroHash, salt, MIN_DELAY);

    // Not ready yet — no time has passed.
    await expect(
      timelock.connect(owner).execute(await vault.getAddress(), 0, data, ethers.ZeroHash, salt)
    ).to.be.revertedWithCustomError(timelock, "TimelockUnexpectedOperationState");

    expect(await vault.keeper()).to.equal(keeper.address); // unchanged
  });

  it("a scheduled admin change executes correctly once the delay has passed", async function () {
    const { vault, timelock, owner, keeper, alice } = await deploySystem();
    const data = vault.interface.encodeFunctionData("setKeeper", [alice.address]);
    const salt = ethers.id("change-tax-2");
    await timelock.connect(owner).schedule(await vault.getAddress(), 0, data, ethers.ZeroHash, salt, MIN_DELAY);

    await time.increase(MIN_DELAY + 1);
    await timelock.connect(owner).execute(await vault.getAddress(), 0, data, ethers.ZeroHash, salt);

    expect(await vault.keeper()).to.equal(alice.address);
  });

  it("cannot schedule a delay shorter than the timelock's minimum", async function () {
    const { vault, timelock, owner, keeper, alice } = await deploySystem();
    const data = vault.interface.encodeFunctionData("setKeeper", [alice.address]);
    const salt = ethers.id("too-fast");
    await expect(
      timelock.connect(owner).schedule(await vault.getAddress(), 0, data, ethers.ZeroHash, salt, MIN_DELAY - 1)
    ).to.be.revertedWithCustomError(timelock, "TimelockInsufficientDelay");
  });

  it("a non-proposer cannot schedule admin changes", async function () {
    const { vault, timelock, alice } = await deploySystem();
    const data = vault.interface.encodeFunctionData("setKeeper", [alice.address]);
    const salt = ethers.id("attacker-attempt");
    await expect(
      timelock.connect(alice).schedule(await vault.getAddress(), 0, data, ethers.ZeroHash, salt, MIN_DELAY)
    ).to.be.revertedWithCustomError(timelock, "AccessControlUnauthorizedAccount");
  });
});
