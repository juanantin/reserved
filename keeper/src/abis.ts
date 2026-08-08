// Minimal hand-written ABIs — just what the keeper bot calls or reads. Kept in sync
// manually with contracts/contracts/TreasuryConverter.sol; if that contract's function
// signatures change, update here too (there's no shared artifact pipeline between the
// two npm projects by design — the keeper only needs a tiny slice of the full ABI).

export const TREASURY_CONVERTER_ABI = [
  "function keeper() view returns (address)",
  "function owner() view returns (address)",
  "function WBNB() view returns (address)",
  "function maxRsvdSpendPerTx() view returns (uint256)",
  "function maxBnbSpendPerTx() view returns (uint256)",
  "function minTwapWindow() view returns (uint256)",
  "function isAllowedReserveAsset(address) view returns (bool)",
  "function bStockUsdtPair(address) view returns (address)",
  "function priceFeed() view returns (address)",
  "function requirePriceFloorForBuys() view returns (bool)",
  "function twapCheckpoints(address subject) view returns (uint256 cumulative, uint32 timestamp)",
  "function updateTwapCheckpoint()",
  "function updateBStockTwapCheckpoint(address bStock)",
  "function sellRsvd(uint256 amountIn, uint256 keeperMinOut) returns (uint256 bnbOut)",
  "function buyReserveAsset(uint256 bnbIn, uint256 keeperMinOut, address targetToken, address[] path) returns (uint256 tokenOut)",
  "function depositReserveAsset(address token, uint256 amount)",
  "event RsvdSold(uint256 amountIn, uint256 bnbOut, uint256 minOut)",
  "event ReserveAssetBought(address indexed token, uint256 bnbIn, uint256 tokenOut, uint256 minOut)",
  "event ReserveAssetDeposited(address indexed token, uint256 amount)",
];

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];
