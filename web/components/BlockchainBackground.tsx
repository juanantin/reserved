// Decorative network background: nodes + edges evoking a blockchain graph, with a
// handful of bStock coins travelling along edges via native SVG <animate> (no JS needed,
// so this stays a server component). Motion is hidden under prefers-reduced-motion via
// the .travel-dot rule in globals.css; the static nodes/edges remain either way.
const nodes: Array<[number, number]> = [
  [80, 120], [220, 60], [340, 180], [180, 280], [420, 90],
  [560, 220], [480, 320], [650, 80], [760, 180], [700, 300],
  [860, 100], [980, 220], [900, 340], [1080, 140], [1200, 80],
  [1150, 260], [1300, 180], [1380, 320], [1020, 380], [300, 400],
];

const edgeIndexPairs: Array<[number, number]> = [
  [0, 1], [1, 2], [0, 3], [2, 3], [2, 4], [4, 5], [3, 6], [5, 6],
  [4, 7], [7, 8], [5, 8], [6, 9], [8, 9], [7, 10], [10, 11], [8, 11],
  [9, 12], [11, 12], [10, 13], [13, 14], [11, 15], [13, 15], [12, 18],
  [15, 16], [14, 16], [16, 17], [15, 18], [3, 19], [6, 19],
];

const edges = edgeIndexPairs.map(([a, b]) => ({
  x1: nodes[a][0], y1: nodes[a][1],
  x2: nodes[b][0], y2: nodes[b][1],
}));

// A subset of edges carry a travelling coin, with varied speed/offset for an organic,
// non-synchronized feel.
const travelEdgeIndexes = [0, 4, 8, 12, 16, 20, 24, 28];

// The same glyph cutouts ReserveCoins mounts on its spinning discs, so the background
// coins and the foreground ones are visibly the same objects.
const COIN_GLYPHS = [
  "/images/bstock-icons/nvidia.png",
  "/images/bstock-icons/tesla.png",
  "/images/bstock-icons/circle.png",
  "/images/bstock-icons/micron.png",
  "/images/bstock-icons/sandisk.png",
];

// Radius of a travelling coin, in viewBox units. The plain dots this replaced were 2.5,
// which is too small for a glyph to resolve at all; 5 is about the floor for reading as
// a coin rather than a smudge.
const COIN_R = 5;

// Every section below the hero renders this at opacity-40, so the coins arrive already
// dimmed there — but they still carried more weight than the faded graph behind them.
// The section variant drops their peak opacity further so they sit in the background
// rather than on top of it. Hero, at full strength, keeps them bright.
const PEAK_OPACITY = { hero: 0.75, section: 0.32 } as const;

export function BlockchainBackground({
  className = "",
  variant = "section",
}: {
  className?: string;
  /// "hero" only for the full-strength top-of-page background; everything else is
  /// rendered at opacity-40 and wants the quieter coins.
  variant?: "hero" | "section";
}) {
  const peak = PEAK_OPACITY[variant];
  return (
    <svg
      viewBox="0 0 1440 440"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      aria-hidden="true"
    >
      <defs>
        {/* Mirrors the CSS gradient on ReserveCoins' CoinFace: a curved highlight band
            catching light across a gold disc, rather than a flat tinted circle. */}
        <linearGradient id="bg-coin-face" x1="0%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%" stopColor="#6b5416" />
          <stop offset="12%" stopColor="#a9822a" />
          <stop offset="26%" stopColor="#f5d576" />
          <stop offset="34%" stopColor="#fff6d9" />
          <stop offset="44%" stopColor="#f5d576" />
          <stop offset="62%" stopColor="#C89A2E" />
          <stop offset="82%" stopColor="#8a6d1d" />
          <stop offset="100%" stopColor="#6b5416" />
        </linearGradient>
        {/* Keeps each glyph inside its disc rather than overhanging the rim. */}
        <clipPath id="bg-coin-clip">
          <circle cx="0" cy="0" r={COIN_R} />
        </clipPath>
      </defs>

      {edges.map((e, i) => (
        <line
          key={i}
          x1={e.x1}
          y1={e.y1}
          x2={e.x2}
          y2={e.y2}
          stroke="#D4AF37"
          strokeOpacity="0.08"
          strokeWidth="1"
        />
      ))}

      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2 + (i % 3)} fill="#D4AF37" fillOpacity="0.22" />
      ))}

      {travelEdgeIndexes.map((edgeIdx, i) => {
        const e = edges[edgeIdx];
        const dur = 3.5 + (i % 4) * 1.1;
        const begin = -(i * 0.9).toFixed(1);
        const glyph = COIN_GLYPHS[i % COIN_GLYPHS.length];
        // The glyph sits in a square box inset from the rim, letter-boxed to keep its
        // own aspect ratio — the cutouts are not square.
        const glyphSize = COIN_R * 1.2;

        return (
          // Translating a group beats animating cx/cy on each child: the disc, its rim
          // and the glyph stay locked together and move as one object.
          <g key={edgeIdx} className="travel-dot">
            <animateTransform
              attributeName="transform"
              type="translate"
              values={`${e.x1},${e.y1}; ${e.x2},${e.y2}; ${e.x1},${e.y1}`}
              dur={`${dur}s`}
              begin={`${begin}s`}
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values={`0;${peak};${peak};0`}
              keyTimes="0;0.1;0.9;1"
              dur={`${dur}s`}
              begin={`${begin}s`}
              repeatCount="indefinite"
            />
            <circle cx="0" cy="0" r={COIN_R} fill="url(#bg-coin-face)" />
            <circle
              cx="0"
              cy="0"
              r={COIN_R}
              fill="none"
              stroke="#FFF1C4"
              strokeOpacity="0.55"
              strokeWidth="0.6"
            />
            <image
              href={glyph}
              x={-glyphSize / 2}
              y={-glyphSize / 2}
              width={glyphSize}
              height={glyphSize}
              preserveAspectRatio="xMidYMid meet"
              clipPath="url(#bg-coin-clip)"
              opacity="0.9"
            />
          </g>
        );
      })}
    </svg>
  );
}
