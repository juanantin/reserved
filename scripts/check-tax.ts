import { ethers } from "hardhat";

/**
 * Reconstructs every RSVD transfer from the token's own event log and reports whether
 * the buy/sell tax actually fired, then reports what the vault holds.
 *
 * The tax is applied inside ReservedToken._update: a taxed transfer emits TWO Transfer
 * events, `from -> treasury` for the tax and `from -> to` for the net. So a taxed buy is
 * visible as a pair sharing a transaction hash, and an untaxed one is a single event.
 *
 *   TOKEN=0x... FROM_BLOCK=114824000 npm run check:tax:mainnet
 */

const TOKEN = process.env.TOKEN!;
const FROM_BLOCK = Number(process.env.FROM_BLOCK || "0");
const CHUNK = Number(process.env.CHUNK || "2000");

const TOKEN_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function treasury() view returns (address)",
  "function taxBps() view returns (uint256)",
  "function BPS_DENOMINATOR() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function symbol() view returns (string)",
  "function isAmmPair(address) view returns (bool)",
  "function isTaxExempt(address) view returns (bool)",
];
const VAULT_ABI = [
  "function reserveAssets(uint256) view returns (address)",
  "function keeper() view returns (address)",
];

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-4)}`;

async function main() {
  if (!TOKEN) throw new Error("Set TOKEN to the token address");
  const token = new ethers.Contract(TOKEN, TOKEN_ABI, ethers.provider);

  const [symbol, treasury, taxBps, denom, supply] = await Promise.all([
    token.symbol(),
    token.treasury(),
    token.taxBps(),
    token.BPS_DENOMINATOR(),
    token.totalSupply(),
  ]);

  const latest = await ethers.provider.getBlockNumber();
  const from = FROM_BLOCK || latest - 20_000;

  console.log(`\nToken     : ${TOKEN} (${symbol})`);
  console.log(`Treasury  : ${treasury}`);
  console.log(`Tax rate  : ${taxBps} bps (${Number(taxBps) / 100}%)`);
  console.log(`Blocks    : ${from} → ${latest}`);

  // Pull the full log in chunks — public BSC endpoints cap eth_getLogs ranges.
  const events: any[] = [];
  for (let start = from; start <= latest; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, latest);
    events.push(...(await token.queryFilter(token.filters.Transfer(), start, end)));
  }
  console.log(`Transfers : ${events.length}`);

  // Group by transaction: a taxed transfer emits two events in one tx.
  const byTx = new Map<string, any[]>();
  for (const e of events) {
    if (!byTx.has(e.transactionHash)) byTx.set(e.transactionHash, []);
    byTx.get(e.transactionHash)!.push(e);
  }

  console.log(`\n${"tx".padEnd(12)} ${"from".padEnd(14)} ${"to".padEnd(14)} ${"amount".padStart(22)}  tax?`);
  console.log("-".repeat(76));

  let totalTax = 0n;
  for (const [hash, group] of byTx) {
    const taxLeg = group.find(
      (e) => e.args.to.toLowerCase() === treasury.toLowerCase() && e.args.from !== ethers.ZeroAddress
    );
    for (const e of group) {
      const isTax = taxLeg && e === taxLeg;
      if (isTax) totalTax += e.args.value;
      console.log(
        `${hash.slice(0, 10)}.. ${short(e.args.from).padEnd(14)} ${short(e.args.to).padEnd(14)} ` +
          `${ethers.formatUnits(e.args.value, 18).padStart(22)}  ${isTax ? "TAX" : ""}`
      );
    }
    if (taxLeg && group.length === 2) {
      const net = group.find((e) => e !== taxLeg)!;
      const gross = net.args.value + taxLeg.args.value;
      const expected = (gross * BigInt(taxBps)) / BigInt(denom);
      const ok = expected === taxLeg.args.value;
      console.log(
        `${" ".repeat(12)} └─ gross ${ethers.formatUnits(gross, 18)} → tax ${ethers.formatUnits(
          taxLeg.args.value,
          18
        )} (expected ${ethers.formatUnits(expected, 18)}) ${ok ? "✓" : "✗ MISMATCH"}`
      );
    }
  }

  const treasuryBalance = await token.balanceOf(treasury);
  console.log(`\nTax collected this range : ${ethers.formatUnits(totalTax, 18)} ${symbol}`);
  console.log(`Treasury balance now     : ${ethers.formatUnits(treasuryBalance, 18)} ${symbol}`);
  console.log(`  (treasury is also the deployer here, so this includes non-tax holdings)`);
  console.log(`Total supply             : ${ethers.formatUnits(supply, 18)} ${symbol}`);

  // --- what the vault actually holds ---------------------------------------
  const VAULT = process.env.VAULT;
  if (VAULT) {
    const vault = new ethers.Contract(VAULT, VAULT_ABI, ethers.provider);
    console.log(`\nVault     : ${VAULT}`);
    console.log(`  keeper  : ${await vault.keeper()}`);
    let count = 0;
    for (;;) {
      try {
        const asset = await vault.reserveAssets(count);
        console.log(`  asset ${count}: ${asset}`);
        count++;
      } catch {
        break;
      }
    }
    console.log(`  reserve assets registered: ${count}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
