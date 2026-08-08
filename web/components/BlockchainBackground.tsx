// Decorative network background: nodes + edges evoking a blockchain graph, with a
// handful of light particles animating along edges via native SVG <animate> (no JS
// needed, so this stays a server component). Particle motion is hidden under
// prefers-reduced-motion via the .travel-dot rule in globals.css; the static
// nodes/edges remain either way.
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

// A subset of edges get a traveling particle, with varied speed/offset for an
// organic, non-synchronized feel.
const travelEdgeIndexes = [0, 4, 8, 12, 16, 20, 24, 28];

export function BlockchainBackground({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1440 440"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      aria-hidden="true"
    >
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
        return (
          <circle key={edgeIdx} r="2.5" fill="#F2D989" className="travel-dot">
            <animate attributeName="cx" values={`${e.x1};${e.x2};${e.x1}`} dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" />
            <animate attributeName="cy" values={`${e.y1};${e.y2};${e.y1}`} dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;0.55;0.55;0" keyTimes="0;0.1;0.9;1" dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" />
          </circle>
        );
      })}
    </svg>
  );
}
