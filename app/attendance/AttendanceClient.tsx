"use client";

import { useEffect, useState, useMemo } from "react";
import { getAnalyticsCardGridStyle } from "@/app/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────

type AttendeeEvent = {
  eventId: string;
  eventName: string | null;
  eventDate: string | null;
  attended: boolean;
};

type Attendee = {
  email: string;
  name: string | null;
  eventsRegistered: number;
  eventsAttended: number;
  attendanceRate: number;
  currentStreak: number;
  firstSeen: string | null;
  lastSeen: string | null;
  events: AttendeeEvent[];
};

type EventSummary = {
  id: string;
  name: string | null;
  date: string | null;
  capacity: number;
  totalTickets: number;
  scannedCount: number;
};

type Stats = {
  totalUniqueAttendees: number;
  averageAttendanceRate: number;
  perfectAttendanceCount: number;
  zeroAttendanceCount: number;
  averageEventsPerPerson: number;
  repeatRate: number;
};

type AttendanceResponse = {
  attendees: Attendee[];
  events: EventSummary[];
  stats: Stats;
};

type FilterTab = "all" | "loyalists" | "flakers" | "mixed";

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "N/A";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ProgressBar({ value, max, color = "#10b981" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

function rateColor(rate: number): string {
  if (rate >= 0.9) return "text-emerald-400";
  if (rate >= 0.6) return "text-blue-400";
  if (rate >= 0.3) return "text-amber-400";
  return "text-rose-400";
}

function rateBgColor(rate: number): string {
  if (rate >= 0.9) return "#10b981";
  if (rate >= 0.6) return "#3b82f6";
  if (rate >= 0.3) return "#f59e0b";
  return "#f43f5e";
}

const ATTENDEE_PAGE_SIZE = 50;

// ── Main Component ───────────────────────────────────────────────────────

export default function AttendanceClient() {
  const [data, setData] = useState<AttendanceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [minEvents, setMinEvents] = useState(2);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    async function fetchData() {
      try {
        setIsLoading(true);
        setError(null);
        const res = await fetch("/api/attendance");
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Failed to fetch attendance data");
        }
        setData(await res.json());
      } catch (err) {
        console.error("Error fetching attendance:", err);
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, []);

  // Distribution histogram: attendance rate buckets (0-10%, 10-20%, ...)
  const histogram = useMemo(() => {
    if (!data) return [];
    const buckets = Array.from({ length: 10 }, (_, i) => ({
      label: `${i * 10}-${(i + 1) * 10}%`,
      min: i * 0.1,
      max: (i + 1) * 0.1,
      count: 0,
    }));
    const multi = data.attendees.filter((a) => a.eventsRegistered >= minEvents);
    for (const a of multi) {
      const idx = Math.min(Math.floor(a.attendanceRate * 10), 9);
      buckets[idx].count++;
    }
    return buckets;
  }, [data, minEvents]);

  const maxBucket = useMemo(() => Math.max(...histogram.map((b) => b.count), 1), [histogram]);

  // Filtered & searched attendees
  const filteredAttendees = useMemo(() => {
    if (!data) return [];
    let list = data.attendees.filter((a) => a.eventsRegistered >= minEvents);

    if (filterTab === "loyalists") list = list.filter((a) => a.attendanceRate >= 0.9);
    else if (filterTab === "flakers") list = list.filter((a) => a.attendanceRate <= 0.1);
    else if (filterTab === "mixed") list = list.filter((a) => a.attendanceRate > 0.1 && a.attendanceRate < 0.9);

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.email.toLowerCase().includes(q) ||
          (a.name && a.name.toLowerCase().includes(q)),
      );
    }

    return list;
  }, [data, filterTab, search, minEvents]);

  // Per-event new vs returning
  const eventRetention = useMemo(() => {
    if (!data || data.events.length === 0) return [];
    // Build a set of emails seen before each event (chronological)
    const sorted = [...data.events].sort(
      (a, b) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime(),
    );
    const seenEmails = new Set<string>();
    return sorted.map((ev) => {
      const attendees = data.attendees.filter((a) =>
        a.events.some((e) => e.eventId === ev.id),
      );
      let newCount = 0;
      let returningCount = 0;
      for (const a of attendees) {
        if (seenEmails.has(a.email.toLowerCase())) {
          returningCount++;
        } else {
          newCount++;
        }
        seenEmails.add(a.email.toLowerCase());
      }
      return {
        ...ev,
        newCount,
        returningCount,
        totalRegistered: attendees.length,
      };
    });
  }, [data]);

  useEffect(() => {
    setCurrentPage(1);
    setExpandedEmail(null);
  }, [filterTab, search, minEvents, data?.attendees.length]);

  useEffect(() => {
    setExpandedEmail(null);
  }, [currentPage]);

  // ── Loading / Error states ──

  if (isLoading) {
    return (
      <div className="px-4 sm:px-6 py-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-8">Attendance Overview</h1>
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-zinc-400">
            <div className="w-5 h-5 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
            <span className="text-sm">Loading attendance data...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 sm:px-6 py-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-8">Attendance Overview</h1>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <svg className="w-10 h-10 text-rose-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-rose-400 text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data || data.attendees.length === 0) {
    return (
      <div className="px-4 sm:px-6 py-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-8">Attendance Overview</h1>
        <div className="text-center py-16 bg-zinc-900/50 rounded-2xl border border-zinc-800">
          <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <p className="text-zinc-400 text-lg mb-2">No attendance data yet</p>
          <p className="text-zinc-600 text-sm">Attendance data appears after events have started</p>
        </div>
      </div>
    );
  }

  const { stats } = data;
  const multiEventCount = data.attendees.filter((a) => a.eventsRegistered >= minEvents).length;
  const loyalistCount = data.attendees.filter((a) => a.eventsRegistered >= minEvents && a.attendanceRate >= 0.9).length;
  const flakerCount = data.attendees.filter((a) => a.eventsRegistered >= minEvents && a.attendanceRate <= 0.1).length;
  const totalPages = Math.max(1, Math.ceil(filteredAttendees.length / ATTENDEE_PAGE_SIZE));
  const clampedPage = Math.min(currentPage, totalPages);
  const pageStart = (clampedPage - 1) * ATTENDEE_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + ATTENDEE_PAGE_SIZE, filteredAttendees.length);
  const paginatedAttendees = filteredAttendees.slice(pageStart, pageEnd);
  const visiblePageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (page) => page === 1 || page === totalPages || Math.abs(page - clampedPage) <= 1,
  );

  return (
    <div className="px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-1">Attendance Overview</h1>
        <p className="text-zinc-400 text-sm">Cross-event attendee patterns across {data.events.length} past events</p>
      </div>

      {/* ── Stats cards ── */}
      <div
        className="grid grid-cols-2 gap-3 analytics-card-grid"
        style={getAnalyticsCardGridStyle(6)}
      >
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">Unique Attendees</p>
          <p className="text-2xl font-bold text-white">{stats.totalUniqueAttendees}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">Avg Attendance</p>
          <p className="text-2xl font-bold text-blue-400">{(stats.averageAttendanceRate * 100).toFixed(0)}%</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">Perfect Record</p>
          <p className="text-2xl font-bold text-emerald-400">{stats.perfectAttendanceCount}</p>
          <p className="text-[10px] text-zinc-600">2+ events, 100% rate</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">Serial Flakers</p>
          <p className="text-2xl font-bold text-rose-400">{stats.zeroAttendanceCount}</p>
          <p className="text-[10px] text-zinc-600">2+ events, 0% rate</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">Avg Events/Person</p>
          <p className="text-2xl font-bold text-white">{stats.averageEventsPerPerson.toFixed(1)}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">Repeat Rate</p>
          <p className="text-2xl font-bold text-violet-400">{(stats.repeatRate * 100).toFixed(0)}%</p>
          <p className="text-[10px] text-zinc-600">attended 2+ events</p>
        </div>
      </div>

      {/* ── Attendance Rate Distribution ── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-zinc-300">Attendance Rate Distribution</h3>
          <p className="text-xs text-zinc-500">{multiEventCount} people with {minEvents}+ events</p>
        </div>
        <div className="flex items-end gap-1 h-32">
          {histogram.map((bucket, i) => {
            const heightPct = maxBucket > 0 ? (bucket.count / maxBucket) * 100 : 0;
            const barColor = i >= 9 ? "#10b981" : i >= 6 ? "#3b82f6" : i >= 3 ? "#f59e0b" : "#f43f5e";
            return (
              <div key={bucket.label} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] text-zinc-500">{bucket.count}</span>
                <div className="w-full flex items-end justify-center" style={{ height: "80px" }}>
                  <div
                    className="w-full max-w-[40px] rounded-t transition-all duration-300"
                    style={{
                      height: `${Math.max(heightPct, bucket.count > 0 ? 4 : 0)}%`,
                      backgroundColor: barColor,
                      opacity: 0.7,
                    }}
                  />
                </div>
                <span className="text-[9px] text-zinc-600 whitespace-nowrap">{i * 10}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Event-level new vs returning ── */}
      {eventRetention.length > 1 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h3 className="text-sm font-semibold text-zinc-300 mb-4">New vs Returning by Event</h3>
          <div className="space-y-2">
            {eventRetention.map((ev) => {
              const total = ev.totalRegistered || 1;
              const retPct = (ev.returningCount / total) * 100;
              return (
                <div key={ev.id} className="flex items-center gap-3">
                  <span className="text-xs text-zinc-400 w-32 truncate shrink-0" title={ev.name ?? ""}>
                    {ev.name || "Unnamed"}
                  </span>
                  <div className="flex-1 flex h-5 rounded overflow-hidden bg-zinc-800">
                    {ev.returningCount > 0 && (
                      <div
                        className="bg-blue-500 flex items-center justify-center text-[10px] text-white font-medium transition-all"
                        style={{ width: `${retPct}%` }}
                      >
                        {ev.returningCount > 3 ? ev.returningCount : ""}
                      </div>
                    )}
                    {ev.newCount > 0 && (
                      <div
                        className="bg-emerald-500 flex items-center justify-center text-[10px] text-white font-medium transition-all"
                        style={{ width: `${100 - retPct}%` }}
                      >
                        {ev.newCount > 3 ? ev.newCount : ""}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-zinc-500 w-12 text-right shrink-0">{ev.totalRegistered}</span>
                </div>
              );
            })}
            <div className="flex items-center gap-4 mt-2 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <span className="text-zinc-400">Returning</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-zinc-400">New</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Filter tabs + search ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex items-center gap-1 bg-zinc-900/80 p-1 rounded-xl border border-zinc-800">
          {([
            { key: "all", label: "All", count: multiEventCount },
            { key: "loyalists", label: "Loyalists", count: loyalistCount },
            { key: "flakers", label: "Flakers", count: flakerCount },
            { key: "mixed", label: "Mixed", count: multiEventCount - loyalistCount - flakerCount },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilterTab(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                filterTab === tab.key
                  ? "bg-zinc-700 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 text-xs text-zinc-500">{tab.count}</span>
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email..."
          className="flex-1 max-w-xs px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-500">Min events:</label>
          <select
            value={minEvents}
            onChange={(e) => setMinEvents(Number(e.target.value))}
            className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-white text-sm focus:outline-none"
          >
            <option value={1}>1+</option>
            <option value={2}>2+</option>
            <option value={3}>3+</option>
            <option value={5}>5+</option>
          </select>
        </div>
      </div>

      {/* ── Attendee table ── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Attendee</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Events</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Attended</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Rate</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Streak</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider hidden lg:table-cell">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {paginatedAttendees.map((a) => {
                const isExpanded = expandedEmail === a.email;
                return (
                  <tr key={a.email} className="group">
                    <td className="px-4 py-3" colSpan={isExpanded ? 6 : undefined}>
                      {!isExpanded ? null : (
                        /* Expanded row content rendered in a single-cell block below */
                        null
                      )}
                      <button
                        onClick={() => setExpandedEmail(isExpanded ? null : a.email)}
                        className="flex items-center gap-3 text-left w-full"
                      >
                        <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-300 shrink-0">
                          {(a.name || a.email)[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-white font-medium truncate">{a.name || "No name"}</p>
                          <p className="text-xs text-zinc-500 truncate">{a.email}</p>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="mt-3 ml-11 space-y-1.5">
                          {a.events.map((ev) => (
                            <div key={ev.eventId} className="flex items-center gap-2 text-xs">
                              <div className={`w-2 h-2 rounded-full ${ev.attended ? "bg-emerald-500" : "bg-rose-500"}`} />
                              <span className="text-zinc-400 truncate">{ev.eventName || "Unnamed"}</span>
                              <span className="text-zinc-600">{formatDate(ev.eventDate)}</span>
                              <span className={ev.attended ? "text-emerald-400" : "text-rose-400"}>
                                {ev.attended ? "Attended" : "No-show"}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    {!isExpanded && (
                      <>
                        <td className="text-center px-3 py-3 text-zinc-300">{a.eventsRegistered}</td>
                        <td className="text-center px-3 py-3 text-zinc-300">{a.eventsAttended}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`font-bold ${rateColor(a.attendanceRate)}`}>
                              {(a.attendanceRate * 100).toFixed(0)}%
                            </span>
                            <div className="w-16">
                              <ProgressBar value={a.eventsAttended} max={a.eventsRegistered} color={rateBgColor(a.attendanceRate)} />
                            </div>
                          </div>
                        </td>
                        <td className="text-center px-3 py-3">
                          {a.currentStreak > 0 ? (
                            <span className="text-emerald-400 font-medium">{a.currentStreak}</span>
                          ) : (
                            <span className="text-zinc-600">0</span>
                          )}
                        </td>
                        <td className="text-left px-3 py-3 text-zinc-500 text-xs hidden lg:table-cell">
                          {formatDate(a.lastSeen)}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredAttendees.length > 0 && (
          <div className="px-4 py-3 border-t border-zinc-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-zinc-500">
              Showing {pageStart + 1}-{pageEnd} of {filteredAttendees.length} attendees
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap sm:justify-end">
                <button
                  onClick={() => setCurrentPage((page) => Math.max(page - 1, 1))}
                  disabled={clampedPage === 1}
                  className="px-2.5 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-700 transition-colors"
                >
                  Prev
                </button>
                {visiblePageNumbers.map((page, index) => {
                  const previousPage = visiblePageNumbers[index - 1];
                  const needsGap = previousPage != null && page - previousPage > 1;
                  return (
                    <div key={page} className="flex items-center gap-1.5">
                      {needsGap && (
                        <span className="px-1 text-xs text-zinc-600">…</span>
                      )}
                      <button
                        onClick={() => setCurrentPage(page)}
                        className={`min-w-8 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                          clampedPage === page
                            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                            : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                        }`}
                      >
                        {page}
                      </button>
                    </div>
                  );
                })}
                <button
                  onClick={() => setCurrentPage((page) => Math.min(page + 1, totalPages))}
                  disabled={clampedPage === totalPages}
                  className="px-2.5 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-700 transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
        {filteredAttendees.length === 0 && (
          <div className="px-4 py-8 text-center text-zinc-500 text-sm">
            No attendees match your filters
          </div>
        )}
      </div>
    </div>
  );
}
