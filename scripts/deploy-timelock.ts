import { ethers } from "hardhat";

// Deploys a TimelockController and hands ownership of an already-deployed
// ReservedVault to it, so every onlyOwner call (setKeeper,
// setTreasury, setAmmPair, setTaxExempt, pause/unpause, setKeeper, ...) has to go
// through schedule() -> wait minDelay -> execute() instead of taking effect
// instantly. This is the single most commonly-flagged pattern by security
// scanners ("owner can instantly change fees") — fixed with zero changes to
// ReservedVault.sol, since Ownable2Step already accepts any
// address, including a contract, as owner.
//
// Fill these in before running.
const VAULT_ADDRESS = process.env.VAULT_ADDRESS || "";

// 24h is the mainnet-appropriate default — enough time for holders to notice and
// react to a scheduled change before it executes. Override with
// TIMELOCK_MIN_DELAY_SECONDS for a short testnet-only delay when smoke-testing.
const MIN_DELAY_SECONDS = process.env.TIMELOCK_MIN_DELAY_SECONDS
  ? Number(process.env.TIMELOCK_MIN_DELAY_SECONDS)
  : 24 * 60 * 60;

// Only auto-wait-and-execute for short (testnet smoke-test) delays — never block
// the script for a real 24h mainnet delay. Above this threshold you get the
// schedule step plus manual next-steps instead.
const AUTO_EXECUTE_THRESHOLD_SECONDS = 900; // 15 minutes
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (!VAULT_ADDRESS) {
    throw new Error("Set VAULT_ADDRESS to the deployed vault. The token has no owner to hand over.");
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account configured — check contracts/.env.");
  }
  console.log("Deployer:", deployer.address);
  console.log("Timelock min delay:", MIN_DELAY_SECONDS, "seconds");

  // TODO before mainnet: replace [deployer.address] with a real multisig address
  // for both proposer and executor. A solo EOA timelock is still a single point of
  // failure — the delay only helps if there's someone else watching to react to it.
  const Timelock = await ethers.getContractFactory("TimelockController");
  const timelock: any = await Timelock.deploy(
    MIN_DELAY_SECONDS,
    [deployer.address], // proposers
    [deployer.address], // executors
    deployer.address // admin — TODO: renounce this once roles are finalized, so
    // future role changes also require going through the timelock itself.
  );
  await timelock.waitForDeployment();
  const timelockAddress = await timelock.getAddress();
  console.log("TimelockController deployed to:", timelockAddress);
  const vault: any = await ethers.getContractAt("ReservedVault", VAULT_ADDRESS);
  await (await vault.connect(deployer).transferOwnership(timelockAddress)).wait();
  console.log("Started ownership transfer of the vault to the timelock (pending acceptance).");

  // The timelock must call acceptOwnership() *as itself*, which means scheduling and
  // (after the delay) executing that call, rather than a direct transaction.
  const acceptOwnershipData = vault.interface.encodeFunctionData("acceptOwnership");
  const salt = ethers.id(`reserved-timelock-accept-${Date.now()}`);

  const scheduled: Array<{ label: string; address: string; data: string }> = [];
  for (const [label, address, data] of [
    ["vault", VAULT_ADDRESS, vault.interface.encodeFunctionData("acceptOwnership")],
  ] as const) {
    await (
      await timelock
        .connect(deployer)
        .schedule(address, 0, data, ethers.ZeroHash, salt, MIN_DELAY_SECONDS)
    ).wait();
    console.log(`Scheduled acceptOwnership() for ${label}. Executable after ${MIN_DELAY_SECONDS}s.`);
    scheduled.push({ label, address, data });
  }

  if (MIN_DELAY_SECONDS > AUTO_EXECUTE_THRESHOLD_SECONDS) {
    console.log("\nNext steps:");
    console.log(`- Wait ${MIN_DELAY_SECONDS}s, then call timelock.execute(...) for each scheduled acceptOwnership()`);
    console.log("  (same target/value/data/predecessor/salt used above — see this script for the encoding).");
    console.log("- After that, vault.owner() equals the timelock address.");
    console.log("- All future admin calls (setTaxBps, setAmmPair, pause, setKeeper, ...) must go through");
    console.log("  timelock.schedule() then timelock.execute() after the delay — direct calls will revert.");
    return;
  }

  console.log(`\nDelay is <= ${AUTO_EXECUTE_THRESHOLD_SECONDS}s (testnet smoke-test mode) — waiting it out and executing automatically.`);
  await sleep((MIN_DELAY_SECONDS + 5) * 1000);

  for (const { label, address, data } of scheduled) {
    await (await timelock.connect(deployer).execute(address, 0, data, ethers.ZeroHash, salt)).wait();
    console.log(`Executed acceptOwnership() for ${label}.`);
  }

  // Public testnet RPC nodes can lag a beat behind the block that was just mined —
  // see testnet-check.ts for the same issue. Give it a moment before reading state.
  await sleep(3000);
  const vaultOwner = await vault.owner();
  const handoffOk = vaultOwner === timelockAddress;
  console.log(`\nOwnership handoff: vault.owner()=${vaultOwner}`);
  console.log(`HANDOFF: ${handoffOk ? "PASS" : "FAIL"} (expected both to equal ${timelockAddress})`);

  // Live proof, not just an assertion: the original deployer, still holding the
  // private key that used to control everything, can no longer call an onlyOwner
  // function directly now that ownership sits with the timelock.
  let directCallBlocked = false;
  try {
    await vault.connect(deployer).setKeeper(deployer.address);
  } catch {
    directCallBlocked = true;
  }
  if (directCallBlocked) {
    console.log("DIRECT OWNER CALL AFTER HANDOFF: PASS (deployer's direct vault.setKeeper() call reverted, as expected)");
  } else {
    console.log("DIRECT OWNER CALL AFTER HANDOFF: FAIL (deployer could still call pause() directly — investigate)");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
