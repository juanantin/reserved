const { ethers } = require("hardhat");

/// The constructor no longer mints — supply is created by whatever gets delegatecalled
/// through `postDeploy`. Fixtures use MockSupplyInitializer to reproduce the old
/// `_mint(initialOwner_, fixedSupply_)` exactly, so assertions written against the
/// constructor-mint behaviour keep their original meaning.
async function mintInitialSupply(token, to, amount) {
  const Initializer = await ethers.getContractFactory("MockSupplyInitializer");
  const initializer = await Initializer.deploy();
  await initializer.waitForDeployment();

  const payload = initializer.interface.encodeFunctionData("mintTo", [to, amount]);
  await token.postDeploy(await initializer.getAddress(), payload);

  return initializer;
}

module.exports = { mintInitialSupply };
