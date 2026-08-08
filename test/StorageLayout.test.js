const { expect } = require("chai");
const fs = require("fs");
const path = require("path");

// Anything reached through ReservedToken.postDeploy runs as a delegatecall: the
// initializer's code, the token's storage. If the initializer's variable declarations
// drift out of alignment with the token's — a reordered field, a new base contract,
// an OpenZeppelin bump — the delegatecall writes the wrong slots and silently corrupts
// balances, ownership or the tax config. There is no runtime check for this, so it has
// to be caught at build time.
const LAYOUTS = path.join(__dirname, "..", "artifacts", "storage-layouts.json");

// Contracts whose declarations must mirror ReservedToken slot for slot.
const DELEGATECALL_TARGETS = ["UniswapV3TokenInitializer", "MockSupplyInitializer"];

function normalise(layout) {
  return layout.storage.map((entry) => ({
    slot: entry.slot,
    offset: entry.offset,
    label: entry.label,
    type: layout.types[entry.type].label,
  }));
}

describe("storage layout alignment", function () {
  let layouts;

  before(function () {
    expect(fs.existsSync(LAYOUTS), `${LAYOUTS} missing — run scripts/offline-compile.js first`).to.equal(true);
    layouts = JSON.parse(fs.readFileSync(LAYOUTS, "utf8"));
  });

  it("emits a layout for ReservedToken", function () {
    expect(layouts).to.have.property("ReservedToken");
    expect(normalise(layouts.ReservedToken).length).to.be.greaterThan(0);
  });

  for (const name of DELEGATECALL_TARGETS) {
    it(`${name} mirrors ReservedToken's layout exactly`, function () {
      expect(layouts, `${name} was not compiled`).to.have.property(name);

      const token = normalise(layouts.ReservedToken);
      const target = normalise(layouts[name]);

      // The initializer may not redeclare trailing variables it never touches, but
      // everything it does declare has to line up from slot 0 with no gaps.
      expect(target.length, `${name} declares more variables than ReservedToken`).to.be.at.most(token.length);
      expect(target).to.deep.equal(token.slice(0, target.length));
    });
  }
});
