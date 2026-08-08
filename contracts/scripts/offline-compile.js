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
const STORAGE_LAYOUT_DIR = path.join(__dirname, "..", "storage-layout");

const targets = [
  "ReservedToken.sol",
  "ReservedVault.sol",
  "TreasuryConverter.sol",
  "TreasuryConverterV2.sol",
  "ReservedGovernanceVote.sol",
  "RfqProbe.sol",
  "mocks/MockERC20.sol",
  "mocks/MockERC20CustomDecimals.sol",
  "mocks/MockRevertingERC20.sol",
  "mocks/MockChainlinkFeed.sol",
  "mocks/MockUniswapV2Pair.sol",
  "mocks/MockUniswapV2Router.sol",
  "mocks/MockSwapTarget.sol",
  "mocks/MockWBNB.sol",
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
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata", "storageLayout"],
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

    // Storage layout snapshot, written to a *committed* directory (not artifacts/, which
    // is gitignored) so any change shows up as a reviewable diff in the PR that causes it.
    // Deliberately mechanical rather than something a human has to remember to report:
    // layout drift fails silently — a shifted slot writes to the wrong place rather than
    // reverting — so it must not depend on anyone noticing. Anything inheriting from these
    // contracts, or reading their raw storage, can diff these instead of re-deriving slots
    // by hand. Mocks and vendored code are skipped; only contracts we actually deploy.
    const isOwnDeployable =
      targets.includes(file) && !file.startsWith("mocks/") && !file.startsWith("vendor/");
    // Skip interfaces/libraries declared alongside a contract — they have no storage.
    if (contract.storageLayout && isOwnDeployable && contract.storageLayout.storage.length > 0) {
      fs.mkdirSync(STORAGE_LAYOUT_DIR, { recursive: true });
      // Strip astId: it is assigned globally across the whole compilation unit, so editing
      // any unrelated source shifts it in every file. Left in, every change would produce a
      // layout diff for contracts whose storage didn't move — noise that trains reviewers
      // to ignore exactly the signal this exists to surface. Slot/offset/label/type are the
      // parts that actually define the layout.
      // Struct and contract type identifiers embed the astId too — t_struct(Foo)1234_storage
      // and t_contract(IBar)1234 — so they drift for the same reason. Strip the number only
      // for those two forms: t_array(t_uint256)5_storage uses a trailing number for the
      // array *length*, which is real layout information and must survive.
      const normaliseType = (t) => t.replace(/(t_(?:struct|contract)\([^)]*\))\d+/g, "$1");
      const rawTypes = contract.storageLayout.types || {};
      const types = {};
      for (const [key, val] of Object.entries(rawTypes)) {
        const copy = { ...val };
        if (copy.key) copy.key = normaliseType(copy.key);
        if (copy.value) copy.value = normaliseType(copy.value);
        if (copy.base) copy.base = normaliseType(copy.base);
        if (Array.isArray(copy.members)) {
          copy.members = copy.members.map(({ label, offset, slot, type }) => ({
            label,
            offset,
            slot,
            type: normaliseType(type),
          }));
        }
        types[normaliseType(key)] = copy;
      }
      const stable = {
        storage: contract.storageLayout.storage.map(({ label, offset, slot, type }) => ({
          label,
          offset,
          slot,
          type: normaliseType(type),
        })),
        types,
      };
      fs.writeFileSync(
        path.join(STORAGE_LAYOUT_DIR, `${contractName}.json`),
        JSON.stringify(stable, null, 2) + "\n"
      );
    }
  }
}
