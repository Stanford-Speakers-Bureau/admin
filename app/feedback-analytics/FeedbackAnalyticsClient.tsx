"use client";

import { useEffect, useMemo, useState } from "react";
import { useEventContext } from "@/app/EventContext";
import {
  runChunkedSend,
  type BulkSendProgressState,
} from "@/app/lib/bulkSend";

type FeedbackRow = {
  ticketId: string;
  name: string | null;
  email: string;
  score: number;
  comment: string | null;
  submittedAt: string;
  updatedAt: string;
  submittedVia: string;
};

type EligibleTicketRow = {
  ticketId: string;
  name: string | null;
  email: string;
  scanTime: string | null;
};

type AnalyticsResponse = {
  eventId: string;
  eventName: string | null;
  eventStartTime: string | null;
  eventEndTime: string | null;
  totalScanned: number;
  totalResponses: number;
  responseRate: number;
  averageScore: number;
  npsScore: number;
  promoters: number;
  passives: number;
  detractors: number;
  scoreDistribution: number[];
  feedback: FeedbackRow[];
  eligibleMissing: EligibleTicketRow[];
};

const SEND_CHUNK_SIZE = 25;

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

function scoreTone(score: number): string {
  if (score >= 9) return "text-emerald-400";
  if (score >= 7) return "text-amber-400";
  return "text-rose-400";
}

function scoreBg(score: number): string {
  if (score >= 9) return "bg-emerald-500/15 border-emerald-500/30";
  if (score >= 7) return "bg-amber-500/15 border-amber-500/30";
  return "bg-rose-500/15 border-rose-500/30";
}

