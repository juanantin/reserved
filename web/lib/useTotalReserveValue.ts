"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { tokenInfo } from "@/config/token";
import { getReadProvider, getTreasuryHoldings, PANCAKE_V2_FACTORY, USDT_ADDRESS, PANCAKE_FACTORY_ABI, PAIR_RESERVES_ABI } from "./contracts";

export type TotalReserveValue = {
  value: number | null;
  incomplete: boolean;
  failed: boolean;
};

// Shared by DashboardCard and FloorSection so the pricing logic (and its honesty
// tradeoffs — see lib/contracts.ts's PANCAKE_V2_FACTORY comment) lives in one place.
// Prices each vault holding off its own USDT pair, discovered live via the PancakeSwap
// factory rather than a hardcoded per-asset address. An asset with no discoverable or
// liquid pair just can't be priced yet — reflected as `incomplete`, not silently
// dropped or guessed. `value` stays null (shown as "—"/loading, never a fabricated
// number) until at least something is known: either the vault is empty (a real,
// known $0) or at least one holding was priced.
export function useTotalReserveValue(): TotalReserveValue {
  const [value, setValue] = useState<number | null>(null);
  const [incomplete, setIncomplete] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!tokenInfo.tokenAddress) return;
    let cancelled = false;

    async function load() {
      try {
        const provider = getReadProvider();
        const holdings = await getTreasuryHoldings(provider);

        let reserveValue: number | null = null;
        let reserveValuePartial = false;

        if (holdings.length === 0) {
          reserveValue = 0;
        } else {
          const factory = new ethers.Contract(PANCAKE_V2_FACTORY, PANCAKE_FACTORY_ABI, provider);
          let sum = 0;
          let pricedCount = 0;
          for (const holding of holdings) {
            const bal = Number(ethers.formatUnits(holding.balance, 18));
            if (bal <= 0) continue;
            try {
              const pairAddr: string = await factory.getPair(holding.address, USDT_ADDRESS);
              if (pairAddr === ethers.ZeroAddress) {
                reserveValuePartial = true;
                continue;
              }
              const pair = new ethers.Contract(pairAddr, PAIR_RESERVES_ABI, provider);
              const [r0, r1]: [bigint, bigint] = await pair.getReserves();
              const token0: string = await pair.token0();
              const isToken0 = token0.toLowerCase() === holding.address.toLowerCase();
              const assetReserve = isToken0 ? r0 : r1;
              const usdtReserve = isToken0 ? r1 : r0;
              if (assetReserve === BigInt(0)) {
                reserveValuePartial = true;
                continue;
              }
              const price = Number(ethers.formatUnits(usdtReserve, 18)) / Number(ethers.formatUnits(assetReserve, 18));
              sum += price * bal;
              pricedCount++;
            } catch {
              reserveValuePartial = true;
            }
          }
          if (pricedCount > 0 || !reserveValuePartial) {
            reserveValue = sum;
          }
        }

        if (!cancelled) {
          setValue(reserveValue);
          setIncomplete(reserveValuePartial);
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
