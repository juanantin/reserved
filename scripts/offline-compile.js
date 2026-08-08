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

// The deployed bytecode comes from THIS compiler, but `hardhat verify` recompiles using
// the version in hardhat.config.ts. When the two drift, verification fails against a
// contract that is otherwise perfectly fine. That already happened once: package.json
// carried "solc": "^0.8.28", a fresh npm install resolved it to 0.8.36, and the mainnet
// deployment could not be verified against a config still declaring 0.8.28. Keep the pin
// exact and fail loudly rather than silently emitting a different binary per machine.
const PKG = require(path.join(__dirname, "..", "package.json"));
const PINNED_SOLC = PKG.devDependencies.solc;
const ACTUAL_SOLC = solc.version().split("+")[0];

if (/^[\^~><=*]|x/.test(PINNED_SOLC)) {
  console.error(
    `package.json declares solc as "${PINNED_SOLC}". Pin an exact version — a range lets\n` +
      `npm pick a different compiler per machine, which changes the deployed bytecode.`
  );
  process.exit(1);
}
if (ACTUAL_SOLC !== PINNED_SOLC) {
  console.error(
    `solc mismatch: package.json pins ${PINNED_SOLC}, node_modules has ${ACTUAL_SOLC}.\n` +
      `Run npm install before compiling.`
  );
  process.exit(1);
}

const HARDHAT_CONFIG = fs.readFileSync(path.join(__dirname, "..", "hardhat.config.ts"), "utf8");
const declaredVersions = [...HARDHAT_CONFIG.matchAll(/version:\s*"([0-9]+\.[0-9]+\.[0-9]+)"/g)].map((m) => m[1]);
const drifted = [...new Set(declaredVersions)].filter((v) => v !== ACTUAL_SOLC);
if (drifted.length > 0) {
  console.error(
    `hardhat.config.ts declares solidity ${drifted.join(", ")} but this build uses ${ACTUAL_SOLC}.\n` +
      `They must match or 'hardhat verify' will recompile a different binary than was deployed.`
  );
  process.exit(1);
}

const targets = [
  "ReservedToken.sol",
  "UniswapV3TokenInitializer.sol",
  "ReservedVault.sol",
  "TreasuryConverter.sol",
  "TreasuryConverterV2.sol",
  "ReservedGovernanceVote.sol",
  "mocks/MockERC20.sol",
  "mocks/MockERC20CustomDecimals.sol",
  "mocks/MockRevertingERC20.sol",
  "mocks/MockChainlinkFeed.sol",
  "mocks/MockUniswapV2Pair.sol",
  "mocks/MockUniswapV2Router.sol",
  "mocks/MockSwapTarget.sol",
  "mocks/MockSupplyInitializer.sol",
  "mocks/MockUniswapV3.sol",
  "vendor/TimelockController.sol",
];

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

// UniswapV3TokenInitializer.init takes nine parameters and holds a lot of locals live
// across the pool-creation call, which overflows the stack under the legacy codegen
// ("Stack too deep"). It needs viaIR. Everything else is deliberately kept on the
// original pipeline so the already-reviewed contracts keep byte-identical bytecode —
// turning viaIR on globally would silently change every deployed artifact.
const VIA_IR_TARGETS = new Set(["UniswapV3TokenInitializer.sol"]);

const OUTPUT_SELECTION = {
  "*": {
    "*": [
      "abi",
      "evm.bytecode.object",
      "evm.deployedBytecode.object",
      "metadata",
      // Needed by test/StorageLayout.test.js: anything delegatecalled through
      // ReservedToken.postDeploy runs against the token's storage, so the two
      // layouts have to be compared mechanically rather than by eye.
      "storageLayout",
    ],
  },
};

function compileGroup(files, viaIR) {
  const sources = {};
  for (const file of files) {
    sources[file] = { content: fs.readFileSync(path.join(CONTRACTS_DIR, file), "utf8") };
  }

  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      ...(viaIR ? { viaIR: true } : {}),
      outputSelection: OUTPUT_SELECTION,
    },
  };

  const result = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

  let hasError = false;
  for (const err of result.errors || []) {
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
  return result;
}

const legacy = compileGroup(targets.filter((f) => !VIA_IR_TARGETS.has(f)), false);
const viaIr = compileGroup(targets.filter((f) => VIA_IR_TARGETS.has(f)), true);

const output = { contracts: { ...legacy.contracts, ...viaIr.contracts } };

// Iterate every source file solc actually produced contracts for — not just our
// `targets` list — since a target can be a thin re-export shim (see
// vendor/TimelockController.sol) whose contract is declared in an imported file,
// not the target file itself.
for (const file of Object.keys(output.contracts)) {
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

// Hardhat artifacts have no place for storageLayout, so dump it separately for
// test/StorageLayout.test.js to read.
const layouts = {};
for (const file of Object.keys(output.contracts)) {
  for (const [contractName, contract] of Object.entries(output.contracts[file])) {
    if (contract.storageLayout) layouts[contractName] = contract.storageLayout;
  }
}
fs.writeFileSync(path.join(ARTIFACTS_DIR, "storage-layouts.json"), JSON.stringify(layouts, null, 2));
console.log(`Wrote storage layouts for ${Object.keys(layouts).length} contracts`);
