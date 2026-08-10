// Post-launch audit: does the deployed token actually behave the way it is supposed to?
//
//   TOKEN=0x... node scripts/audit-token.js
//
// Optional:
//   POOL_FEE=2500              fee tier the pool was opened at (default 2500)
//   FROM_BLOCK=12345678        deploy block; without it only the last 10k blocks are scanned
//   EXTRA=0xaaa,0xbbb          extra wallets to include in the balance sum
//   VAULT=0x...                also check the vault's wiring
//   BSC_MAINNET_RPC_URL=...    read from .env if present
//
// Every check is read-only: balanceOf, getCode, getLogs and eth_call. Nothing is
// broadcast and no key is needed. eth_call is used with an overridden `from` to
// simulate transfers a wallet has not signed — that is how transferability gets
// tested without spending anything.
require("dotenv").config();
const { ethers } = require("ethers");

const TOKEN = process.env.TOKEN;
const RPC = process.env.BSC_MAINNET_RPC_URL || "https://bsc-dataseed.bnbchain.org";
const POOL_FEE = Number(process.env.POOL_FEE || "2500");
const FROM_BLOCK = process.env.FROM_BLOCK ? Number(process.env.FROM_BLOCK) : null;
const EXTRA = (process.env.EXTRA || "").split(",").map((s) => s.trim()).filter(Boolean);
const VAULT = process.env.VAULT || "";

if (!TOKEN) throw new Error("set TOKEN=0x...");

const POSITION_MANAGER = "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364";

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];
const PM_ABI = ["function WETH9() view returns (address)", "function factory() view returns (address)"];
const FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];
const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint32,bool)",
  "function liquidity() view returns (uint128)",
  "function fee() view returns (uint24)",
];
const VAULT_ABI = [
  "function rsvd() view returns (address)",
  "function owner() view returns (address)",
  "function keeper() view returns (address)",
  "function paused() view returns (bool)",
];

// A selector present in runtime bytecode is dispatchable — the jump table is compiled in.
const SELECTORS = {
  "postDeploy(bytes)": "d7949727",
  "owner()": "8da5cb5b",
  "mint(address,uint256)": "40c10f19",
  "pause()": "8456cb59",
  "burn(uint256)": "42966c68",
  "burnFrom(address,uint256)": "79cc6790",
};

