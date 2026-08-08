// Compiles the project with the npm `solc` package and writes Hardhat-format artifacts
// directly, bypassing Hardhat's own compiler downloader — this sandbox's network policy
// blocks binaries.soliditylang.org, which `hardhat compile` needs to fetch a native/wasm
// solc build. `solc` from npm ships its own wasm build, fetched once via `npm install`
// (npm registry is allowlisted), so this needs no further network access. Run with
// `node scripts/offline-compile.js`, then `npx hardhat test --no-compile`.
//
// The bytecode this produces is what gets DEPLOYED, so targets and settings live in
// scripts/compile-config.js alongside the verification path that has to reproduce it.
const fs = require("fs");
const path = require("path");
const { GROUPS, compileGroup, assertCompilerConsistency } = require("./compile-config");

const ARTIFACTS_DIR = path.join(__dirname, "..", "artifacts");

const solcVersion = assertCompilerConsistency();

const contracts = {};
const layouts = {};
for (const group of GROUPS) {
  const { output } = compileGroup(group);
  Object.assign(contracts, output.contracts);
}

// Iterate every source file solc actually produced contracts for — not just the target
// list — since a target can be a thin re-export shim (see vendor/TimelockController.sol)
// whose contract is declared in an imported file, not the target file itself.
for (const file of Object.keys(contracts)) {
  for (const [contractName, contract] of Object.entries(contracts[file])) {
    const outDir = path.join(ARTIFACTS_DIR, "contracts", file);
    fs.mkdirSync(outDir, { recursive: true });
    const artifact = {
      _format: "hh-sol-artifact-1",
      contractName,
      sourceName: `contracts/${file}`,
      abi: contract.abi,
      bytecode: "0x" + contract.evm.bytecode.object,
      deployedBytecode: "0x" + contract.evm.deployedBytecode.object,
      linkReferences: contract.evm.bytecode.linkReferences || {},
      deployedLinkReferences: contract.evm.deployedBytecode.linkReferences || {},
    };
    fs.writeFileSync(path.join(outDir, `${contractName}.json`), JSON.stringify(artifact, null, 2));
    console.log(`Wrote artifact for ${contractName}`);
    if (contract.storageLayout) layouts[contractName] = contract.storageLayout;
  }
}

// Hardhat artifacts have no place for storageLayout, so dump it separately for
// test/StorageLayout.test.js to read.
fs.writeFileSync(path.join(ARTIFACTS_DIR, "storage-layouts.json"), JSON.stringify(layouts, null, 2));
console.log(`Wrote storage layouts for ${Object.keys(layouts).length} contracts (solc ${solcVersion})`);
