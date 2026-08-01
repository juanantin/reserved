"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { tokenInfo } from "@/config/token";
import { getReadProvider, getTokenContract, getVaultContract } from "@/lib/contracts";
import { useWallet } from "@/lib/useWallet";
import { Logo } from "./Logo";

const PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
];

type ReserveLine = { symbol: string; balance: string };

// A floating dashboard card in the hero — real on-chain figures styled after
// theindex.finance's homepage widget (headline stat, secondary stats, holdings
// list, connected-wallet panel), kept in Reserved's dark/gold palette rather
// than copying their light theme.
export function DashboardCard() {
  const { address, wrongNetwork } = useWallet();

  const [marketCapBnb, setMarketCapBnb] = useState<number | null>(null);
  const [supply, setSupply] = useState<number | null>(null);
  const [treasuryBal, setTreasuryBal] = useState<number | null>(null);
  const [reserves, setReserves] = useState<ReserveLine[] | null>(null);
  const [userBalance, setUserBalance] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!tokenInfo.tokenAddress || !tokenInfo.vaultAddress) return;
    let cancelled = false;

    async function load() {
      try {
        const provider = getReadProvider();
        const token = getTokenContract(provider);
        const vault = getVaultContract(provider);

        const treasuryAddr: string = await token.treasury();
        const [supplyWei, [tokens, balances], treasuryWei]: [bigint, [string[], bigint[]], bigint] = await Promise.all([
          token.totalSupply(),
          vault.getReserveBalances(),
          token.balanceOf(treasuryAddr),
        ]);
        const supplyNum = Number(ethers.formatUnits(supplyWei, 18));

        const lines = await Promise.all(
          tokens.map(async (t: string, i: number) => {
            let symbol = `${t.slice(0, 6)}...`;
            try {
              const meta = new ethers.Contract(t, ["function symbol() view returns (string)"], provider);
              symbol = await meta.symbol();
            } catch {
              // Fall back to the shortened address if the reserve asset's metadata call fails.
            }
            return { symbol, balance: ethers.formatUnits(balances[i], 18) };
          })
        );

        let marketCap: number | null = null;
        if (tokenInfo.pairAddress) {
          const pair = new ethers.Contract(tokenInfo.pairAddress, PAIR_ABI, provider);
          const [reserve0, reserve1]: [bigint, bigint] = await pair.getReserves();
          const token0: string = await pair.token0();
          const tokenIsToken0 = token0.toLowerCase() === tokenInfo.tokenAddress.toLowerCase();
          const tokenReserve = tokenIsToken0 ? reserve0 : reserve1;
          const bnbReserve = tokenIsToken0 ? reserve1 : reserve0;
          if (tokenReserve > BigInt(0)) {
            const price = Number(ethers.formatEther(bnbReserve)) / Number(ethers.formatUnits(tokenReserve, 18));
            marketCap = price * supplyNum;
          }
        }

        if (!cancelled) {
          setSupply(supplyNum);
          setTreasuryBal(Number(ethers.formatUnits(treasuryWei, 18)));
          setReserves(lines.filter((l) => Number(l.balance) > 0));
          setMarketCapBnb(marketCap);
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

  useEffect(() => {
    let cancelled = false;
    async function loadUser() {
      if (!address || wrongNetwork) {
        if (!cancelled) setUserBalance(null);
        return;
      }
      const provider = getReadProvider();
      const token = getTokenContract(provider);
      const bal: bigint = await token.balanceOf(address);
      if (!cancelled) setUserBalance(Number(ethers.formatUnits(bal, 18)));
    }
    loadUser();
    return () => {
      cancelled = true;
    };
  }, [address, wrongNetwork]);

  if (!tokenInfo.tokenAddress) return null;

  const sharePct = userBalance !== null && supply ? (userBalance / supply) * 100 : null;

  return (
    <div className="relative mx-auto w-full max-w-md rounded-2xl border border-rsvd-gold/20 bg-rsvd-black/70 p-6 shadow-2xl backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-white/10 pb-4">
        <Logo size={20} />
        <span className="text-sm font-semibold tracking-wide">RESERVED</span>
      </div>

      <div className="border-b border-white/10 py-5 text-center">
        <div className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">Market Cap</div>
        <div className="mt-1 truncate font-mono text-3xl font-bold text-rsvd-gold">
          {marketCapBnb !== null
            ? `${marketCapBnb.toLocaleString(undefined, { maximumFractionDigits: 2 })} BNB`
            : failed
              ? "—"
              : "..."}
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-white/10 border-b border-white/10 py-4 text-center">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">Tax Collected</div>
          <div className="mt-1 truncate font-mono text-sm font-semibold text-rsvd-offwhite">
            {treasuryBal !== null
              ? `${treasuryBal.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tokenInfo.ticker}`
              : failed
                ? "—"
                : "..."}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">Reserve Assets</div>
          <div className="mt-1 font-mono text-sm font-semibold text-rsvd-offwhite">
            {reserves !== null ? reserves.length : failed ? "—" : "..."}
          </div>
        </div>
      </div>

      {reserves && reserves.length > 0 && (
        <div className="border-b border-white/10 py-4">
          <div className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">Vault holdings</div>
          <ul className="mt-2 space-y-1.5 text-sm">
            {reserves.map((r) => (
              <li key={r.symbol} className="flex justify-between font-mono text-rsvd-gold">
                <span>{r.symbol}</span>
                <span>{Number(r.balance).toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 rounded-lg bg-rsvd-gold/10 p-4">
        <div className="text-[10px] uppercase tracking-widest text-rsvd-gold/70">
          {address && !wrongNetwork ? "Your position" : "Connect to see your position"}
        </div>
        {address && !wrongNetwork ? (
          <>
            <div className="mt-1 font-mono text-xl font-bold text-rsvd-gold">
              {userBalance !== null ? userBalance.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "..."}{" "}
              {tokenInfo.ticker}
            </div>
            <div className="mt-1 text-xs text-rsvd-offwhite/50">
              {sharePct !== null ? `${sharePct.toFixed(4)}% of supply` : ""}
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm text-rsvd-offwhite/50">
            Connect a wallet (see the Treasury section below) to see your balance and share here.
          </p>
        )}
      </div>
    </div>
  );
}
