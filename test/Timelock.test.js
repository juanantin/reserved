const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mintInitialSupply } = require("./helpers/supply");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const FIXED_SUPPLY = ethers.parseUnits("1000000000", 18);
const MIN_DELAY = 24 * 60 * 60; // 24h, the mainnet-appropriate default from deploy-timelock.ts

async function deploySystem() {
  const [owner, treasury, keeper, alice] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("ReservedToken");
  const token = await Token.deploy("Reserved", "RSVD", owner.address, treasury.address);
  await token.waitForDeployment();
  await mintInitialSupply(token, owner.address, FIXED_SUPPLY);

  const Timelock = await ethers.getContractFactory("TimelockController");
  const timelock = await Timelock.deploy(MIN_DELAY, [owner.address], [owner.address], owner.address);
  await timelock.waitForDeployment();
  const timelockAddress = await timelock.getAddress();

  // Hand ownership to the timelock: transfer, then schedule+execute acceptOwnership
  // *as* the timelock (only the pending owner can accept, and the timelock only ever
  // acts through schedule/execute).
  await token.connect(owner).transferOwnership(timelockAddress);
  const acceptData = token.interface.encodeFunctionData("acceptOwnership");
  const salt = ethers.id("test-accept-ownership");
  await timelock.connect(owner).schedule(await token.getAddress(), 0, acceptData, ethers.ZeroHash, salt, MIN_DELAY);
  await time.increase(MIN_DELAY + 1);
  await timelock.connect(owner).execute(await token.getAddress(), 0, acceptData, ethers.ZeroHash, salt);

  return { token, timelock, owner, treasury, keeper, alice };
}

describe("Timelock-gated ownership", function () {
  it("hands ownership to the timelock, not the deployer, after the accept flow", async function () {
    const { token, timelock } = await deploySystem();
    expect(await token.owner()).to.equal(await timelock.getAddress());
  });

  it("the original owner can no longer call onlyOwner functions directly", async function () {
    const { token, owner } = await deploySystem();
    await expect(token.connect(owner).setTaxBps(100)).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
  });

  it("a scheduled admin change cannot execute before the delay elapses", async function () {
    const { token, timelock, owner } = await deploySystem();
    const data = token.interface.encodeFunctionData("setTaxBps", [100]);
    const salt = ethers.id("change-tax");
    await timelock.connect(owner).schedule(await token.getAddress(), 0, data, ethers.ZeroHash, salt, MIN_DELAY);

    // Not ready yet — no time has passed.
    await expect(
      timelock.connect(owner).execute(await token.getAddress(), 0, data, ethers.ZeroHash, salt)
    ).to.be.revertedWithCustomError(timelock, "TimelockUnexpectedOperationState");

    expect(await token.taxBps()).to.equal(300n); // unchanged
  });

  it("a scheduled admin change executes correctly once the delay has passed", async function () {
    const { token, timelock, owner } = await deploySystem();
    const data = token.interface.encodeFunctionData("setTaxBps", [100]);
    const salt = ethers.id("change-tax-2");
    await timelock.connect(owner).schedule(await token.getAddress(), 0, data, ethers.ZeroHash, salt, MIN_DELAY);

    await time.increase(MIN_DELAY + 1);
    await timelock.connect(owner).execute(await token.getAddress(), 0, data, ethers.ZeroHash, salt);

    expect(await token.taxBps()).to.equal(100n);
  });

  it("cannot schedule a delay shorter than the timelock's minimum", async function () {
    const { token, timelock, owner } = await deploySystem();
    const data = token.interface.encodeFunctionData("setTaxBps", [100]);
    const salt = ethers.id("too-fast");
    await expect(
      timelock.connect(owner).schedule(await token.getAddress(), 0, data, ethers.ZeroHash, salt, MIN_DELAY - 1)
    ).to.be.revertedWithCustomError(timelock, "TimelockInsufficientDelay");
  });

  it("a non-proposer cannot schedule admin changes", async function () {
    const { token, timelock, alice } = await deploySystem();
    const data = token.interface.encodeFunctionData("setTaxBps", [100]);
    const salt = ethers.id("attacker-attempt");
    await expect(
      timelock.connect(alice).schedule(await token.getAddress(), 0, data, ethers.ZeroHash, salt, MIN_DELAY)
    ).to.be.revertedWithCustomError(timelock, "AccessControlUnauthorizedAccount");
  });
});
