// Verifies a contract on BscScan via Etherscan's V2 unified API, submitting the EXACT
// Solidity Standard-JSON-Input that scripts/offline-compile.js used to compile and
// deploy.
//
// `hardhat verify` cannot do this. It recompiles through Hardhat's own toolchain, which
// keys sources as "contracts/ReservedToken.sol" where offline-compile.js keys them
// "ReservedToken.sol". Source keys go into the metadata, the metadata hash is appended
// to the bytecode, so the two binaries differ in their trailing bytes and Etherscan
// rejects the match. The error it gives you — "bytecode doesn't match any of your local
// contracts" — points at the contract rather than at the toolchain, which is misleading.
//
// Targets, settings and source keys come from scripts/compile-config.js, the same module
// offline-compile.js builds from, so the two cannot drift apart.
//
// Usage:
//   CONTRACT=ReservedToken ADDRESS=0x... TOKEN_NAME=RsvdTest TOKEN_SYMBOL=RSVDTST \
//   OWNER=0x... TREASURY=0x... node scripts/verify-standard-json.js
//
//   CONTRACT=ReservedVault ADDRESS=0x... TOKEN_ADDRESS=0x... OWNER=0x... KEEPER=0x... \
//   node scripts/verify-standard-json.js
//
//   CONTRACT=UniswapV3TokenInitializer ADDRESS=0x... node scripts/verify-standard-json.js
//
// Reads ETHERSCAN_API_KEY from .env.
require("dotenv").config();
const solc = require("solc");
const { AbiCoder } = require("ethers");
const { compileGroup, groupForSourceFile, assertCompilerConsistency } = require("./compile-config");

assertCompilerConsistency();

const CONTRACTS = {
  ReservedToken: {
    sourceFile: "ReservedToken.sol",
    // The constructor dropped fixedSupply_ when minting moved into postDeploy.
    types: ["string", "string", "address", "address"],
    args: () => [process.env.TOKEN_NAME, process.env.TOKEN_SYMBOL, process.env.OWNER, process.env.TREASURY],
    envHint: "TOKEN_NAME, TOKEN_SYMBOL, OWNER, TREASURY",
  },
  ReservedVault: {
    sourceFile: "ReservedVault.sol",
    types: ["address", "address", "address"],
    args: () => [process.env.TOKEN_ADDRESS, process.env.OWNER, process.env.KEEPER],
    envHint: "TOKEN_ADDRESS, OWNER, KEEPER",
  },
  UniswapV3TokenInitializer: {
    sourceFile: "UniswapV3TokenInitializer.sol",
    types: [],
    args: () => [],
    envHint: "(no constructor arguments)",
  },
};

const CONTRACT = process.env.CONTRACT;
const ADDRESS = process.env.ADDRESS;
const API_KEY = process.env.ETHERSCAN_API_KEY;
const CHAIN_ID = process.env.CHAIN_ID || "56";

const spec = CONTRACTS[CONTRACT];
if (!spec) {
  throw new Error(`CONTRACT must be one of: ${Object.keys(CONTRACTS).join(", ")}`);
}
if (!ADDRESS || !API_KEY) {
  throw new Error("Set ADDRESS and ETHERSCAN_API_KEY (in .env) — see the usage comment at the top of this file.");
}

const constructorArgs = spec.args();
if (constructorArgs.some((a) => a === undefined || a === "")) {
  throw new Error(`${CONTRACT} needs: ${spec.envHint}`);
}

// Submit the same compile group the deployed bytecode came from, viaIR flag included —
// a viaIR contract verified against a legacy input will not match.
const group = groupForSourceFile(spec.sourceFile);
const { input, sources } = compileGroup(group);
input.sources = sources; // full transitive closure, captured during the compile

const constructorArguments =
  spec.types.length > 0 ? AbiCoder.defaultAbiCoder().encode(spec.types, constructorArgs).slice(2) : "";

const rawVersion = solc.version(); // e.g. "0.8.36+commit.8a079791.Emscripten.clang"
const versionMatch = rawVersion.match(/^(\d+\.\d+\.\d+)\+commit\.([0-9a-fA-F]+)/);
if (!versionMatch) throw new Error(`Couldn't parse solc version string: ${rawVersion}`);
const compilerversion = `v${versionMatch[1]}+commit.${versionMatch[2]}`;

console.log("Contract        :", `${spec.sourceFile}:${CONTRACT}`);
console.log("Address         :", ADDRESS);
console.log("Chain           :", CHAIN_ID);
console.log("Compiler        :", compilerversion);
console.log("Compile group   :", group, group === "viaIR" ? "(viaIR: true)" : "(legacy codegen)");
console.log("Sources bundled :", Object.keys(input.sources).length);
console.log("Constructor args:", constructorArguments || "(none)");

async function main() {
  const params = new URLSearchParams({
    module: "contract",
    action: "verifysourcecode",
    apikey: API_KEY,
    contractaddress: ADDRESS,
    sourceCode: JSON.stringify(input),
    codeformat: "solidity-standard-json-input",
    contractname: `${spec.sourceFile}:${CONTRACT}`,
    compilerversion,
    constructorArguments,
  });

  // The V2 API reads chainid off the URL's query string, not the POST body — it NOTOKs
  // with "Missing or unsupported chainid parameter" if it's only in the form-encoded
  // body, even though every other param is read from there.
  const submitRes = await fetch(`https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}`, {
    method: "POST",
    body: params,
  });
  const submitJson = await submitRes.json();
  if (submitJson.status !== "1") {
    throw new Error(`Submission rejected: ${submitJson.result || submitJson.message}`);
  }

  const guid = submitJson.result;
  console.log("\nSubmitted, guid:", guid);

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const checkUrl = new URL(`https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}`);
    checkUrl.searchParams.set("module", "contract");
    checkUrl.searchParams.set("action", "checkverifystatus");
    checkUrl.searchParams.set("guid", guid);
    checkUrl.searchParams.set("apikey", API_KEY);
    const statusJson = await (await fetch(checkUrl)).json();
    const result = statusJson.result || "";

    if (result.startsWith("Pending")) {
      console.log(`  [${i + 1}/20] pending...`);
      continue;
    }
    if (statusJson.status === "1") {
      console.log(`\nVerified: https://bscscan.com/address/${ADDRESS}#code`);
      return;
    }
    throw new Error(`Verification failed: ${result}`);
  }
  throw new Error("Timed out waiting for verification status");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
