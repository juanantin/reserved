"use client";

import { useEffect, useState } from "react";

export type TreasuryPurchase = {
  symbol: string;
  asset: string;
  amount: string;
  from: string;
  txHash: string;
  blockNumber: number;
};

export type TreasuryActivity = {
  purchases: TreasuryPurchase[] | null;
  scannedBlocks: number;
  loading: boolean;
  failed: boolean;
};

// Backed by app/api/treasury-activity — see that route for why this is a recent window,
// not the treasury's full acquisition history.
export function useTreasuryActivity(): TreasuryActivity {
  const [purchases, setPurchases] = useState<TreasuryPurchase[] | null>(null);
  const [scannedBlocks, setScannedBlocks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/treasury-activity");
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled) {
          setPurchases(data.purchases ?? []);
          setScannedBlocks(data.scannedBlocks ?? 0);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { purchases, scannedBlocks, loading, failed };
}