export default function FeedbackAnalyticsClient() {
  const { events, selectedEventId } = useEventContext();
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scoreFilter, setScoreFilter] = useState<"all" | "promoters" | "passives" | "detractors">(
    "all",
  );
  const [commentOnly, setCommentOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(
    new Set(),
  );
  const [sendProgress, setSendProgress] = useState<BulkSendProgressState | null>(
    null,
  );
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<string | null>(null);

  const currentEvent = events.find((e) => e.id === selectedEventId);

  useEffect(() => {
    if (!selectedEventId) {
      setData(null);
      return;
    }
    const controller = new AbortController();
    async function fetchData() {
      setIsLoading(true);
      setError(null);
      setSelectedTicketIds(new Set());
      setSendResult(null);
      setSendError(null);
      try {
        const res = await fetch(
          `/api/feedback/analytics?eventId=${selectedEventId}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to fetch analytics");
        }
        setData(await res.json());
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
    return () => controller.abort();
  }, [selectedEventId]);

  const filteredFeedback = useMemo(() => {
    if (!data) return [];
    const query = search.trim().toLowerCase();
    return data.feedback.filter((row) => {
      if (scoreFilter === "promoters" && row.score < 9) return false;
      if (scoreFilter === "passives" && (row.score < 7 || row.score >= 9))
        return false;
      if (scoreFilter === "detractors" && row.score >= 7) return false;
      if (commentOnly && !row.comment) return false;
      if (query) {
        const haystack =
          `${row.name ?? ""} ${row.email} ${row.comment ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [data, scoreFilter, commentOnly, search]);

  const filteredEligible = useMemo(() => {
    if (!data) return [];
    const query = search.trim().toLowerCase();
    if (!query) return data.eligibleMissing;
    return data.eligibleMissing.filter((row) => {
      const haystack = `${row.name ?? ""} ${row.email}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [data, search]);

  const maxDistribution = useMemo(() => {
    if (!data) return 0;
    return Math.max(0, ...data.scoreDistribution);
  }, [data]);

  function toggleSelect(ticketId: string) {
    setSelectedTicketIds((prev) => {
      const next = new Set(prev);
      if (next.has(ticketId)) {
        next.delete(ticketId);
      } else {
        next.add(ticketId);
      }
      return next;
    });
  }

  function toggleSelectAllVisible() {
    const visibleIds = filteredEligible.map((row) => row.ticketId);
    const allSelected = visibleIds.every((id) => selectedTicketIds.has(id));
    setSelectedTicketIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }

  async function handleSendFeedbackPrompts() {
    if (!selectedEventId) return;
    const ids = [...selectedTicketIds];
    if (ids.length === 0) return;
    setSendError(null);
    setSendResult(null);

    try {
      const finalState = await runChunkedSend({
        items: ids,
        chunkSize: SEND_CHUNK_SIZE,
        label: "Sending feedback prompts",
        onProgress: setSendProgress,
        sendChunk: async (chunk) => {
          const res = await fetch(`/api/feedback/analytics/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ eventId: selectedEventId, ticketIds: chunk }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || "Failed to send prompts");
          }
          const body = (await res.json()) as {
            sent: number;
            failed: number;
            skipped: number;
          };
          return {
            sent: body.sent,
            failed: body.failed,
            skipped: body.skipped,
          };
        },
      });
      setSendResult(
        `Sent ${finalState.sent}/${finalState.total}${finalState.failed > 0
          ? `, ${finalState.failed} failed`
          : ""}${finalState.skipped > 0 ? `, ${finalState.skipped} skipped` : ""}.`,
      );
      setSelectedTicketIds(new Set());
      if (selectedEventId) {
        fetch(`/api/feedback/analytics?eventId=${selectedEventId}`, {
          cache: "no-store",
        })
          .then((r) => r.json())
          .then((fresh) => setData(fresh))
          .catch(() => {});
      }
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : "Failed to send feedback prompts",
      );
    } finally {
      setSendProgress((prev) => (prev ? { ...prev, active: false, done: true } : prev));
    }
  }

  if (!selectedEventId) {
    return (
      <div className="px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
            Feedback Analytics
          </h1>
        </div>
        <div className="text-center py-16 bg-zinc-900/50 rounded-2xl border border-zinc-800">
          <p className="text-zinc-400 text-sm">Select an event to view feedback.</p>
        </div>
      </div>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
            Feedback Analytics
          </h1>
          {currentEvent && (
            <p className="text-zinc-400">{currentEvent.name || "Unnamed Event"}</p>
          )}
        </div>
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-200" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
            Feedback Analytics
          </h1>
        </div>
        <div className="px-4 py-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-sm">
          {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const progressSentPct =
    sendProgress && sendProgress.total > 0
      ? ((sendProgress.sent + sendProgress.failed + sendProgress.skipped)
        / sendProgress.total) * 100
      : 0;

  return (
    <div className="px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
          Feedback Analytics
        </h1>
        {currentEvent && (
          <p className="text-zinc-400">{currentEvent.name || "Unnamed Event"}</p>
        )}
      </div>

      <div className="space-y-5">
        {/* Stat Cards */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Responses
            </p>
            <p className="mt-2 text-2xl font-bold text-blue-400">
              {data.totalResponses}
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              of {data.totalScanned} scanned attendees
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Response Rate
            </p>
            <p
              className={`mt-2 text-2xl font-bold ${data.responseRate >= 50
                ? "text-emerald-400"
                : data.responseRate >= 25
                  ? "text-blue-400"
                  : "text-amber-400"
                }`}
            >
              {data.responseRate.toFixed(1)}%
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              {data.totalScanned - data.totalResponses} haven&apos;t replied
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Average Score
            </p>
            <p className="mt-2 text-2xl font-bold text-violet-400">
              {data.totalResponses > 0 ? data.averageScore.toFixed(2) : "—"}
              <span className="text-base text-zinc-500 font-semibold"> / 10</span>
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              {data.totalResponses > 0
                ? `Across ${data.totalResponses} responses`
                : "No responses yet"}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              NPS
            </p>
            <p
              className={`mt-2 text-2xl font-bold ${data.npsScore >= 50
                ? "text-emerald-400"
                : data.npsScore >= 0
                  ? "text-amber-400"
                  : "text-rose-400"
                }`}
            >
              {data.totalResponses > 0 ? data.npsScore.toFixed(0) : "—"}
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              {data.promoters} promoters · {data.passives} passives · {data.detractors} detractors
            </p>
          </div>
        </div>

        {/* Score Distribution */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Score Distribution</h3>
            <p className="text-[11px] text-zinc-500">1 = not likely · 10 = extremely likely</p>
          </div>
          <div className="grid grid-cols-10 gap-2 items-end h-40">
            {data.scoreDistribution.map((count, idx) => {
              const score = idx + 1;
              const heightPct = maxDistribution > 0 ? (count / maxDistribution) * 100 : 0;
              return (
                <div key={score} className="flex flex-col items-center gap-2">
                  <div className="flex-1 w-full flex items-end">
                    <div
                      className={`w-full rounded-md border ${scoreBg(score)} transition-all`}
                      style={{ height: `${heightPct}%`, minHeight: count > 0 ? 4 : 0 }}
                      title={`${count} response${count === 1 ? "" : "s"}`}
                    />
                  </div>
                  <div className="text-center">
                    <div className={`text-xs font-semibold ${scoreTone(score)}`}>{count}</div>
                    <div className="text-[10px] text-zinc-500">{score}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Controls */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "promoters", "passives", "detractors"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setScoreFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${scoreFilter === key
                  ? "bg-white text-zinc-900 border-white"
                  : "bg-zinc-800/60 text-zinc-300 border-zinc-700 hover:border-zinc-600"
                  }`}
              >
                {key[0].toUpperCase() + key.slice(1)}
              </button>
            ))}
            <label className="flex items-center gap-2 text-xs text-zinc-300 ml-2">
              <input
                type="checkbox"
                checked={commentOnly}
                onChange={(e) => setCommentOnly(e.target.checked)}
                className="rounded border-zinc-600 bg-zinc-800"
              />
              Has comment
            </label>
          </div>
          <input
            type="search"
            placeholder="Search by name, email, comment…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 w-full sm:w-72"
          />
        </div>

        {/* Feedback Table */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-white">Responses</h3>
            <span className="text-xs text-zinc-500">
              {filteredFeedback.length} of {data.feedback.length}
            </span>
          </div>
          {filteredFeedback.length === 0 ? (
            <div className="py-10 text-center text-sm text-zinc-500">
              No feedback matches these filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900/70 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-4 py-2 w-16">Score</th>
                    <th className="px-4 py-2">Attendee</th>
                    <th className="px-4 py-2">Comment</th>
                    <th className="px-4 py-2 w-36">Submitted</th>
                    <th className="px-4 py-2 w-24">Via</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {filteredFeedback.map((row) => (
                    <tr key={row.ticketId} className="hover:bg-zinc-900/40">
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center justify-center h-8 w-10 rounded-lg border text-sm font-bold ${scoreBg(row.score)} ${scoreTone(row.score)}`}
                        >
                          {row.score}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-white">{row.name || "—"}</div>
                        <div className="text-xs text-zinc-500">{row.email}</div>
                      </td>
                      <td className="px-4 py-3 text-zinc-300 max-w-md">
                        {row.comment ? (
                          <p className="whitespace-pre-wrap break-words">{row.comment}</p>
                        ) : (
                          <span className="text-zinc-600 italic">No comment</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-400">
                        {formatTimestamp(row.updatedAt)}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-400">
                        {row.submittedVia === "signed_link" ? "Email" : "Site"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Non-responders + Bulk Send */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Haven&apos;t submitted</h3>
              <p className="text-xs text-zinc-500">
                Scanned attendees without feedback · {filteredEligible.length} shown
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleSelectAllVisible}
                disabled={filteredEligible.length === 0}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-zinc-700 bg-zinc-800/60 text-zinc-300 hover:border-zinc-600 disabled:opacity-50"
              >
                {filteredEligible.every((row) =>
                  selectedTicketIds.has(row.ticketId),
                ) && filteredEligible.length > 0
                  ? "Deselect visible"
                  : "Select visible"}
              </button>
              <button
                type="button"
                onClick={handleSendFeedbackPrompts}
                disabled={
                  selectedTicketIds.size === 0 ||
                  Boolean(sendProgress && sendProgress.active)
                }
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#A80D0C] text-white hover:bg-[#C11211] disabled:opacity-50"
              >
                {sendProgress && sendProgress.active
                  ? `Sending… ${sendProgress.sent}/${sendProgress.total}`
                  : `Send feedback prompt (${selectedTicketIds.size})`}
              </button>
            </div>
          </div>

          {sendProgress && (
            <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/40">
              <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-[#A80D0C] transition-[width]"
                  style={{ width: `${progressSentPct}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                {sendProgress.label} · {sendProgress.sent} sent,{" "}
                {sendProgress.failed} failed, {sendProgress.skipped} skipped
              </p>
            </div>
          )}

          {sendError && (
            <div className="px-4 py-3 border-b border-zinc-800 bg-rose-500/10 text-rose-300 text-xs">
              {sendError}
            </div>
          )}

          {sendResult && !sendError && (
            <div className="px-4 py-3 border-b border-zinc-800 bg-emerald-500/10 text-emerald-300 text-xs">
              {sendResult}
            </div>
          )}

          {filteredEligible.length === 0 ? (
            <div className="py-10 text-center text-sm text-zinc-500">
              {data.totalScanned === 0
                ? "No scanned attendees yet."
                : "Every scanned attendee has submitted feedback. Nice."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900/70 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th className="px-4 py-2 w-10"></th>
                    <th className="px-4 py-2">Attendee</th>
                    <th className="px-4 py-2 w-40">Checked in</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {filteredEligible.map((row) => {
                    const checked = selectedTicketIds.has(row.ticketId);
                    return (
                      <tr
                        key={row.ticketId}
                        className={`hover:bg-zinc-900/40 ${checked ? "bg-zinc-900/60" : ""}`}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSelect(row.ticketId)}
                            className="rounded border-zinc-600 bg-zinc-800"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-white">{row.name || "—"}</div>
                          <div className="text-xs text-zinc-500">{row.email}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-400">
                          {formatTimestamp(row.scanTime)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
