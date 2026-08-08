"use client";

import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import { tokenInfo } from "@/config/token";
import { getReadProvider, getTokenContract, getVaultContract } from "@/lib/contracts";
import { useWallet } from "@/lib/useWallet";
import { dictionaries, type Locale } from "@/lib/i18n";

type PreviewLine = { token: string; symbol: string; amount: string };

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function RedeemPanel({ locale }: { locale: Locale }) {
  const { address, wrongNetwork, connecting, error: walletError, connect, switchToBsc, getSigner } = useWallet();
  const t = dictionaries[locale].redeemPanel;
  const tw = dictionaries[locale].wallet;

  const [balance, setBalance] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [preview, setPreview] = useState<PreviewLine[] | null>(null);
  const [busy, setBusy] = useState<"approve" | "redeem" | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refreshBalance = useCallback(async () => {
    if (!address) return;
    const provider = getReadProvider();
    const token = getTokenContract(provider);
    const [bal, allow]: [bigint, bigint] = await Promise.all([
      token.balanceOf(address),
      token.allowance(address, tokenInfo.vaultAddress),
    ]);
    setBalance(bal);
    setAllowance(allow);
  }, [address]);

  // Mirrors refreshBalance's body rather than calling it directly, so the state
  // update happens inside this effect's own async closure (satisfies
  // react-hooks/set-state-in-effect). refreshBalance itself is still used
  // directly from the approve/redeem handlers below, which is fine outside an effect.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    async function load() {
      const provider = getReadProvider();
      const token = getTokenContract(provider);
      const [bal, allow]: [bigint, bigint] = await Promise.all([
        token.balanceOf(address as string),
        token.allowance(address, tokenInfo.vaultAddress),
      ]);
      if (!cancelled) {
        setBalance(bal);
        setAllowance(allow);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    async function loadPreview() {
      if (!amountInput || Number(amountInput) <= 0) {
        setPreview(null);
        return;
      }
      let amountWei: bigint;
      try {
        amountWei = ethers.parseUnits(amountInput, 18);
      } catch {
        setPreview(null);
        return;
      }
      const provider = getReadProvider();
      const vault = getVaultContract(provider);
      const [tokens, amounts]: [string[], bigint[]] = await vault.previewRedeem(amountWei);
      if (cancelled) return;
      const lines = await Promise.all(
        tokens.map(async (t: string, i: number) => {
          let symbol = shortAddr(t);
          try {
            const meta = new ethers.Contract(t, ["function symbol() view returns (string)"], provider);
            symbol = await meta.symbol();
          } catch {
            // Non-standard or unreadable token metadata — fall back to the address.
          }
          return { token: t, symbol, amount: ethers.formatUnits(amounts[i], 18) };
        })
      );
      if (!cancelled) setPreview(lines.filter((l) => Number(l.amount) > 0));
    }
    // Debounced — this fires on every keystroke otherwise, hammering the
    // public RPC endpoint while someone's still typing an amount.
    const timer = setTimeout(loadPreview, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [amountInput]);

  const setMax = () => {
    if (balance !== null) setAmountInput(ethers.formatUnits(balance, 18));
  };

  const amountWei = (() => {
    try {
      return amountInput ? ethers.parseUnits(amountInput, 18) : BigInt(0);
    } catch {
      return BigInt(0);
    }
  })();

  // allowance starts null while its balanceOf/allowance read is in flight —
  // treat that as "unknown", not "no approval needed". Defaulting to false
  // here would show the Redeem button before we actually know the vault has
  // approval, letting someone click it into a guaranteed-revert.
  const allowanceUnknown = allowance === null;
  const needsApproval = allowance !== null && amountWei > BigInt(0) && allowance < amountWei;
  const insufficientBalance = balance !== null && amountWei > BigInt(0) && amountWei > balance;

  // ethers surfaces a short, human-readable reason on most revert/rejection
  // errors (e.g. "user rejected action", a custom error name) — show that
  // instead of a flat generic string when it's available.
  function describeError(error: unknown, fallback: string): string {
    if (error && typeof error === "object" && "shortMessage" in error) {
      const msg = (error as { shortMessage?: unknown }).shortMessage;
      if (typeof msg === "string" && msg) return msg;
    }
    return fallback;
  }

  const handleApprove = async () => {
    setStatus(null);
    setBusy("approve");
    try {
      const signer = await getSigner();
      const token = getTokenContract(signer);
      const tx = await token.approve(tokenInfo.vaultAddress, amountWei);
      setStatus(t.approvalSubmitted);
      await tx.wait();
      setStatus(t.approved);
      await refreshBalance();
    } catch (error) {
      setStatus(describeError(error, t.approvalFailed));
    } finally {
      setBusy(null);
    }
  };

  const handleRedeem = async () => {
    setStatus(null);
    setBusy("redeem");
    try {
      const signer = await getSigner();
      const vault = getVaultContract(signer);
      const tx = await vault.redeem(amountWei);
      setStatus(t.redeemSubmitted);
      await tx.wait();
      setStatus(t.redeemed);
      setAmountInput("");
      await refreshBalance();
    } catch (error) {
      setStatus(describeError(error, t.redeemFailed));
    } finally {
      setBusy(null);
    }
  };

  if (!tokenInfo.tokenAddress || !tokenInfo.vaultAddress) {
    return (
      <button
        type="button"
        disabled
        title={t.comingSoonTitle}
        className="cursor-not-allowed rounded-md border border-rsvd-gold/30 px-6 py-3 text-sm font-semibold text-rsvd-gold/50"
      >
        {t.comingSoon}
      </button>
    );
  }

  if (!address) {
    return (
      <div>
        <button
          type="button"
          onClick={connect}
          disabled={connecting}
          className="rounded-md bg-rsvd-gold px-6 py-3 text-sm font-semibold text-rsvd-black transition-opacity hover:opacity-90 focus-gold disabled:opacity-60"
        >
          {connecting ? t.connecting : t.connectToRedeem}
        </button>
        {walletError && <p className="mt-2 text-sm text-red-400">{tw.errors[walletError]}</p>}
      </div>
    );
  }

  if (wrongNetwork) {
    return (
      <button
        type="button"
        onClick={switchToBsc}
        className="rounded-md border border-rsvd-gold/40 px-6 py-3 text-sm font-semibold text-rsvd-gold transition-colors hover:border-rsvd-gold focus-gold"
      >
        {t.switchToBnb}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-rsvd-offwhite/60">{t.connectedLabel(shortAddr(address))}</span>
        <span className="text-rsvd-offwhite/60">
          {t.balanceLabel(balance !== null ? Number(ethers.formatUnits(balance, 18)).toLocaleString() : "...", tokenInfo.ticker)}
        </span>
      </div>

      <div className="mt-4 flex gap-2">
        <input
          type="number"
          min="0"
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          placeholder={t.amountPlaceholder(tokenInfo.ticker)}
          className="w-full rounded-md border border-white/10 bg-black/30 px-4 py-3 text-sm text-rsvd-offwhite focus-gold"
        />
        <button
          type="button"
          onClick={setMax}
          className="shrink-0 rounded-md border border-white/10 px-3 text-xs text-rsvd-offwhite/70 hover:border-rsvd-gold/50 hover:text-rsvd-gold"
        >
          {t.max}
        </button>
      </div>

      {preview && preview.length > 0 && (
        <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-4 text-sm">
          <div className="text-xs uppercase tracking-widest text-rsvd-offwhite/40">{t.youWillReceive}</div>
          <ul className="mt-2 space-y-1">
            {preview.map((line) => (
              <li key={line.token} className="flex justify-between font-mono text-rsvd-gold">
                <span>{line.symbol}</span>
                <span>{Number(line.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview && preview.length === 0 && amountWei > BigInt(0) && (
        <p className="mt-3 text-sm text-rsvd-offwhite/50">{t.nothingToRedeem}</p>
      )}

      {insufficientBalance && <p className="mt-3 text-sm text-red-400">{t.exceedsBalance}</p>}

      <div className="mt-4 flex gap-3">
        {amountWei > BigInt(0) && allowanceUnknown ? (
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-md bg-rsvd-gold px-6 py-3 text-sm font-semibold text-rsvd-black opacity-50"
          >
            {t.checkingApproval}
          </button>
        ) : needsApproval ? (
          <button
            type="button"
            onClick={handleApprove}
            disabled={busy !== null || amountWei === BigInt(0) || insufficientBalance}
            className="rounded-md bg-rsvd-gold px-6 py-3 text-sm font-semibold text-rsvd-black transition-opacity hover:opacity-90 focus-gold disabled:opacity-50"
          >
            {busy === "approve" ? t.approving : t.approve(tokenInfo.ticker)}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleRedeem}
            disabled={busy !== null || amountWei === BigInt(0) || insufficientBalance}
            className="rounded-md bg-rsvd-gold px-6 py-3 text-sm font-semibold text-rsvd-black transition-opacity hover:opacity-90 focus-gold disabled:opacity-50"
          >
            {busy === "redeem" ? t.redeeming : t.redeem}
          </button>
        )}
      </div>

      {status && <p className="mt-3 text-sm text-rsvd-offwhite/70">{status}</p>}
    </div>
  );
}
