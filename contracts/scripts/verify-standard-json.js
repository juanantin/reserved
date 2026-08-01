// Verifies a contract on BscScan via Etherscan's V2 unified API, submitting the
// EXACT Solidity Standard-JSON-Input that scripts/offline-compile.js used to
// actually compile and deploy — not `hardhat verify`, which recompiles through
// Hardhat's own toolchain (different source-path keys, and whatever solc version
// Hardhat's downloader fetches) and therefore can't reproduce byte-identical
// output for anything deployed via the offline-compile path. See README.
//
// Usage (token):
//   CONTRACT=ReservedToken ADDRESS=0x... \
//   TOKEN_NAME=RSVDTEST TOKEN_SYMBOL=RSVDTEST FIXED_SUPPLY_TOKENS=1000000000 \
//   OWNER=0x... TREASURY=0x... \
//   node scripts/verify-standard-json.js
//
// Usage (vault):
//   CONTRACT=ReservedVault ADDRESS=0x... TOKEN_ADDRESS=0x... OWNER=0x... KEEPER=0x... \
//   node scripts/verify-standard-json.js
//
// Reads ETHERSCAN_API_KEY from contracts/.env (same key used for hardhat-verify).
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { AbiCoder } = require("ethers");

const CONTRACTS_DIR = path.join(__dirname, "..", "contracts");
const NODE_MODULES = path.join(__dirname, "..", "node_modules");

// Must exactly match offline-compile.js's targets, settings, and source keys —
// any difference changes the compiled bytecode's embedded metadata hash and
// breaks the byte-for-byte match Etherscan checks for.
const targets = [
  "ReservedToken.sol",
  "ReservedVault.sol",
  "mocks/MockERC20.sol",
  "mocks/MockRevertingERC20.sol",
  "vendor/TimelockController.sol",
];

function findImports(importPath) {
  const candidates = [path.join(CONTRACTS_DIR, importPath), path.join(NODE_MODULES, importPath)];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { contents: fs.readFileSync(candidate, "utf8") };
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
      "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] },
    },
  },
};

const CONTRACT = process.env.CONTRACT; // "ReservedToken" | "ReservedVault"
const ADDRESS = process.env.ADDRESS;
const API_KEY = process.env.ETHERSCAN_API_KEY;

if (!CONTRACT || !ADDRESS || !API_KEY) {
  throw new Error("Set CONTRACT, ADDRESS, and ETHERSCAN_API_KEY (in .env) first — see usage comment at the top of this file.");
}

let sourceFile, constructorTypes, constructorArgs;
if (CONTRACT === "ReservedToken") {
  sourceFile = "ReservedToken.sol";
  constructorTypes = ["string", "string", "uint256", "address", "address"];
  constructorArgs = [
    process.env.TOKEN_NAME,
    process.env.TOKEN_SYMBOL,
    process.env.FIXED_SUPPLY_TOKENS ? (BigInt(process.env.FIXED_SUPPLY_TOKENS) * 10n ** 18n).toString() : undefined,
    process.env.OWNER,
    process.env.TREASURY,
  ];
} else if (CONTRACT === "ReservedVault") {
  sourceFile = "ReservedVault.sol";
  constructorTypes = ["address", "address", "address"];
  constructorArgs = [process.env.TOKEN_ADDRESS, process.env.OWNER, process.env.KEEPER];
} else {
  throw new Error('CONTRACT must be "ReservedToken" or "ReservedVault"');
}
for (const arg of constructorArgs) {
  if (!arg) throw new Error("Missing a required constructor-arg env var — see the usage comment at the top of this file.");
}

const constructorArguments = AbiCoder.defaultAbiCoder().encode(constructorTypes, constructorArgs).slice(2);

const rawVersion = solc.version(); // e.g. "0.8.28+commit.7893614a.Emscripten.clang"
const versionMatch = rawVersion.match(/^(\d+\.\d+\.\d+)\+commit\.([0-9a-fA-F]+)/);
if (!versionMatch) throw new Error(`Couldn't parse solc version string: ${rawVersion}`);
const compilerversion = `v${versionMatch[1]}+commit.${versionMatch[2]}`;

console.log("Compiler version:", compilerversion, `(raw: ${rawVersion})`);
console.log("Contract:", `${sourceFile}:${CONTRACT}`);
console.log("Address:", ADDRESS);
console.log("Constructor args (abi-encoded):", constructorArguments);

async function main() {
  const params = new URLSearchParams({
    module: "contract",
    action: "verifysourcecode",
    apikey: API_KEY,
    contractaddress: ADDRESS,
    sourceCode: JSON.stringify(input),
    codeformat: "solidity-standard-json-input",
    contractname: `${sourceFile}:${CONTRACT}`,
    compilerversion,
    constructorArguments,
  });

  // The V2 API reads chainid off the URL's query string, not the POST body —
  // it 404/NOTOKs with "Missing or unsupported chainid parameter" if it's only
  // in the form-encoded body, even though every other param is read from there.
  const submitRes = await fetch("https://api.etherscan.io/v2/api?chainid=56", { method: "POST", body: params });
  const submitJson = await submitRes.json();
  console.log("\nSubmit response:", submitJson);
  if (submitJson.status !== "1") {
    throw new Error(`Verification submission failed: ${submitJson.result || submitJson.message}`);
  }
  const guid = submitJson.result;

  console.log("\nPolling verification status...");
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const statusRes = await fetch(
      `https://api.etherscan.io/v2/api?chainid=56&module=contract&action=checkverifystatus&guid=${guid}&apikey=${API_KEY}`
    );
    const statusJson = await statusRes.json();
    console.log(`  [${i + 1}/12]`, statusJson.result);
    if (statusJson.result === "Pass - Verified") {
      console.log(`\nVERIFIED: https://bscscan.com/address/${ADDRESS}#code`);
      return;
    }
    if (typeof statusJson.result === "string" && statusJson.result.startsWith("Fail")) {
      throw new Error(`Verification failed: ${statusJson.result}`);
    }
  }
  console.log("\nStill pending after polling — check BscScan directly in a minute:");
  console.log(`https://bscscan.com/address/${ADDRESS}#code`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
