import { ethers } from "hardhat";

// Marks (or unmarks) an address as exempt from buy/sell tax. Needed for the
// PancakeSwap router before removeLiquidityETH will work on a taxed token:
// remove-liquidity moves the token leg pair -> router -> caller internally,
// and the pair -> router hop touches the pair (taxed) unless the router
// itself is exempt — causing the router's forward-to-caller transfer to
// revert with "TransferHelper: TRANSFER_FAILED" (it received less than it
// expects to forward). Must be called by the current owner — if ownership
// has moved to a timelock, go through schedule()/execute() instead.
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || "";
const EXEMPT_ADDRESS = process.env.EXEMPT_ADDRESS || "";
const IS_EXEMPT = process.env.IS_EXEMPT !== "false"; // default true

async function main() {
  if (!TOKEN_ADDRESS || !EXEMPT_ADDRESS) {
    throw new Error("Set TOKEN_ADDRESS and EXEMPT_ADDRESS env vars first.");
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account configured — check contracts/.env.");
  }

  const token: any = await ethers.getContractAt("ReservedToken", TOKEN_ADDRESS);

  console.log("Caller:", deployer.address);
  console.log("Token:", TOKEN_ADDRESS);
  console.log(`Setting isTaxExempt[${EXEMPT_ADDRESS}] = ${IS_EXEMPT}`);

  const tx = await token.connect(deployer).setTaxExempt(EXEMPT_ADDRESS, IS_EXEMPT);
  const receipt = await tx.wait();
  console.log("setTaxExempt tx:", receipt.hash);

  const current: boolean = await token.isTaxExempt(EXEMPT_ADDRESS);
  console.log(`\nisTaxExempt(${EXEMPT_ADDRESS}) = ${current}`);
  console.log(`SET TAX EXEMPT: ${current === IS_EXEMPT ? "PASS" : "FAIL"}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
