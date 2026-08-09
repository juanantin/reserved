const { ethers } = require("hardhat");

const lt = (a, b) => BigInt(a) < BigInt(b);

/**
 * Deploys `factory` at an address on a chosen side of `reference`.
 *
 * Token ordering decides real behaviour — which way a sale moves the tick, which leg of a
 * position is funded — so tests have to control it rather than hope. Deploying repeatedly
 * until an address lands right works only probabilistically, and the addresses depend on
 * the deployer's nonce, so a suite that passes alone can fail once other files run first.
 *
 * Predict the next CREATE address instead and burn a nonce with a zero-value self-send
 * when it is on the wrong side. Same outcome, deterministic, and far cheaper than
 * deploying a contract per attempt.
 */
async function deployOnSide(factory, deployer, reference, wantReferenceLower, attempts = 256) {
  for (let i = 0; i < attempts; i++) {
    const nonce = await ethers.provider.getTransactionCount(deployer.address);
    const predicted = ethers.getCreateAddress({ from: deployer.address, nonce });
    if (lt(reference, predicted) === wantReferenceLower) {
      const deployed = await factory.connect(deployer).deploy();
      await deployed.waitForDeployment();
      return deployed;
    }
    await (await deployer.sendTransaction({ to: deployer.address, value: 0 })).wait();
  }
  throw new Error(`No address found on the required side of ${reference} in ${attempts} attempts`);
}

module.exports = { deployOnSide, lt };
