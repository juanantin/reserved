"use client";

import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import { tokenInfo } from "@/config/token";
import { getGovernanceVoteContract, getReadProvider, getTokenContract } from "@/lib/contracts";
import { useWallet } from "@/lib/useWallet";
import { dictionaries, type Locale } from "@/lib/i18n";

type Candidate = { symbol: string; name: string; active: boolean; votes: bigint };

function describeError(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "shortMessage" in error) {
    const msg = (error as { shortMessage?: unknown }).shortMessage;
    if (typeof msg === "string" && msg) return msg;
  }
  return fallback;
}

export function VoteNextPanel({ locale }: { locale: Locale }) {
  const { address, wrongNetwork, connecting, error: walletError, connect, switchToBsc, getSigner } = useWallet();
  const t = dictionaries[locale].voteNext;
  const tw = dictionaries[locale].wallet;

  const [balance, setBalance] = useState<bigint | null>(null);
  const [threshold, setThreshold] = useState<bigint | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [myVote, setMyVote] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tokenInfo.governanceVoteAddress) return;
    const provider = getReadProvider();
    const vote = getGovernanceVoteContract(provider);

    const [thresholdWei, count, counts]: [bigint, bigint, bigint[]] = await Promise.all([
      vote.voteThreshold(),
      vote.candidateCount(),
      vote.getVoteCounts(),
    ]);
    setThreshold(thresholdWei);

    const list: Candidate[] = await Promise.all(
      Array.from({ length: Number(count) }, async (_, i) => {
        const [symbol, name, active] = await vote.candidates(i);
        return { symbol, name, active, votes: counts[i] };
      })
    );
    setCandidates(list);

    if (address) {
      const token = getTokenContract(provider);
      const bal: bigint = await token.balanceOf(address);
      setBalance(bal);
      const [hasVoted, candidateId]: [boolean, bigint] = await vote.myVote(address);
      setMyVote(hasVoted ? Number(candidateId) : null);
    } else {
      setBalance(null);
      setMyVote(null);
    }
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refresh();
      } catch {
        if (!cancelled) setCandidates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const handleVote = async (candidateId: number) => {
    setStatus(null);
    setBusyId(candidateId);
    try {
      const signer = await getSigner();
      const vote = getGovernanceVoteContract(signer);
      const tx = await vote.castVote(candidateId);
      setStatus(t.voteSubmitted);
      await tx.wait();
      setStatus(t.voted);
      await refresh();
    } catch (error) {
      setStatus(describeError(error, t.voteFailed));
    } finally {
      setBusyId(null);
    }
  };

  if (!tokenInfo.governanceVoteAddress) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-6 text-sm text-rsvd-offwhite/60">{t.comingSoon}</div>
    );
  }

  const eligible = balance !== null && threshold !== null && balance >= threshold;

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-6">
      <h3 className="text-sm font-semibold text-rsvd-gold">{t.title}</h3>
      <p className="mt-1 text-xs text-rsvd-offwhite/50">{t.description}</p>

      {!address ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={connect}
            disabled={connecting}
            className="rounded-md bg-rsvd-gold px-5 py-2.5 text-sm font-semibold text-rsvd-black transition-opacity hover:opacity-90 focus-gold disabled:opacity-60"
          >
            {connecting ? t.connecting : t.connectToVote}
          </button>
          {walletError && <p className="mt-2 text-sm text-red-400">{tw.errors[walletError]}</p>}
        </div>
      ) : wrongNetwork ? (
        <button
          type="button"
          onClick={switchToBsc}
          className="mt-4 rounded-md border border-rsvd-gold/40 px-5 py-2.5 text-sm font-semibold text-rsvd-gold transition-colors hover:border-rsvd-gold focus-gold"
        >
          {t.switchToBnb}
        </button>
      ) : (
        <>
          <p className="mt-3 text-xs text-rsvd-offwhite/50">
            {threshold !== null &&
              t.balanceLine(
                balance !== null ? Number(ethers.formatUnits(balance, 18)).toLocaleString() : "...",
                Number(ethers.formatUnits(threshold, 18)).toLocaleString(),
                tokenInfo.ticker
              )}
          </p>

          {!eligible && balance !== null && <p className="mt-2 text-sm text-red-400">{t.ineligible}</p>}

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(candidates ?? [])
              .map((c, id) => ({ ...c, id }))
              .filter((c) => c.active)
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={!eligible || busyId !== null}
                  onClick={() => handleVote(c.id)}
                  className={`flex items-center justify-between rounded-md border px-4 py-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    myVote === c.id ? "border-rsvd-gold bg-rsvd-gold/10" : "border-white/10 hover:border-rsvd-gold/50"
                  }`}
                >
                  <span>
                    <span className="font-mono font-semibold text-rsvd-gold">{c.symbol}</span>{" "}
                    <span className="text-rsvd-offwhite/50">{c.name}</span>
                  </span>
                  <span className="text-xs text-rsvd-offwhite/40">
                    {busyId === c.id ? t.voting : `${c.votes.toString()} ${t.votesLabel}`}
                  </span>
                </button>
              ))}
          </div>

          {candidates && candidates.filter((c) => c.active).length === 0 && (
            <p className="mt-3 text-sm text-rsvd-offwhite/50">{t.noCandidates}</p>
          )}

          {status && <p className="mt-3 text-sm text-rsvd-offwhite/70">{status}</p>}
        </>
      )}
    </div>
  );
}
