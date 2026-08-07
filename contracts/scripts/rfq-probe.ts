import { ethers } from "hardhat";

// Runs the RfqProbe diagnostic end to end: deploy (or reuse) the probe, fund it, forward
// one captured swap calldata, decode what the venue said, then sweep everything back.
//
// WHAT THIS ANSWERS: whether the bStocks RFQ venue will fill an order placed by a
// contract. If it won't, TreasuryConverterV2's executor can never buy these assets and the
// whole keeper-automation path needs rethinking — worth ~$10 to find out before more work
// goes into it.
//
// HOW TO GET THE CALLDATA:
//   1. Do a small manual swap in the PancakeSwap UI (BNB -> the bStock you're testing).
//   2. Open the transaction on BscScan -> Overview -> "Click to show more" -> Input Data.
//   3. Copy the raw hex ("0x...") and the "Interacted With (To)" address.
//   4. Pass them as CALLDATA and TARGET below, with VALUE matching the BNB the swap sent.
//
// READ THE RESULT CAREFULLY. RFQ quotes are usually signed over specific parameters,
// frequently including the taker address, so a replayed quote may fail because it was
// bound to your wallet rather than because contracts are refused. Those two are
// indistinguishable from a bare revert. Run this twice — once with a freshly-requested
// quote, once with a stale replayed one — and compare the decoded reasons.
//
//   PROBE_ADDRESS=            (optional — reuses an existing probe instead of deploying)
//   TARGET=0x...              router/aggregator the manual swap called
//   CALLDATA=0x...            raw input data from that swap
//   TOKEN_OUT=0x...           the bStock you expect to receive
//   VALUE=0.01                BNB to attach, in ether units
//   npx hardhat run scripts/rfq-probe.ts --network bscMainnet
const PROBE_ADDRESS = process.env.PROBE_ADDRESS || "";
const TARGET = process.env.TARGET || "";
const CALLDATA = process.env.CALLDATA || "";
const TOKEN_OUT = process.env.TOKEN_OUT || "";
const VALUE = process.env.VALUE || "0.01";

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

/// Best-effort decode of a revert payload: standard Error(string), custom-error selector,
/// or empty (which usually means a bare `revert()`/`require` with no reason, or an
/// out-of-gas). The raw bytes are always printed too, since a custom-error selector is
/// still identifying even when we can't name it.
function decodeRevert(data: string): string {
  if (!data || data === "0x") return "(empty — bare revert/require with no reason, or out of gas)";
  if (data.startsWith("0x08c379a0")) {
    try {
      const [reason] = ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + data.slice(10));
      return `Error("${reason}")`;
    } catch {
      /* fall through to raw */
    }
  }
  if (data.startsWith("0x4e487b71")) {
    try {
      const [code] = ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], "0x" + data.slice(10));
      return `Panic(0x${code.toString(16)})`;
    } catch {
      /* fall through to raw */
    }
  }
  return `custom error, selector ${data.slice(0, 10)}`;
}

async function main() {
  if (!TARGET || !CALLDATA || !TOKEN_OUT) {
    throw new Error("Set TARGET, CALLDATA and TOKEN_OUT env vars first — see the header of this script.");
  }

  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("No account configured — check contracts/.env.");

  const value = ethers.parseEther(VALUE);
  const tokenOut = await ethers.getContractAt(ERC20_ABI, TOKEN_OUT);
  const [symbol, decimals] = await Promise.all([tokenOut.symbol(), tokenOut.decimals()]);

  console.log("Signer:", signer.address);
  console.log("Target:", TARGET);
  console.log("Token out:", `${symbol} (${TOKEN_OUT})`);
  console.log("Value:", VALUE, "BNB");
  console.log("Calldata:", CALLDATA.slice(0, 74) + (CALLDATA.length > 74 ? `... (${CALLDATA.length} chars)` : ""));

  let probe: any;
  if (PROBE_ADDRESS) {
    probe = await ethers.getContractAt("RfqProbe", PROBE_ADDRESS);
    console.log("\nReusing probe at:", PROBE_ADDRESS);
  } else {
    const Probe = await ethers.getContractFactory("RfqProbe");
    probe = await Probe.deploy();
    await probe.waitForDeployment();
    console.log("\nRfqProbe deployed to:", await probe.getAddress());
  }
  const probeAddress = await probe.getAddress();

  console.log("\nForwarding the swap through the probe contract...");
  const tx = await probe.probe(TARGET, CALLDATA, TOKEN_OUT, { value });
  const receipt = await tx.wait();
  console.log("tx:", receipt.hash);

  const parsed = receipt.logs
    .map((log: any) => {
      try {
        return probe.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((e: any) => e && e.name === "ProbeResult");

  if (!parsed) {
    console.log("\nNo ProbeResult event found — unexpected. Inspect the tx on BscScan directly.");
    return;
  }

  const { success, received, returnData } = parsed.args;

  console.log("\n--- RESULT ---");
  if (success && received > 0n) {
    console.log(`FILLED: received ${ethers.formatUnits(received, decimals)} ${symbol}`);
    console.log("\nThe venue settled for a contract caller. TreasuryConverterV2's executor can");
    console.log("buy this asset, and the keeper-automation path is viable. Next unknown is the");
    console.log("quote API — how the bot obtains a fresh signed quote per cycle.");
  } else if (success && received === 0n) {
    console.log("Call SUCCEEDED but no tokens arrived.");
    console.log("\nLikely the calldata sent the output somewhere else — captured calldata usually");
    console.log("encodes the original recipient (your wallet), not the caller. Re-run with the");
    console.log("recipient field patched to the probe address, or this tells you nothing about");
    console.log("whether contracts are allowed.");
    console.log(`Probe address to encode as recipient: ${probeAddress}`);
  } else {
    console.log("REVERTED:", decodeRevert(returnData));
    console.log("raw:", returnData);
    console.log("\nBefore concluding contracts are refused, rule out the boring explanations:");
    console.log("  - quote expired (they are short-lived — seconds to a couple of minutes)");
    console.log("  - quote was signed for YOUR address as taker, so it cannot be replayed at all");
    console.log("  - recipient encoded in the calldata is your wallet, not the probe");
    console.log("A fresh quote requested with the probe as taker is the only clean test. If the");
    console.log("venue has no way to request a quote for an arbitrary taker, that IS the answer:");
    console.log("the automation path is closed and the manual bridge is the real option.");
  }

  // Sweep everything back — this contract is disposable and holds real money.
  console.log("\nSweeping funds back to signer...");
  if (received > 0n) {
    await (await probe.withdrawToken(TOKEN_OUT)).wait();
    console.log(`  withdrew ${symbol}`);
  }
  const nativeBal = await ethers.provider.getBalance(probeAddress);
  if (nativeBal > 0n) {
    await (await probe.withdrawNative()).wait();
    console.log(`  withdrew ${ethers.formatEther(nativeBal)} BNB`);
  }
  console.log("\nDone. Probe left deployed at", probeAddress, "— reuse with PROBE_ADDRESS=");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
