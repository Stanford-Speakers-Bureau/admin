"use client";

import { useEffect, useState } from "react";
import { HIGH_PERFORMER_CHECKIN_THRESHOLD } from "@/app/lib/constants";
import { useEventContext } from "@/app/EventContext";

type ReferralEntry = {
  referral_code: string;
  count: number;
  checked_in_count: number;
};

function getRankColor(rank: number): string {
  if (rank === 0) return "bg-amber-400 text-amber-900";
  if (rank === 1) return "bg-zinc-300 text-zinc-700";
  if (rank === 2) return "bg-amber-600 text-amber-100";
  return "bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300";
}

export default function ReferralLeaderboardClient() {
  const { selectedEventId } = useEventContext();
  const [leaderboard, setLeaderboard] = useState<ReferralEntry[]>([]);
  const [referralsEnabled, setReferralsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  useEffect(() => {
    async function fetchLeaderboard() {
      if (!selectedEventId) {
        setLeaderboard([]);
        setReferralsEnabled(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.append("eventId", selectedEventId);

        const response = await fetch(`/api/referrals?${params}`);

        if (!response.ok) {
          let errorMessage = "Failed to fetch leaderboard";
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch {
            errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }

        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          throw new Error("Invalid response format from server");
        }

        const data = await response.json();
        setLeaderboard(data.leaderboard || []);
        setReferralsEnabled(data.event?.referrals_enabled ?? false);
      } catch (err) {
        console.error("Error fetching leaderboard:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load leaderboard",
        );
      } finally {
        setIsLoading(false);
      }
    }

    fetchLeaderboard();
  }, [selectedEventId, refreshKey]);

  async function handleToggleReferrals() {
    if (!selectedEventId || isToggling) return;
    setIsToggling(true);
    try {
      const newValue = !referralsEnabled;
      const res = await fetch("/api/referrals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: selectedEventId,
          referrals_enabled: newValue,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to toggle referrals");
      }
      setReferralsEnabled(newValue);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle referrals");
    } finally {
      setIsToggling(false);
    }
  }

  return (
    <div className="px-4 sm:px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
            Referral Leaderboard
          </h1>
          <p className="text-zinc-400">Top referrers for this event</p>
        </div>
        <div className="flex items-center gap-3">
          {selectedEventId && (
            <button
              onClick={handleToggleReferrals}
              disabled={isToggling || isLoading}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-colors text-sm disabled:opacity-50 ${
                referralsEnabled
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
              }`}
            >
              <div
                className={`w-8 h-4 rounded-full relative transition-colors ${
                  referralsEnabled ? "bg-emerald-500" : "bg-zinc-600"
                }`}
              >
                <div
                  className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                    referralsEnabled ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </div>
              {referralsEnabled ? "Referrals On" : "Referrals Off"}
            </button>
          )}
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="px-4 py-3 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed border border-zinc-700 rounded-xl text-white font-medium transition-colors flex items-center gap-2"
          >
            <svg
              className={`w-5 h-5 ${isLoading ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl">
          <p className="text-rose-400 text-sm">{error}</p>
        </div>
      )}

      {!selectedEventId ? (
        <div className="text-center py-16 bg-zinc-900/50 rounded-2xl border border-zinc-800">
          <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-zinc-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          </div>
          <p className="text-zinc-400 text-lg mb-2">No event selected</p>
          <p className="text-zinc-600 text-sm">
            Select an event from the sidebar to view referrals
          </p>
        </div>
      ) : isLoading ? (
        <div className="text-center py-16 bg-zinc-900/50 rounded-2xl border border-zinc-800">
          <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <div className="w-8 h-8 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
          </div>
          <p className="text-zinc-400">Loading leaderboard...</p>
        </div>
      ) : leaderboard.length === 0 ? (
        <div className="text-center py-16 bg-zinc-900/50 rounded-2xl border border-zinc-800">
          <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-zinc-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          </div>
          <p className="text-zinc-400 text-lg mb-2">No referrals yet</p>
          <p className="text-zinc-600 text-sm">
            No referrals for this event
          </p>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6">
          <div className="space-y-2">
            {leaderboard.map((referral, index) => {
              const isHighPerformer =
                referral.checked_in_count >= HIGH_PERFORMER_CHECKIN_THRESHOLD;
              return (
                <div
                  key={referral.referral_code}
                  className={`flex items-center gap-4 p-4 rounded-lg transition-colors ${
                    isHighPerformer
                      ? "bg-emerald-500/20 border border-emerald-500/30 hover:bg-emerald-500/25"
                      : "bg-zinc-800/50 hover:bg-zinc-800"
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${getRankColor(
                      index,
                    )}`}
                  >
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <p
                      className={`font-medium ${isHighPerformer ? "text-emerald-300" : "text-white"}`}
                    >
                      {referral.referral_code}
                    </p>
                  </div>
                  <div className="text-right flex items-center gap-4">
                    <div>
                      <p className="text-amber-400 font-bold text-lg">
                        {referral.checked_in_count}
                      </p>
                      <p className="text-zinc-500 text-xs">checked in</p>
                    </div>
                    <div>
                      <p className="text-emerald-400 font-bold text-lg">
                        {referral.count}
                      </p>
                      <p className="text-zinc-500 text-xs">
                        {referral.count === 1 ? "referral" : "referrals"}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
