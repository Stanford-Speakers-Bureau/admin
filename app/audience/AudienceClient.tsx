"use client";

import { useEffect, useMemo, useState } from "react";
import BulkSendProgress from "@/app/components/BulkSendProgress";
import { useEventContext } from "@/app/EventContext";
import {
  BulkSendProgressState,
  runChunkedSend,
} from "@/app/lib/bulkSend";
import { formatDate, formatDateShort } from "@/app/lib/formatting";
import { getAnalyticsCardGridStyle } from "@/app/lib/utils";

type AudienceEventSummary = {
  id: string;
  name: string | null;
  route: string | null;
  date: string | null;
};

type Affiliation =
  | "student"
  | "faculty"
  | "affiliate"
  | "staff"
  | "member"
  | "missing";

type AudienceUser = {
  email: string;
  displayName: string | null;
  affiliation: Affiliation;
  lastLoginAt: string | null;
  currentEventStatus: {
    onNotifyList: boolean;
    ticketed: boolean;
    attended: boolean;
  };
  counts: {
    notified: number;
    ticketed: number;
    attended: number;
    totalHistoryEvents: number;
  };
};

type AudienceResponse = {
  event: AudienceEventSummary;
  users: AudienceUser[];
  stats: {
    totalUsers: number;
    currentEventNotifyUsers: number;
    currentEventEngagedUsers: number;
    usersWithAnyEventActivity: number;
    affiliationCounts: Record<Affiliation, number>;
  };
  warnings: string[];
};

type AudienceUserDetails = {
  notifyEvents: AudienceEventSummary[];
  ticketedEvents: AudienceEventSummary[];
  attendedEvents: AudienceEventSummary[];
};

type EventStatusFilter =
  | "all"
  | "engaged"
  | "notify"
  | "ticketed"
  | "attended";

type AffiliationFilter = "all" | Affiliation;
type ActivityFilter = "all" | "with_history" | "without_history";

const USER_PAGE_SIZE = 50;
const AFFILIATION_ORDER: Affiliation[] = [
  "student",
  "faculty",
  "affiliate",
  "staff",
  "member",
  "missing",
];

