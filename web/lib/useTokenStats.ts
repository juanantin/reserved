"use client";

import { useEffect, useState } from "react";

export type TokenStats = {
  priceUsd: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  holders: number | null;
  holdersComplete: boolean;
  loading: boolean;
  failed: boolean;
};

const EMPTY: Omit<TokenStats, "loading" | "failed"> = {
  priceUsd: null,
  marketCapUsd: null,
  volume24hUsd: null,
  holders: null,
  holdersComplete: false,
};

// Backed by app/api/token-stats — a cached server route (DexScreener for market cap and
// volume, a bounded on-chain scan for holders), not a direct client call. See that
// route for why: the holder count in particular is expensive enough that doing it once
// per visitor would hammer the public RPC for no reason.
export function useTokenStats(): TokenStats {
  const [state, setState] = useState<{ data: typeof EMPTY; loading: boolean; failed: boolean }>({
    data: EMPTY,
    loading: true,
    failed: false,
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/token-stats");
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled) setState({ data, loading: false, failed: false });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, loading: false, failed: true }));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { ...state.data, loading: state.loading, failed: state.failed };
}
