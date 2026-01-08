"use client";

import { useEffect, useState } from "react";
import { PACIFIC_TIMEZONE } from "@/app/lib/constants";

type WaitlistEntry = {
  id: string;
  email: string;
  referral: string | null;
  position: number;
  created_at: string;
};

type EventDetails = {
  id: string;
  name: string | null;
  capacity: number;
  reserved: number | null;
  start_time_date: string | null;
  venue: string | null;
};

type EventGroup = {
  event: EventDetails;
  waitlist: WaitlistEntry[];
  totalCount: number;
};

type WaitlistViewerClientProps = {
  initialWaitlist: EventGroup[] | WaitlistEntry[];
  initialEvents: { id: string; name: string | null }[];
  isGrouped: boolean;
  initialEventId?: string | null;
};

function formatDisplayDate(dateString: string | null): string {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "N/A";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export default function WaitlistViewerClient({
  initialWaitlist,
  initialEvents,
  isGrouped: initialIsGrouped,
  initialEventId,
}: WaitlistViewerClientProps) {
  const [waitlist, setWaitlist] = useState<EventGroup[] | WaitlistEntry[]>(
    initialWaitlist,
  );
  const [selectedEventId, setSelectedEventId] = useState<string>(
    initialEventId || "",
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGrouped, setIsGrouped] = useState(initialIsGrouped);

  async function fetchWaitlist() {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (selectedEventId) {
        params.append("eventId", selectedEventId);
      }

      const response = await fetch(`/api/waitlist?${params}`);

      if (!response.ok) {
        let errorMessage = "Failed to fetch waitlist";
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

      if (data.grouped) {
        setWaitlist(data.leaderboard || []);
        setIsGrouped(true);
      } else {
        setWaitlist(data.waitlist || []);
        setIsGrouped(false);
      }
    } catch (err) {
      console.error("Error fetching waitlist:", err);
      setError(err instanceof Error ? err.message : "Failed to load waitlist");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchWaitlist();
  }, [selectedEventId]);

  function handleRefresh() {
    fetchWaitlist();
  }

  // Grouped view (all events)
  if (isGrouped && Array.isArray(waitlist) && waitlist.length > 0) {
    const eventGroups = waitlist as EventGroup[];
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
              Waitlist Management
            </h1>
            <p className="text-zinc-400">
              View and manage event waitlist entries
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="flex items-center gap-2 px-5 py-2.5 bg-zinc-800 text-white rounded-xl font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50"
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

        {/* Event Filter */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            Filter by Event
          </label>
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            className="w-full max-w-md px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
          >
            <option value="">All Events</option>
            {initialEvents.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name || "Unnamed Event"}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-3">
            <svg
              className="w-5 h-5 text-rose-400 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-rose-400 text-sm">{error}</p>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-16 bg-zinc-900/50 rounded-2xl border border-zinc-800">
            <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <div className="w-8 h-8 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
            </div>
            <p className="text-zinc-400">Loading waitlist...</p>
          </div>
        ) : (
          <div className="space-y-8">
            {eventGroups.map((group) => (
              <div
                key={group.event.id}
                className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden"
              >
                <div className="p-6 border-b border-zinc-800">
                  <h2 className="text-xl font-bold text-white mb-2">
                    {group.event.name || "Unnamed Event"}
                  </h2>
                  <div className="flex items-center gap-4 text-sm text-zinc-400">
                    <span>
                      Total Waitlist:{" "}
                      <span className="text-emerald-400 font-semibold">
                        {group.totalCount}
                      </span>
                    </span>
                    {group.event.venue && (
                      <span className="flex items-center gap-1">
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                        </svg>
                        {group.event.venue}
                      </span>
                    )}
                  </div>
                </div>

                {group.waitlist.length === 0 ? (
                  <div className="p-6">
                    <p className="text-zinc-400 text-sm text-center">
                      No waitlist entries yet
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-zinc-800 bg-zinc-800/50">
                          <th className="text-left px-6 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                            Position
                          </th>
                          <th className="text-left px-6 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                            Email
                          </th>
                          <th className="text-left px-6 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                            Referral
                          </th>
                          <th className="text-left px-6 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                            Joined
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800">
                        {group.waitlist.map((entry) => (
                          <tr
                            key={entry.id}
                            className="hover:bg-zinc-800/30 transition-colors"
                          >
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-zinc-800 text-white font-semibold text-sm">
                                {entry.position}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-white font-medium">
                              {entry.email}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-zinc-400">
                              {entry.referral || "—"}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-zinc-400 text-sm">
                              {formatDisplayDate(entry.created_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Single event view
  const entries = waitlist as WaitlistEntry[];
  const selectedEvent = initialEvents.find((e) => e.id === selectedEventId);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
            Waitlist Management
          </h1>
          <p className="text-zinc-400">
            View and manage event waitlist entries
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="flex items-center gap-2 px-5 py-2.5 bg-zinc-800 text-white rounded-xl font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50"
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

      {/* Event Filter */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-zinc-300 mb-2">
          Filter by Event
        </label>
        <select
          value={selectedEventId}
          onChange={(e) => setSelectedEventId(e.target.value)}
          className="w-full max-w-md px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
        >
          <option value="">All Events</option>
          {initialEvents.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name || "Unnamed Event"}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-3">
          <svg
            className="w-5 h-5 text-rose-400 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-rose-400 text-sm">{error}</p>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-16 bg-zinc-900/50 rounded-2xl border border-zinc-800">
          <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <div className="w-8 h-8 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
          </div>
          <p className="text-zinc-400">Loading waitlist...</p>
        </div>
      ) : entries.length === 0 ? (
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
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
          </div>
          <p className="text-zinc-400 text-lg mb-2">No waitlist entries</p>
          <p className="text-zinc-600 text-sm">
            {selectedEventId
              ? `No waitlist entries for ${selectedEvent?.name || "this event"}`
              : "No waitlist entries across any events"}
          </p>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          <div className="p-6 border-b border-zinc-800">
            <div className="flex items-center gap-4 text-sm text-zinc-400">
              <span>
                Total Entries:{" "}
                <span className="text-emerald-400 font-semibold">
                  {entries.length}
                </span>
              </span>
              {selectedEvent && (
                <span className="text-white font-medium">
                  {selectedEvent.name || "Unnamed Event"}
                </span>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-800/50">
                  <th className="text-left px-6 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                    Position
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                    Referral
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                    Joined
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="hover:bg-zinc-800/30 transition-colors"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-zinc-800 text-white font-semibold text-sm">
                        {entry.position}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-white font-medium">
                      {entry.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-zinc-400">
                      {entry.referral || "—"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-zinc-400 text-sm">
                      {formatDisplayDate(entry.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
