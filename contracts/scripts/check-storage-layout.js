// Fails if the committed storage-layout snapshots don't match what the current sources
// compile to. Run in CI (and before any deploy that expects layout continuity).
//
// WHY THIS EXISTS: storage layout drift fails *silently*. A shifted slot writes to the
// wrong place rather than reverting, so nothing catches it at compile or test time — and
// anything reading these contracts' raw storage, or any future upgradeable variant, breaks
// in a way that looks like corrupted state rather than an obvious error. Relying on a human
// (or an assistant) to remember to mention "by the way, storage moved" is exactly the wrong
// control for a silent failure mode. This makes it mechanical.
//
//   node scripts/check-storage-layout.js
//
// If it fails legitimately (you meant to change storage), re-run the compiler and commit
// the updated snapshots — the point is that the change is visible and deliberate, not that
// it never happens.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const LAYOUT_DIR = path.join(__dirname, "..", "storage-layout");

function snapshot() {
  const out = {};
  if (!fs.existsSync(LAYOUT_DIR)) return out;
  for (const f of fs.readdirSync(LAYOUT_DIR).sort()) {
    out[f] = fs.readFileSync(path.join(LAYOUT_DIR, f), "utf8");
  }
  return out;
}

const before = snapshot();
if (Object.keys(before).length === 0) {
  console.error("No committed storage layouts found. Run `node scripts/offline-compile.js` and commit storage-layout/.");
  process.exit(1);
}

execFileSync("node", [path.join(__dirname, "offline-compile.js")], { stdio: "ignore" });
const after = snapshot();

const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
const drifted = [];

for (const name of names) {
  if (!(name in before)) {
    drifted.push(`  ${name}: NEW contract layout, not yet committed`);
    continue;
  }
  if (!(name in after)) {
    drifted.push(`  ${name}: layout no longer produced (contract removed or renamed?)`);
    continue;
  }
  if (before[name] === after[name]) continue;

  // Report slot-level detail rather than "files differ" — the useful question is always
  // *which variable moved*, since that determines whether anything downstream breaks.
  const a = JSON.parse(before[name]).storage.map((e) => `${e.slot}:${e.label}`);
  const b = JSON.parse(after[name]).storage.map((e) => `${e.slot}:${e.label}`);
  const moved = [];
  for (const entry of new Set([...a, ...b])) {
    if (!a.includes(entry)) moved.push(`    + ${entry}`);
    else if (!b.includes(entry)) moved.push(`    - ${entry}`);
  }
  drifted.push(`  ${name}:\n${moved.sort().join("\n")}`);
}

if (drifted.length > 0) {
  console.error("Storage layout drift detected:\n");
  console.error(drifted.join("\n"));
  console.error("\nIf this was intentional, commit the regenerated storage-layout/ files.");
  process.exit(1);
}

console.log(`Storage layout unchanged across ${names.length} contracts.`);
