"use client";

import { useEffect, useMemo, useState } from "react";
import { useEventContext } from "../EventContext";

type AnnounceRow = {
  email: string;
  displayEmail: string;
  source: string;
};

type UnsubRow = {
  id: string;
  email: string;
  scope: "announce" | "event";
  eventId: string | null;
  source: string;
  reason: string | null;
  actor: string;
  createdAt: string;
};

type EventOption = {
  id: string;
  name: string;
  startTime: string | null;
};

type Stats = {
  total: number;
  optedOut: number;
};

type Props = {
  initialRows: AnnounceRow[];
  initialTotal: number;
  initialOptOuts: UnsubRow[];
  initialStats: Stats;
  events: EventOption[];
  initialLimit: number;
};

type Tab = "announce" | "event";

export default function MailingListsClient({
  initialRows,
  initialTotal,
  initialOptOuts,
  initialStats,
  events,
  initialLimit,
}: Props) {
  const { selectedEventId } = useEventContext();
  const [tab, setTab] = useState<Tab>("announce");

  // Announce tab state
  const [announceRows, setAnnounceRows] = useState<AnnounceRow[]>(initialRows);
  const [announceTotal, setAnnounceTotal] = useState<number>(initialTotal);
  const [announceOptOuts, setAnnounceOptOuts] = useState<UnsubRow[]>(initialOptOuts);
  const [stats, setStats] = useState<Stats>(initialStats);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [limit] = useState(initialLimit);
  const [loadingAnnounce, setLoadingAnnounce] = useState(false);

  // Event tab state
  const [eventTabId, setEventTabId] = useState<string>(selectedEventId ?? "");
  const [eventOptOuts, setEventOptOuts] = useState<UnsubRow[]>([]);
  const [eventName, setEventName] = useState<string>("");
  const [loadingEvent, setLoadingEvent] = useState(false);

  // Modal / shared state
  const [actionEmail, setActionEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Manual-add (event tab) state
  const [addEmail, setAddEmail] = useState("");
  const [addReason, setAddReason] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch]);

  useEffect(() => {
    if (tab !== "announce") return;
    let cancelled = false;
    (async () => {
      setLoadingAnnounce(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          view: "announce",
          limit: String(limit),
          offset: String(offset),
        });
        if (debouncedSearch) params.set("search", debouncedSearch);
        const res = await fetch(`/api/mailing-lists?${params.toString()}`);
        if (!res.ok) throw new Error((await res.json()).error || "Failed");
        const data = await res.json();
        if (cancelled) return;
        setAnnounceRows(data.rows);
        setAnnounceTotal(data.total);
        setAnnounceOptOuts(data.optOuts);
        setStats(data.stats);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoadingAnnounce(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, debouncedSearch, offset, limit]);

  useEffect(() => {
    if (tab !== "event" || !eventTabId) return;
    let cancelled = false;
    (async () => {
      setLoadingEvent(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/mailing-lists?view=event&eventId=${encodeURIComponent(eventTabId)}`,
        );
        if (!res.ok) throw new Error((await res.json()).error || "Failed");
        const data = await res.json();
        if (cancelled) return;
        setEventOptOuts(data.optOuts);
        setEventName(data.event?.name ?? "");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoadingEvent(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, eventTabId]);

  async function refreshAnnounce() {
    const params = new URLSearchParams({
      view: "announce",
      limit: String(limit),
      offset: String(offset),
    });
    if (debouncedSearch) params.set("search", debouncedSearch);
    const res = await fetch(`/api/mailing-lists?${params.toString()}`);
    if (!res.ok) return;
    const data = await res.json();
    setAnnounceRows(data.rows);
    setAnnounceTotal(data.total);
    setAnnounceOptOuts(data.optOuts);
    setStats(data.stats);
  }

  async function refreshEvent(eventId: string) {
    const res = await fetch(
      `/api/mailing-lists?view=event&eventId=${encodeURIComponent(eventId)}`,
    );
    if (!res.ok) return;
    const data = await res.json();
    setEventOptOuts(data.optOuts);
    setEventName(data.event?.name ?? "");
  }

  async function handleAdminUnsubscribe(opts: {
    scope: "announce" | "event";
    email: string;
    eventId?: string;
    reason?: string;
  }) {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/mailing-lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "unsubscribe", ...opts }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error ?? "Failed to unsubscribe");
      }
      setSuccess(`${opts.email} unsubscribed`);
      if (opts.scope === "announce") await refreshAnnounce();
      else if (opts.eventId) await refreshEvent(opts.eventId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
      setActionEmail(null);
    }
  }

  async function handleAdminResubscribe(opts: {
    scope: "announce" | "event";
    email: string;
    eventId?: string;
  }) {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/mailing-lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resubscribe", ...opts }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error ?? "Failed to resubscribe");
      }
      setSuccess(`${opts.email} resubscribed`);
      if (opts.scope === "announce") await refreshAnnounce();
      else if (opts.eventId) await refreshEvent(opts.eventId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  const announceCounts = useMemo(
    () => ({
      receiving: stats.total,
      optedOut: stats.optedOut,
    }),
    [stats],
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-4 sm:px-8 py-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-white font-serif">
            Mailing Lists
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            View the announce list and per-event opt-outs. Manual unsubscribe /
            resubscribe is logged to the audit trail.
          </p>
        </header>

        {(error || success) && (
          <div
            className={`mb-4 rounded-lg border px-4 py-2 text-sm ${error
                ? "border-rose-700 bg-rose-950 text-rose-200"
                : "border-emerald-700 bg-emerald-950 text-emerald-200"
              }`}
          >
            {error || success}
          </div>
        )}

        <div className="flex gap-1 border-b border-zinc-800 mb-6">
          <TabButton
            active={tab === "announce"}
            onClick={() => setTab("announce")}
          >
            Announce
          </TabButton>
          <TabButton active={tab === "event"} onClick={() => setTab("event")}>
            Per-event opt-outs
          </TabButton>
        </div>

        {tab === "announce" && (
          <section>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
              <StatCard
                label="On announce"
                value={announceCounts.receiving.toLocaleString()}
                tone="emerald"
              />
              <StatCard
                label="Opted out of announce"
                value={announceCounts.optedOut.toLocaleString()}
                tone="rose"
              />
              <StatCard
                label="Unique emails total"
                value={(announceCounts.receiving + announceCounts.optedOut).toLocaleString()}
                tone="zinc"
              />
            </div>

            <div className="mb-3 flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
              <input
                type="text"
                placeholder="Search emails…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full sm:max-w-sm rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500"
              />
              <div className="text-xs text-zinc-500">
                {loadingAnnounce ? "Loading…" : `${announceTotal.toLocaleString()} matches`}
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Email</th>
                    <th className="text-left px-4 py-2 font-medium">Source</th>
                    <th className="text-right px-4 py-2 font-medium w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {announceRows.map((row) => (
                    <tr
                      key={row.email}
                      className="border-t border-zinc-800 hover:bg-zinc-900/50"
                    >
                      <td className="px-4 py-2 font-mono text-xs">
                        <div>{row.displayEmail}</div>
                        {row.displayEmail.toLowerCase() !== row.email && (
                          <div className="text-[10px] text-zinc-500">
                            canonical: {row.email}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-zinc-400">
                        {row.source}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setActionEmail(row.email)}
                          className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                        >
                          Unsubscribe
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!loadingAnnounce && announceRows.length === 0 && (
                    <tr>
                      <td className="px-4 py-6 text-center text-zinc-500" colSpan={3}>
                        No emails match.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mb-10">
              <button
                type="button"
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0 || loadingAnnounce}
                className="text-xs px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-xs text-zinc-500">
                {offset + 1}–{Math.min(offset + announceRows.length, announceTotal)} of{" "}
                {announceTotal.toLocaleString()}
              </span>
              <button
                type="button"
                onClick={() => setOffset(offset + limit)}
                disabled={offset + announceRows.length >= announceTotal || loadingAnnounce}
                className="text-xs px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>

            <h2 className="text-base font-semibold text-white mb-3">
              Announce opt-outs
              <span className="ml-2 text-zinc-500 font-normal text-sm">
                ({announceOptOuts.length})
              </span>
            </h2>
            <OptOutTable
              rows={announceOptOuts}
              showEvent={false}
              onResubscribe={(row) =>
                handleAdminResubscribe({
                  scope: "announce",
                  email: row.email,
                })
              }
              submitting={submitting}
            />
          </section>
        )}

        {tab === "event" && (
          <section>
            <div className="mb-4 flex flex-col sm:flex-row gap-3 sm:items-end">
              <div>
                <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">
                  Event
                </label>
                <select
                  value={eventTabId}
                  onChange={(e) => setEventTabId(e.target.value)}
                  className="rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm min-w-[280px]"
                >
                  <option value="">Select an event…</option>
                  {events.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                      {e.startTime
                        ? ` — ${new Date(e.startTime).toLocaleDateString()}`
                        : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!eventTabId && (
              <p className="text-sm text-zinc-500">
                Pick an event to see its opt-out roster.
              </p>
            )}

            {eventTabId && (
              <>
                <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                  <h3 className="text-sm font-semibold text-white mb-3">
                    Manually opt someone out of {eventName || "this event"}
                  </h3>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="email"
                      placeholder="email@stanford.edu"
                      value={addEmail}
                      onChange={(e) => setAddEmail(e.target.value)}
                      className="flex-1 rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Reason (optional)"
                      value={addReason}
                      onChange={(e) => setAddReason(e.target.value)}
                      className="flex-1 rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      disabled={!addEmail.trim() || submitting}
                      onClick={async () => {
                        await handleAdminUnsubscribe({
                          scope: "event",
                          email: addEmail.trim(),
                          eventId: eventTabId,
                          reason: addReason.trim() || undefined,
                        });
                        setAddEmail("");
                        setAddReason("");
                      }}
                      className="rounded-lg bg-rose-600 hover:bg-rose-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white px-4 py-2 text-sm font-medium"
                    >
                      Add opt-out
                    </button>
                  </div>
                </div>

                <h2 className="text-base font-semibold text-white mb-3">
                  Opt-outs for {eventName || "event"}
                  <span className="ml-2 text-zinc-500 font-normal text-sm">
                    ({eventOptOuts.length})
                  </span>
                </h2>
                {loadingEvent ? (
                  <p className="text-sm text-zinc-500">Loading…</p>
                ) : (
                  <OptOutTable
                    rows={eventOptOuts}
                    showEvent={false}
                    onResubscribe={(row) =>
                      handleAdminResubscribe({
                        scope: "event",
                        email: row.email,
                        eventId: eventTabId,
                      })
                    }
                    submitting={submitting}
                  />
                )}
              </>
            )}
          </section>
        )}

        {actionEmail && (
          <ConfirmModal
            email={actionEmail}
            onCancel={() => setActionEmail(null)}
            onConfirm={(reason) =>
              handleAdminUnsubscribe({
                scope: "announce",
                email: actionEmail,
                reason: reason || undefined,
              })
            }
            submitting={submitting}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${active
          ? "border-rose-500 text-white"
          : "border-transparent text-zinc-400 hover:text-zinc-200"
        }`}
    >
      {children}
    </button>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "rose" | "zinc";
}) {
  const toneClasses = {
    emerald: "from-emerald-500/10 to-emerald-700/0 border-emerald-800/50 text-emerald-300",
    rose: "from-rose-500/10 to-rose-700/0 border-rose-800/50 text-rose-300",
    zinc: "from-zinc-500/10 to-zinc-700/0 border-zinc-800/50 text-zinc-300",
  }[tone];
  return (
    <div
      className={`rounded-xl border bg-gradient-to-b p-4 ${toneClasses}`}
    >
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-2xl font-semibold text-white mt-1">{value}</div>
    </div>
  );
}

function OptOutTable({
  rows,
  showEvent,
  onResubscribe,
  submitting,
}: {
  rows: UnsubRow[];
  showEvent: boolean;
  onResubscribe: (row: UnsubRow) => void;
  submitting: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Email</th>
            <th className="text-left px-4 py-2 font-medium">Source</th>
            <th className="text-left px-4 py-2 font-medium">Reason</th>
            <th className="text-left px-4 py-2 font-medium">When</th>
            {showEvent && (
              <th className="text-left px-4 py-2 font-medium">Event</th>
            )}
            <th className="text-right px-4 py-2 font-medium w-32"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-zinc-800 hover:bg-zinc-900/50">
              <td className="px-4 py-2 font-mono text-xs">{row.email}</td>
              <td className="px-4 py-2 text-zinc-400">{row.source}</td>
              <td className="px-4 py-2 text-zinc-400">{row.reason || "—"}</td>
              <td className="px-4 py-2 text-zinc-500 text-xs">
                {new Date(row.createdAt).toLocaleString()}
              </td>
              {showEvent && (
                <td className="px-4 py-2 text-zinc-400 text-xs">
                  {row.eventId ?? "—"}
                </td>
              )}
              <td className="px-4 py-2 text-right">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => onResubscribe(row)}
                  className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                >
                  Resubscribe
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                className="px-4 py-6 text-center text-zinc-500"
                colSpan={showEvent ? 6 : 5}
              >
                No opt-outs yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ConfirmModal({
  email,
  onCancel,
  onConfirm,
  submitting,
}: {
  email: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  submitting: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h3 className="text-base font-semibold text-white mb-2">
          Unsubscribe from announce?
        </h3>
        <p className="text-sm text-zinc-400 mb-4">
          <span className="font-mono text-zinc-200">{email}</span> will stop
          receiving promotional emails about every future event — announcements,
          &ldquo;tickets available&rdquo; notices, and general blasts. They&rsquo;ll still
          get confirmations and reminders for any events they&rsquo;ve already
          got tickets to.
        </p>
        <input
          type="text"
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm mb-4"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason)}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded bg-rose-600 hover:bg-rose-500 text-white"
          >
            {submitting ? "Saving…" : "Unsubscribe"}
          </button>
        </div>
      </div>
    </div>
  );
}
