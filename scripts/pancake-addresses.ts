/**
 * PancakeSwap V3 deployment addresses, shared by launch.ts and check-reference-pool.ts.
 *
 * VERIFY THESE against PancakeSwap's published deployment list before a mainnet run.
 * The scripts check each address has code and that the position manager answers WETH9(),
 * which catches typos and wrong-chain values — it cannot tell you this is the deployment
 * your users will actually route through.
 */
export type Deployment = {
  positionManager: string;
  swapRouter: string;
  stablecoin: string;
  label: string;
};

export const DEPLOYMENTS: Record<number, Deployment> = {
  56: {
    label: "BSC mainnet / PancakeSwap V3",
    positionManager: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
    swapRouter: "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
    stablecoin: "0x55d398326f99059fF775485246999027B3197955", // USDT (18 dp on BSC)
  },
  97: {
    label: "BSC testnet / PancakeSwap V3",
    positionManager: "0x427bF5b37357632377eCbEC9de3626C71A5396c1",
    swapRouter: "0x9a489505a00cE272eAa5e07Dba6491314CaE3796",
    stablecoin: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd", // testnet USDT
  },
};