function getInitials(user: AudienceUser): string {
  const source = user.displayName || user.email;
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function formatAffiliationLabel(affiliation: Affiliation): string {
  if (affiliation === "missing") return "Missing";
  return affiliation.charAt(0).toUpperCase() + affiliation.slice(1);
}

function affiliationClasses(affiliation: Affiliation): string {
  switch (affiliation) {
    case "student":
      return "border-blue-500/30 bg-blue-500/10 text-blue-300";
    case "faculty":
      return "border-violet-500/30 bg-violet-500/10 text-violet-300";
    case "affiliate":
      return "border-cyan-500/30 bg-cyan-500/10 text-cyan-300";
    case "staff":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "member":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "missing":
      return "border-zinc-700 bg-zinc-800/80 text-zinc-400";
  }
}

function AffiliationPill({
  affiliation,
}: {
  affiliation: Affiliation;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${affiliationClasses(affiliation)}`}
    >
      {formatAffiliationLabel(affiliation)}
    </span>
  );
}

function EventBadge({
  event,
  tone,
}: {
  event: AudienceEventSummary;
  tone: "amber" | "blue" | "emerald";
}) {
  const toneClasses = {
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  };

  return (
    <div
      className={`rounded-lg border px-3 py-2 text-xs ${toneClasses[tone]}`}
      title={event.name || "Unnamed event"}
    >
      <p className="font-medium truncate">{event.name || "Unnamed event"}</p>
      <p className="mt-1 text-[11px] opacity-80">{formatDateShort(event.date)}</p>
    </div>
  );
}

function getCurrentEventStatus(user: AudienceUser): {
  label: "Notify" | "Ticketed" | "Attended" | "None";
  classes: string;
} {
  const activeClasses = {
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  };

  if (user.currentEventStatus.attended) {
    return { label: "Attended", classes: activeClasses.emerald };
  }

  if (user.currentEventStatus.ticketed) {
    return { label: "Ticketed", classes: activeClasses.blue };
  }

  if (user.currentEventStatus.onNotifyList) {
    return { label: "Notify", classes: activeClasses.amber };
  }

  return {
    label: "None",
    classes: "border-zinc-700 bg-zinc-800/80 text-zinc-500",
  };
}

export default function AudienceClient() {
  const { selectedEventId } = useEventContext();
  const [data, setData] = useState<AudienceResponse | null>(null);
  const [detailsByEmail, setDetailsByEmail] = useState<
    Record<string, AudienceUserDetails>
  >({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [loadingDetailEmail, setLoadingDetailEmail] = useState<string | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<EventStatusFilter>("all");
  const [affiliationFilter, setAffiliationFilter] =
    useState<AffiliationFilter>("all");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendState, setSendState] = useState<BulkSendProgressState | null>(null);
  const [individualSending, setIndividualSending] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAudienceData() {
      if (!selectedEventId) {
        setData(null);
        setDetailsByEmail({});
        setDetailErrors({});
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        setDetailsByEmail({});
        setDetailErrors({});
        setExpandedEmail(null);

        const response = await fetch(`/api/events/${selectedEventId}/audience`);

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch audience data");
        }

        setData(await response.json());
      } catch (err) {
        console.error("Error fetching audience data:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load audience data",
        );
      } finally {
        setIsLoading(false);
      }
    }

    fetchAudienceData();
  }, [selectedEventId]);

  async function loadUserDetails(email: string) {
    if (!selectedEventId) return;
    if (detailsByEmail[email] || loadingDetailEmail === email) return;

    setLoadingDetailEmail(email);
    setDetailErrors((prev) => {
      if (!prev[email]) return prev;
      const next = { ...prev };
      delete next[email];
      return next;
    });

    try {
      const params = new URLSearchParams({ email });
      const response = await fetch(
        `/api/events/${selectedEventId}/audience/user?${params.toString()}`,
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch user history");
      }

      const detailData = (await response.json()) as AudienceUserDetails;
      setDetailsByEmail((prev) => ({ ...prev, [email]: detailData }));
    } catch (err) {
      console.error("Error fetching audience user details:", err);
      setDetailErrors((prev) => ({
        ...prev,
        [email]:
          err instanceof Error ? err.message : "Failed to fetch user history",
      }));
    } finally {
      setLoadingDetailEmail((current) => (current === email ? null : current));
    }
  }

  const filteredUsers = useMemo(() => {
    if (!data) return [];

    let list = data.users;

    if (statusFilter === "engaged") {
      list = list.filter(
        (user) =>
          user.currentEventStatus.onNotifyList ||
          user.currentEventStatus.ticketed ||
          user.currentEventStatus.attended,
      );
    } else if (statusFilter === "notify") {
      list = list.filter((user) => user.currentEventStatus.onNotifyList);
    } else if (statusFilter === "ticketed") {
      list = list.filter((user) => user.currentEventStatus.ticketed);
    } else if (statusFilter === "attended") {
      list = list.filter((user) => user.currentEventStatus.attended);
    }

    if (affiliationFilter !== "all") {
      list = list.filter((user) => user.affiliation === affiliationFilter);
    }

    if (activityFilter === "with_history") {
      list = list.filter((user) => user.counts.totalHistoryEvents > 0);
    } else if (activityFilter === "without_history") {
      list = list.filter((user) => user.counts.totalHistoryEvents === 0);
    }

    const tokens = search
      .toLowerCase()
      .split(/[\n,]+/g)
      .map((token) => token.trim())
      .filter(Boolean);

    if (tokens.length > 0) {
      list = list.filter((user) => {
        const haystacks = [
          user.email.toLowerCase(),
          user.displayName?.toLowerCase() ?? "",
        ];

        return tokens.some((token) =>
          haystacks.some((haystack) => haystack.includes(token)),
        );
      });
    }

    return list;
  }, [activityFilter, affiliationFilter, data, search, statusFilter]);

  const nonNotifyEmails = useMemo(() => {
    if (!data) return [];
    return [...new Set(
      data.users
        .filter((u) => !u.currentEventStatus.onNotifyList)
        .map((u) => u.email.toLowerCase()),
    )];
  }, [data]);

  const CHUNK_SIZE = 50;

  async function sendAnnouncementToAll() {
    if (!selectedEventId || nonNotifyEmails.length === 0) return;
    setShowSendModal(false);
    await runChunkedSend({
      items: nonNotifyEmails,
      chunkSize: CHUNK_SIZE,
      label: "Sending announcements",
      onProgress: setSendState,
      sendChunk: async (chunk) => {
        const res = await fetch("/api/email/bulk-send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: selectedEventId,
            emails: chunk,
            kind: "announcement",
          }),
        });
        const result = await res.json().catch(() => null);

        if (!res.ok) {
          throw new Error(result?.error || "Failed to send announcement emails");
        }

        return result;
      },
    });
  }

  async function sendAnnouncementToOne(email: string) {
    if (!selectedEventId) return;
    if (!confirm(`Send announcement email to ${email}?`)) return;
    setIndividualSending(email);
    try {
      const res = await fetch("/api/email/bulk-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: selectedEventId,
          emails: [email],
          kind: "announcement",
        }),
      });
      const result = await res.json();
      if (result.sent === 1) {
        setIndividualSending(null);
      } else {
        setIndividualSending(null);
      }
    } catch {
      setIndividualSending(null);
    }
  }

  useEffect(() => {
    setCurrentPage(1);
    setExpandedEmail(null);
  }, [activityFilter, affiliationFilter, search, selectedEventId, statusFilter]);

  useEffect(() => {
    setSendState(null);
  }, [selectedEventId]);

  useEffect(() => {
    setExpandedEmail(null);
  }, [currentPage]);

  if (!selectedEventId) {
    return (
      <div className="px-4 sm:px-6 py-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-8">
          Event Audience
        </h1>
        <div className="text-center py-16 bg-zinc-900/50 rounded-2xl border border-zinc-800">
          <p className="text-zinc-400 text-lg mb-2">Select an event to continue</p>
          <p className="text-zinc-600 text-sm">
            The audience view follows the event selected in the sidebar.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="px-4 sm:px-6 py-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-8">
          Event Audience
        </h1>
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-zinc-400">
            <div className="w-5 h-5 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
            <span className="text-sm">Loading audience data...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 sm:px-6 py-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-8">
          Event Audience
        </h1>
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <svg
              className="w-10 h-10 text-rose-400 mx-auto mb-2"
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
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const totalPages = Math.max(
    1,
    Math.ceil(filteredUsers.length / USER_PAGE_SIZE),
  );
  const clampedPage = Math.min(currentPage, totalPages);
  const pageStart = (clampedPage - 1) * USER_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + USER_PAGE_SIZE, filteredUsers.length);
  const paginatedUsers = filteredUsers.slice(pageStart, pageEnd);
  const visiblePageNumbers = Array.from(
    { length: totalPages },
    (_, index) => index + 1,
  ).filter(
    (page) => page === 1 || page === totalPages || Math.abs(page - clampedPage) <= 1,
  );
  const usersWithoutHistory =
    data.stats.totalUsers - data.stats.usersWithAnyEventActivity;

  return (
    <div className="px-4 sm:px-6 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-1">
            Event Audience
          </h1>
          <p className="text-zinc-400 text-sm">
            Users who have logged in and their notify, ticket, and attendance history for{" "}
            <span className="text-zinc-200 font-medium">
              {data.event.name || "Unnamed event"}
            </span>
            {data.event.date ? ` • ${formatDate(data.event.date)}` : ""}
          </p>
        </div>
        {nonNotifyEmails.length > 0 && (
          <button
            onClick={() => setShowSendModal(true)}
            disabled={sendState?.active}
            className="shrink-0 flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
            Send Announcement
          </button>
        )}
      </div>

      {/* Progress bar */}
      {sendState && (
        <BulkSendProgress
          state={sendState}
          onDismiss={() => setSendState(null)}
        />
      )}

      {/* Send Announcement Modal */}
      {showSendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-2">Send Announcement</h2>
            <p className="text-sm text-zinc-400 mb-4">
              Send an announcement email to <span className="text-white font-semibold">{nonNotifyEmails.length.toLocaleString()}</span> users
              who have not signed up for notifications for{" "}
              <span className="text-white font-medium">{data.event.name || "this event"}</span>.
            </p>
            {nonNotifyEmails.length > 500 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 mb-4">
                <p className="text-xs text-amber-300">
                  Large batch — this will send in chunks of {CHUNK_SIZE} and may take a few minutes.
                </p>
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowSendModal(false)}
                className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={sendAnnouncementToAll}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Send {nonNotifyEmails.length.toLocaleString()} Emails
              </button>
            </div>
          </div>
        </div>
      )}

      {data.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm text-amber-300">{data.warnings[0]}</p>
        </div>
      )}

      <div
        className="grid grid-cols-2 gap-3 analytics-card-grid"
        style={getAnalyticsCardGridStyle(4)}
      >
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">
            Total Users
          </p>
          <p className="text-2xl font-bold text-white">{data.stats.totalUsers}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">
            Current Event Engaged
          </p>
          <p className="text-2xl font-bold text-blue-400">
            {data.stats.currentEventEngagedUsers}
          </p>
          <p className="text-[10px] text-zinc-600">Notify, ticketed, or attended</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">
            Signed Up for Notify
          </p>
          <p className="text-2xl font-bold text-amber-400">
            {data.stats.currentEventNotifyUsers}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">
            No Event History
          </p>
          <p className="text-2xl font-bold text-zinc-300">{usersWithoutHistory}</p>
          <p className="text-[10px] text-zinc-600">Logged in, but no notify/ticket activity</p>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-300">
              Affiliation Breakdown
            </h3>
            <p className="text-xs text-zinc-500">
              Click a category to filter the table
            </p>
          </div>
          {affiliationFilter !== "all" && (
            <button
              onClick={() => setAffiliationFilter("all")}
              className="text-xs text-zinc-400 hover:text-white transition-colors"
            >
              Clear affiliation filter
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {AFFILIATION_ORDER.map((affiliation) => {
            const isActive = affiliationFilter === affiliation;
            return (
              <button
                key={affiliation}
                onClick={() =>
                  setAffiliationFilter((current) =>
                    current === affiliation ? "all" : affiliation,
                  )
                }
                className={`rounded-xl border p-4 text-left transition-colors ${
                  isActive
                    ? "border-zinc-500 bg-zinc-800/80"
                    : "border-zinc-800 bg-zinc-950/30 hover:border-zinc-700"
                }`}
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">
                  {formatAffiliationLabel(affiliation)}
                </p>
                <p className="text-2xl font-bold text-white">
                  {data.stats.affiliationCounts[affiliation]}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,180px))] gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              Search Users
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or email. Comma-separated works too."
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              Current Event
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as EventStatusFilter)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600"
            >
              <option value="all">All users</option>
              <option value="engaged">Any event status</option>
              <option value="notify">On notify list</option>
              <option value="ticketed">Ticketed</option>
              <option value="attended">Attended</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              Affiliation
            </label>
            <select
              value={affiliationFilter}
              onChange={(e) =>
                setAffiliationFilter(e.target.value as AffiliationFilter)
              }
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600"
            >
              <option value="all">All affiliations</option>
              {AFFILIATION_ORDER.map((affiliation) => (
                <option key={affiliation} value={affiliation}>
                  {formatAffiliationLabel(affiliation)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              History
            </label>
            <select
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.target.value as ActivityFilter)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600"
            >
              <option value="all">All users</option>
              <option value="with_history">With event history</option>
              <option value="without_history">No event history</option>
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                  User
                </th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                  Affiliation
                </th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                  Last Login
                </th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                  This Event
                </th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                  History
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {paginatedUsers.map((user) => {
                const isExpanded = expandedEmail === user.email;
                const userDetails = detailsByEmail[user.email];
                const detailError = detailErrors[user.email];
                const isLoadingDetails = loadingDetailEmail === user.email;
                const currentEventStatus = getCurrentEventStatus(user);

                return (
                  <tr key={user.email}>
                    <td className="px-4 py-3" colSpan={isExpanded ? 5 : undefined}>
                      <button
                        onClick={() => {
                          const nextExpanded = isExpanded ? null : user.email;
                          setExpandedEmail(nextExpanded);
                          if (nextExpanded) {
                            void loadUserDetails(user.email);
                          }
                        }}
                        className="flex w-full items-start gap-3 text-left"
                      >
                        <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-300 shrink-0">
                          {getInitials(user)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <p className="text-white font-medium truncate">
                              {user.displayName || "No name on file"}
                            </p>
                            <AffiliationPill affiliation={user.affiliation} />
                          </div>
                          <p className="text-xs text-zinc-500 truncate">{user.email}</p>

                          {isExpanded && (
                            <div className="mt-4 space-y-4">
                              {isLoadingDetails && !userDetails ? (
                                <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                                  <div className="flex items-center gap-3 text-zinc-400">
                                    <div className="w-4 h-4 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
                                    <span className="text-sm">
                                      Loading event history...
                                    </span>
                                  </div>
                                </div>
                              ) : detailError ? (
                                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
                                  <p className="text-sm text-rose-300">{detailError}</p>
                                </div>
                              ) : userDetails ? (
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                                      Notified
                                    </p>
                                    {userDetails.notifyEvents.length > 0 ? (
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {userDetails.notifyEvents.map((event) => (
                                          <EventBadge
                                            key={`notify-${event.id}`}
                                            event={event}
                                            tone="amber"
                                          />
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-xs text-zinc-500">
                                        No notify signups yet.
                                      </p>
                                    )}
                                  </div>
                                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                                      Ticketed
                                    </p>
                                    {userDetails.ticketedEvents.length > 0 ? (
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {userDetails.ticketedEvents.map((event) => (
                                          <EventBadge
                                            key={`ticketed-${event.id}`}
                                            event={event}
                                            tone="blue"
                                          />
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-xs text-zinc-500">
                                        No ticket history yet.
                                      </p>
                                    )}
                                  </div>
                                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                                      Attended
                                    </p>
                                    {userDetails.attendedEvents.length > 0 ? (
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {userDetails.attendedEvents.map((event) => (
                                          <EventBadge
                                            key={`attended-${event.id}`}
                                            event={event}
                                            tone="emerald"
                                          />
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-xs text-zinc-500">
                                        No attendance recorded yet.
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </button>
                    </td>
                    {!isExpanded && (
                      <>
                        <td className="px-3 py-3">
                          <AffiliationPill affiliation={user.affiliation} />
                        </td>
                        <td className="px-3 py-3 text-xs text-zinc-400 whitespace-nowrap">
                          {user.lastLoginAt ? formatDate(user.lastLoginAt) : "Unknown"}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${currentEventStatus.classes}`}
                            >
                              {currentEventStatus.label}
                            </span>
                            {!user.currentEventStatus.onNotifyList && !user.currentEventStatus.ticketed && !user.currentEventStatus.attended && (
                              <button
                                onClick={(e) => { e.stopPropagation(); sendAnnouncementToOne(user.email); }}
                                disabled={individualSending === user.email || sendState?.active}
                                title="Send announcement email"
                                className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                              >
                                {individualSending === user.email ? (
                                  <div className="w-3.5 h-3.5 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
                                ) : (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                                  </svg>
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col items-center gap-1">
                            <span className="font-semibold text-white">
                              {user.counts.totalHistoryEvents}
                            </span>
                            <span className="text-[11px] text-zinc-500">
                              {user.counts.notified} N / {user.counts.ticketed} T /{" "}
                              {user.counts.attended} A
                            </span>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredUsers.length > 0 && (
          <div className="px-4 py-3 border-t border-zinc-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-zinc-500">
              Showing {pageStart + 1}-{pageEnd} of {filteredUsers.length} users
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
                  onClick={() =>
                    setCurrentPage((page) => Math.min(page + 1, totalPages))
                  }
                  disabled={clampedPage === totalPages}
                  className="px-2.5 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-700 transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}

        {filteredUsers.length === 0 && (
          <div className="px-4 py-8 text-center text-zinc-500 text-sm">
            No users match your filters
          </div>
        )}
      </div>
    </div>
  );
}
