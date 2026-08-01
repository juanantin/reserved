import { ethers } from "hardhat";

// Registers (or deregisters) an address as an AMM pair on ReservedToken, so
// buy/sell tax applies to transfers touching it. Must be called by the current
// owner — if ownership has already moved to a timelock, this will revert; go
// through timelock.schedule()/execute() instead (see deploy-timelock.ts).
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || "";
const PAIR_ADDRESS = process.env.PAIR_ADDRESS || "";
const IS_PAIR = process.env.IS_PAIR !== "false"; // default true (register); IS_PAIR=false to deregister

async function main() {
  if (!TOKEN_ADDRESS || !PAIR_ADDRESS) {
    throw new Error("Set TOKEN_ADDRESS and PAIR_ADDRESS env vars first.");
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account configured — check contracts/.env.");
  }

  const token: any = await ethers.getContractAt("ReservedToken", TOKEN_ADDRESS);

  console.log("Caller:", deployer.address);
  console.log("Token:", TOKEN_ADDRESS);
  console.log(`Setting isAmmPair[${PAIR_ADDRESS}] = ${IS_PAIR}`);

  const tx = await token.connect(deployer).setAmmPair(PAIR_ADDRESS, IS_PAIR);
  const receipt = await tx.wait();
  console.log("setAmmPair tx:", receipt.hash);

  const current: boolean = await token.isAmmPair(PAIR_ADDRESS);
  console.log(`\nisAmmPair(${PAIR_ADDRESS}) = ${current}`);
  console.log(`SET AMM PAIR: ${current === IS_PAIR ? "PASS" : "FAIL"}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
