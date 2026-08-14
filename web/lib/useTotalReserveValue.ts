"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { tokenInfo } from "@/config/token";
import { getReadProvider, getTreasuryHoldings, PANCAKE_V2_FACTORY, USDT_ADDRESS, PANCAKE_FACTORY_ABI, PAIR_RESERVES_ABI } from "./contracts";
import { fetchDexscreenerPriceUsd } from "./dexscreener";

export type TotalReserveValue = {
  value: number | null;
  /** At least one held bStock (non-zero balance) couldn't be priced by any source —
   * `value` is still a real total of whatever *could* be priced, not a placeholder. */
  incomplete: boolean;
  failed: boolean;
};

// Shared by DashboardCard and FloorSection so the pricing logic lives in one place.
// Prices each holding two ways: DexScreener first (it aggregates across venues, not
// just one factory), falling back to a PancakeSwap V2 pair against USDT discovered live
// via the factory. Some bStocks trade only through a signed RFQ mechanism rather than a
// public AMM pool (see reserveAssets' comment in config/token.ts) — neither source can
// price those, and that's reflected honestly as `heldButUnpriced`, not silently dropped.
// `value` stays null only while still loading; a genuinely empty treasury resolves to a
// real 0, and a treasury holding something unpriceable resolves to whatever *could* be
// priced (possibly 0) plus the `heldButUnpriced` flag, never an endless "...".
export function useTotalReserveValue(): TotalReserveValue {
  const [value, setValue] = useState<number | null>(null);
  const [incomplete, setIncomplete] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!tokenInfo.tokenAddress) return;
    let cancelled = false;

    async function priceViaPancakeV2(provider: ethers.Provider, assetAddress: string): Promise<number | null> {
      const factory = new ethers.Contract(PANCAKE_V2_FACTORY, PANCAKE_FACTORY_ABI, provider);
      const pairAddr: string = await factory.getPair(assetAddress, USDT_ADDRESS);
      if (pairAddr === ethers.ZeroAddress) return null;
      const pair = new ethers.Contract(pairAddr, PAIR_RESERVES_ABI, provider);
      const [r0, r1]: [bigint, bigint] = await pair.getReserves();
      const token0: string = await pair.token0();
      const isToken0 = token0.toLowerCase() === assetAddress.toLowerCase();
      const assetReserve = isToken0 ? r0 : r1;
      const usdtReserve = isToken0 ? r1 : r0;
      if (assetReserve === BigInt(0)) return null;
      return Number(ethers.formatUnits(usdtReserve, 18)) / Number(ethers.formatUnits(assetReserve, 18));
    }

    async function load() {
      try {
        const provider = getReadProvider();
        const holdings = await getTreasuryHoldings(provider);

        let sum = 0;
        let anyUnpriced = false;

        for (const holding of holdings) {
          const bal = Number(ethers.formatUnits(holding.balance, 18));
          if (bal <= 0) continue;

          let price: number | null = await fetchDexscreenerPriceUsd(holding.address);
          if (price === null) {
            try {
              price = await priceViaPancakeV2(provider, holding.address);
            } catch {
              price = null;
            }
          }

          if (price === null) {
            anyUnpriced = true;
          } else {
            sum += price * bal;
          }
        }

        if (!cancelled) {
          setValue(sum);
          setIncomplete(anyUnpriced);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { value, incomplete, failed };
}
