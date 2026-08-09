// Single source of truth for how this project compiles.
//
// Two scripts must agree byte-for-byte on targets, settings and source keys:
// offline-compile.js (which produces the bytecode that gets DEPLOYED) and
// verify-standard-json.js (which submits an input Etherscan must be able to recompile
// into that same bytecode). Any divergence — a different source key, an extra target,
// a settings flag — changes the metadata hash embedded in the bytecode and verification
// fails against a contract that is perfectly fine. Keeping the definitions in one module
// is the only way that agreement survives edits.
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const CONTRACTS_DIR = path.join(__dirname, "..", "contracts");
const NODE_MODULES = path.join(__dirname, "..", "node_modules");
const ROOT = path.join(__dirname, "..");

const TARGETS = [
  "ReservedToken.sol",
  "LaunchPricing.sol",
  "ReservedLauncher.sol",
  "ReservedVault.sol",
  "ReservedGovernanceVote.sol",
  "mocks/MockERC20.sol",
  "mocks/MockERC20CustomDecimals.sol",
  "mocks/MockRevertingERC20.sol",
  "mocks/MockUniswapV3.sol",
  "vendor/TimelockController.sol",
];

// ReservedLauncher.launch keeps a lot of locals live across the pool-creation and mint
// calls and overflows the stack under the legacy codegen — the same failure the original
// initializer's nine-parameter init hit. Scoped to that one file so every other contract
// keeps byte-identical bytecode; enabling viaIR globally would silently change every
// deployed artifact.
const VIA_IR_TARGETS = new Set(["ReservedLauncher.sol"]);

const OPTIMIZER = { enabled: true, runs: 200 };

const OUTPUT_SELECTION = {
  "*": {
    "*": [
      "abi",
      "evm.bytecode.object",
      "evm.deployedBytecode.object",
      "metadata",
      // Needed by test/StorageLayout.test.js: anything delegatecalled through
      // ReservedToken.postDeploy runs against the token's storage, so the two layouts
      // have to be compared mechanically rather than by eye.
      "storageLayout",
    ],
  },
};

const GROUPS = ["legacy", "viaIR"];
const groupOf = (file) => (VIA_IR_TARGETS.has(file) ? "viaIR" : "legacy");
const filesInGroup = (group) => TARGETS.filter((f) => groupOf(f) === group);

/// Which compile group a given source file belongs to. Verification has to submit the
/// same group the deployed bytecode came from, viaIR flag included.
function groupForSourceFile(sourceFile) {
  if (!TARGETS.includes(sourceFile)) throw new Error(`${sourceFile} is not a compile target`);
  return groupOf(sourceFile);
}

/// Resolves imports and records every file it touches into `sources`, so callers end up
/// holding the full transitive closure — Etherscan compiles from the submitted JSON
/// alone, with no filesystem and no node_modules.
function makeFindImports(sources) {
  return function findImports(importPath) {
    if (sources[importPath]) return { contents: sources[importPath].content };
    for (const candidate of [path.join(CONTRACTS_DIR, importPath), path.join(NODE_MODULES, importPath)]) {
      if (fs.existsSync(candidate)) {
        const contents = fs.readFileSync(candidate, "utf8");
        sources[importPath] = { content: contents };
        return { contents };
      }
    }
    return { error: `File not found: ${importPath}` };
  };
}

function compileGroup(group) {
  const files = filesInGroup(group);
  // A group can legitimately be empty — nothing currently needs viaIR — and solc errors
  // out on an input with no sources rather than returning nothing.
  if (files.length === 0) return { input: null, output: { contracts: {} }, sources: {} };

  const sources = {};
  for (const file of files) {
    sources[file] = { content: fs.readFileSync(path.join(CONTRACTS_DIR, file), "utf8") };
  }

  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: OPTIMIZER,
      ...(group === "viaIR" ? { viaIR: true } : {}),
      outputSelection: OUTPUT_SELECTION,
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: makeFindImports(sources) }));

  let hasError = false;
  for (const err of output.errors || []) {
    if (err.severity === "error") {
      hasError = true;
      console.error(err.formattedMessage);
    } else {
      console.warn(err.formattedMessage);
    }
  }
  if (hasError) process.exit(1);

  // `sources` is now the full closure, mutated by findImports during the compile above.
  return { input, output, sources };
}

/// The bytecode that gets deployed comes from the npm `solc` in node_modules, while
/// `hardhat verify` recompiles using the version in hardhat.config.ts. When those drift,
/// verification rejects a contract that is otherwise fine. That already happened once:
/// package.json carried "solc": "^0.8.28", a fresh install resolved it to 0.8.36, and the
/// mainnet deployment could not be verified against a config still declaring 0.8.28.
function assertCompilerConsistency() {
  const pkg = require(path.join(ROOT, "package.json"));
  const pinned = pkg.devDependencies.solc;
  const actual = solc.version().split("+")[0];

  if (/^[\^~><=*]|x/.test(pinned)) {
    console.error(
      `package.json declares solc as "${pinned}". Pin an exact version — a range lets\n` +
        `npm pick a different compiler per machine, which changes the deployed bytecode.`
    );
    process.exit(1);
  }
  if (actual !== pinned) {
    console.error(
      `solc mismatch: package.json pins ${pinned}, node_modules has ${actual}.\n` +
        `Run npm install before compiling.`
    );
    process.exit(1);
  }

  const config = fs.readFileSync(path.join(ROOT, "hardhat.config.ts"), "utf8");
  const declared = [...config.matchAll(/version:\s*"([0-9]+\.[0-9]+\.[0-9]+)"/g)].map((m) => m[1]);
  const drifted = [...new Set(declared)].filter((v) => v !== actual);
  if (drifted.length > 0) {
    console.error(
      `hardhat.config.ts declares solidity ${drifted.join(", ")} but this build uses ${actual}.\n` +
        `They must match or 'hardhat verify' will recompile a different binary than was deployed.`
    );
    process.exit(1);
  }

  return actual;
}

module.exports = {
  CONTRACTS_DIR,
  NODE_MODULES,
  ROOT,
  TARGETS,
  VIA_IR_TARGETS,
  GROUPS,
  filesInGroup,
  groupForSourceFile,
  compileGroup,
  assertCompilerConsistency,
};
