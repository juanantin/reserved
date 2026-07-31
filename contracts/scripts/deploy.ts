import { ethers } from "hardhat";

// Fill these in for the target deployment before running, or override via env vars
// for a throwaway test deployment without editing this file, e.g.:
//   TOKEN_NAME=RSVDTEST TOKEN_SYMBOL=RSVDTEST FIXED_SUPPLY_TOKENS=1000000 npm run deploy:mainnet
const TOKEN_NAME = process.env.TOKEN_NAME || "Reserved";
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || "RSVD";
const FIXED_SUPPLY = ethers.parseUnits(process.env.FIXED_SUPPLY_TOKENS || "1000000000", 18); // default 1B

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No deployer account configured for this network. Check that contracts/.env exists " +
        "and DEPLOYER_PRIVATE_KEY is set (copy .env.example to .env if you haven't already)."
    );
  }
  console.log("Deploying with:", deployer.address);

  // TODO: replace with the real multisig/treasury addresses before any non-local deploy.
  const owner = deployer.address;
  const treasury = deployer.address;
  const keeper = deployer.address;

  const Token = await ethers.getContractFactory("ReservedToken");
  const token = await Token.deploy(TOKEN_NAME, TOKEN_SYMBOL, FIXED_SUPPLY, owner, treasury);
  await token.waitForDeployment();
  console.log("ReservedToken deployed to:", await token.getAddress());

  const Vault = await ethers.getContractFactory("ReservedVault");
  const vault = await Vault.deploy(await token.getAddress(), owner, keeper);
  await vault.waitForDeployment();
  console.log("ReservedVault deployed to:", await vault.getAddress());

  console.log("\nNext steps:");
  console.log("- token.setTreasury(...) if treasury != deployer");
  console.log("- token.setAmmPair(<PancakeSwap RSVD/USDT pair address>, true) once the pool exists");
  console.log("- vault.setKeeper(...) once the keeper bot's operating address is known");
  console.log("- verify both contracts on BscScan (npx hardhat verify --network <net> <address> <constructor args>)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