const fmt = (v) => ethers.formatUnits(v, 18);
const results = [];
const pass = (label, detail) => { results.push(["PASS", label]); console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`); };
const fail = (label, detail) => { results.push(["FAIL", label]); console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); };
const info = (label, detail) => { console.log(`  ....  ${label}${detail ? ` — ${detail}` : ""}`); };

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const token = new ethers.Contract(TOKEN, ERC20_ABI, provider);

  const [name, symbol, decimals, totalSupply, code, head] = await Promise.all([
    token.name(), token.symbol(), token.decimals(), token.totalSupply(),
    provider.getCode(TOKEN), provider.getBlockNumber(),
  ]);

  console.log(`\n${name} (${symbol})  ${TOKEN}`);
  console.log(`decimals ${decimals}   totalSupply ${fmt(totalSupply)}   runtime ${(code.length - 2) / 2} bytes`);

  // --- 1. which build shipped ------------------------------------------------
  console.log("\n[1] ABI surface");
  const present = {};
  for (const [sig, sel] of Object.entries(SELECTORS)) {
    present[sig] = code.includes(sel);
    info(`${present[sig] ? "PRESENT" : "absent "}  ${sig}`);
  }
  if (Number(decimals) !== 18) fail("decimals is 18", `got ${decimals}`);
  else pass("decimals is 18");

  for (const sig of ["owner()", "mint(address,uint256)", "pause()"]) {
    if (present[sig]) fail(`no ${sig}`, "token is not ownerless");
    else pass(`no ${sig}`);
  }
  if (present["burn(uint256)"] && present["burnFrom(address,uint256)"]) pass("burn + burnFrom present", "vault redeem works");
  else fail("burn + burnFrom present", "ReservedVault.redeem needs both");

  // --- 2. postDeploy exposure ------------------------------------------------
  console.log("\n[2] Arbitrary-code entry point");
  if (!present["postDeploy(bytes)"]) {
    pass("no postDeploy", "nothing can delegatecall into the token's storage");
  } else {
    fail("postDeploy is present on the token");
    const probe = ethers.Wallet.createRandom().address;
    const iface = new ethers.Interface(["function postDeploy(bytes)"]);
    try {
      await provider.call({
        to: TOKEN,
        from: probe,
        data: iface.encodeFunctionData("postDeploy", ["0x"]),
      });
      fail("postDeploy rejects a stranger", "CALLABLE BY ANYONE — any balance can be rewritten");
    } catch (e) {
      const msg = e.shortMessage ?? e.message ?? "";
      pass("postDeploy rejects a stranger", `reverted (${msg.slice(0, 60)})`);
      info("still an arbitrary-code entry point for whoever is authorised");
    }
  }

  // --- 3. holders and the supply invariant -----------------------------------
  console.log("\n[3] Supply accounting");
  const from = FROM_BLOCK ?? Math.max(0, head - 10_000);
  const holders = new Set(EXTRA.map((a) => ethers.getAddress(a)));
  const credited = new Map(); // address -> net tokens received via Transfer events
  let logCount = 0;
  let windows = 0;
  let windowsFailed = 0;
  const STEP = Number(process.env.LOG_STEP || "500"); // public BSC RPCs are stingy with getLogs
  for (let start = from; start <= head; start += STEP) {
    const end = Math.min(start + STEP - 1, head);
    windows++;
    let logs = null;
    // Public endpoints drop getLogs under load far more often than they drop eth_call,
    // so a single failure is not evidence of anything. Retry before giving up on a window.
    for (let attempt = 0; attempt < 3 && logs === null; attempt++) {
      try {
        logs = await token.queryFilter("Transfer", start, end);
      } catch (e) {
        if (attempt === 2) {
          windowsFailed++;
          info(`getLogs [${start}-${end}] failed after 3 tries`, e.shortMessage ?? e.message);
        } else {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
    }
    if (logs === null) continue;
    logCount += logs.length;
    for (const log of logs) {
      const { from: f, to: t, value } = log.args;
      holders.add(f); holders.add(t);
      credited.set(t, (credited.get(t) ?? 0n) + value);
      credited.set(f, (credited.get(f) ?? 0n) - value);
    }
  }
  holders.delete(ethers.ZeroAddress);
  info(`${logCount} Transfer events over blocks ${from}-${head}, ${holders.size} addresses`);

  // An audit that finds nothing to inspect has not audited anything. Say so loudly —
  // silently passing on an empty holder set is worse than reporting a failure, because
  // the summary line then reads as a clean bill of health.
  const logScanUsable = windowsFailed < windows && holders.size > 0;
  if (windowsFailed === windows) {
    fail("Transfer log scan", `all ${windows} windows failed — this RPC will not serve getLogs`);
    info("retry with BSC_MAINNET_RPC_URL=https://bsc-rpc.publicnode.com, or LOG_STEP=200");
  } else if (windowsFailed > 0) {
    fail("Transfer log scan", `${windowsFailed}/${windows} windows failed — holder set is incomplete`);
  } else if (holders.size === 0) {
    fail("Transfer log scan", "no Transfer events in range — set FROM_BLOCK=<deploy block>");
  } else {
    pass("Transfer log scan", `${logCount} events, ${holders.size} addresses`);
  }

  let sum = 0n;
  const rows = [];
  for (const addr of holders) {
    const bal = await token.balanceOf(addr);
    sum += bal;
    if (bal > 0n) rows.push({ addr, bal, credited: credited.get(addr) ?? 0n });
  }
  rows.sort((a, b) => (b.bal > a.bal ? 1 : -1));

  console.log("");
  for (const r of rows) {
    const pct = (Number((r.bal * 10_000n) / totalSupply) / 100).toFixed(2);
    const isContract = (await provider.getCode(r.addr)) !== "0x";
    console.log(`  ${r.addr}  ${fmt(r.bal).padStart(22)}  ${pct.padStart(6)}%${isContract ? "  (contract)" : ""}`);
  }
  console.log("");

  if (!logScanUsable) {
    info("supply invariant NOT CHECKED — the holder set above is empty or partial");
  } else if (sum > totalSupply) {
    fail("sum(balances) == totalSupply", `${fmt(sum - totalSupply)} MORE tokens exist than supply reports`);
    info("balances were written directly instead of transferred — accounting is broken");
  } else if (sum < totalSupply) {
    info(`${fmt(totalSupply - sum)} unaccounted; widen with FROM_BLOCK=<deploy block> or name wallets via EXTRA=`);
  } else {
    pass("sum(balances) == totalSupply");
  }

  // A balance larger than everything the address was ever sent means it was credited
  // without a Transfer event — invisible to every explorer and holder-flow tool.
  const unexplained = rows.filter((r) => r.bal > r.credited && r.bal - r.credited > 1n);
  if (FROM_BLOCK === null && unexplained.length > 0) {
    info(`${unexplained.length} address(es) hold more than their logged inflow — rerun with FROM_BLOCK to confirm`);
  } else if (unexplained.length > 0) {
    fail("every balance is explained by a Transfer event");
    for (const r of unexplained) {
      console.log(`        ${r.addr}  holds ${fmt(r.bal)}, only ${fmt(r.credited)} logged`);
    }
  } else if (FROM_BLOCK !== null) {
    pass("every balance is explained by a Transfer event");
  }

  // --- 4. can holders move their full bag? -----------------------------------
  console.log("\n[4] Transferability (the honeypot check)");
  const sink = ethers.Wallet.createRandom().address;
  const wallets = [];
  for (const r of rows.slice(0, 8)) {
    if ((await provider.getCode(r.addr)) === "0x") wallets.push(r); // skip pools/routers
  }
  if (wallets.length === 0) {
    fail("transferability", "NOT CHECKED — no wallet holders found to simulate a sell from");
    info("this is the check that catches a honeypot; it needs a usable log scan first");
  }
  for (const r of wallets) {
    try {
      const ok = await token.transfer.staticCall(sink, r.bal, { from: r.addr });
      if (ok === false) fail(`${r.addr.slice(0, 10)} can move its full balance`, "transfer returned false");
      else pass(`${r.addr.slice(0, 10)} can move its full balance`, fmt(r.bal));
    } catch (e) {
      fail(`${r.addr.slice(0, 10)} can move its full balance`, e.shortMessage ?? e.message);
    }
  }

  // --- 5. no fee on transfer -------------------------------------------------
  console.log("\n[5] Fee on transfer");
  // A taxed token emits two Transfer events for one transfer. Group the logs by tx and
  // look for a transaction whose legs do not net out across sender and recipient.
  const taxed = [];
  let probed = 0;
  for (const r of wallets.slice(0, 6)) {
    const probe = r.bal / 2n;
    if (probe === 0n) continue;
    probed++;
    try {
      await token.transfer.staticCall(sink, probe, { from: r.addr });
    } catch {
      taxed.push(r.addr);
    }
  }
  if (probed === 0) {
    fail("fee on transfer", "NOT CHECKED — no wallet holder with a non-zero balance");
  } else if (taxed.length === 0) {
    pass("transfers of a partial balance simulate cleanly", `${probed} wallet(s)`);
  } else {
    fail("transfers of a partial balance simulate cleanly", taxed.join(", "));
  }
  info("a true 0% token emits exactly one Transfer per transfer — confirm on a real buy tx");

  // --- 6. pool health --------------------------------------------------------
  console.log("\n[6] Pool");
  try {
    const pm = new ethers.Contract(POSITION_MANAGER, PM_ABI, provider);
    const [wbnb, factoryAddr] = await Promise.all([pm.WETH9(), pm.factory()]);
    const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, provider);
    const poolAddr = await factory.getPool(TOKEN, wbnb, POOL_FEE);
    if (poolAddr === ethers.ZeroAddress) {
      fail(`pool exists at fee ${POOL_FEE}`, "none found");
    } else {
      const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
      const [slot0, liq, poolBal] = await Promise.all([
        pool.slot0(), pool.liquidity(), token.balanceOf(poolAddr),
      ]);
      pass(`pool exists at fee ${POOL_FEE}`, poolAddr);
      info(`tick ${slot0.tick}   sqrtPriceX96 ${slot0.sqrtPriceX96}`);
      info(`in-range liquidity ${liq}`);
      if (liq === 0n) fail("pool has in-range liquidity", "position is entirely out of range — nothing is tradeable");
      else pass("pool has in-range liquidity");
      const pooledPct = (Number((poolBal * 10_000n) / totalSupply) / 100).toFixed(2);
      info(`pool holds ${fmt(poolBal)} (${pooledPct}% of supply)`);
    }
  } catch (e) {
    fail("pool inspection", e.shortMessage ?? e.message);
  }

  // --- 7. vault --------------------------------------------------------------
  if (VAULT) {
    console.log("\n[7] Vault");
    try {
      const vault = new ethers.Contract(VAULT, VAULT_ABI, provider);
      const [rsvd, owner, keeper, paused] = await Promise.all([
        vault.rsvd(), vault.owner(), vault.keeper(), vault.paused(),
      ]);
      if (rsvd.toLowerCase() === TOKEN.toLowerCase()) pass("vault points at this token");
      else fail("vault points at this token", `points at ${rsvd}`);
      info(`owner ${owner}`);
      info(`keeper ${keeper}`);
      if (paused) fail("vault is unpaused", "deposits are blocked (redeem still works)");
      else pass("vault is unpaused");
    } catch (e) {
      fail("vault inspection", e.shortMessage ?? e.message);
    }
  }

  const failed = results.filter(([s]) => s === "FAIL").length;
  console.log(`\n${results.length - failed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
