// Compiles contracts/*.sol with the npm `solc` package and writes Hardhat-format
// artifacts directly, bypassing Hardhat's own compiler downloader — this sandbox's
// network policy blocks binaries.soliditylang.org, which `hardhat compile` needs to
// fetch a native/wasm solc build. `solc` from npm ships its own wasm build, fetched
// once via `npm install` (npm registry is allowlisted), so this needs no further
// network access. Run with `node scripts/offline-compile.js`, then `npx hardhat test
// --no-compile` (or `--network hardhat`) to skip Hardhat's compile step.
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const CONTRACTS_DIR = path.join(__dirname, "..", "contracts");
const ARTIFACTS_DIR = path.join(__dirname, "..", "artifacts");
const NODE_MODULES = path.join(__dirname, "..", "node_modules");

const targets = ["ReservedToken.sol", "ReservedVault.sol", "mocks/MockERC20.sol"];

function findImports(importPath) {
  const candidates = [
    path.join(CONTRACTS_DIR, importPath),
    path.join(NODE_MODULES, importPath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, "utf8") };
    }
  }
  return { error: `File not found: ${importPath}` };
}

const sources = {};
for (const file of targets) {
  sources[file] = { content: fs.readFileSync(path.join(CONTRACTS_DIR, file), "utf8") };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

let hasError = false;
for (const err of output.errors || []) {
  if (err.severity === "error") {
    hasError = true;
    console.error(err.formattedMessage);
  } else {
    console.warn(err.formattedMessage);
  }
}
if (hasError) {
  process.exit(1);
}

for (const file of targets) {
  const contractsInFile = output.contracts[file];
  for (const [contractName, contract] of Object.entries(contractsInFile)) {
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
  }
}
