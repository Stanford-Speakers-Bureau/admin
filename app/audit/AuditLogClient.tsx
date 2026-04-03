"use client";

import { useState, useEffect, useCallback, useRef } from "react";

type AuditLog = {
  id: string;
  created_at: string;
  action: string;
  actor: string;
  source: string;
  event_id: string | null;
  event_name: string | null;
  target_email: string | null;
  metadata: Record<string, unknown> | null;
};

const ACTION_LABELS: Record<string, string> = {
  "notify.signup": "Signed up for Notify",
  "ticket.get": "Got Ticket",
  "ticket.cancel": "Canceled Ticket",
  "ticket.create": "Created Ticket",
  "ticket.delete": "Deleted Ticket",
  "ticket.update_name": "Updated Name",
  "ticket.update_type": "Updated Type",
  "ticket.unscan": "Unscanned Ticket",
  "email.send": "Sent Email",
  "email.send_mass": "Sent Mass Email",
  "event.create": "Created Event",
  "event.edit": "Edited Event",
  "event.toggle_live": "Toggled Live",
  "event.toggle_standby": "Toggled Standby",
  "event.delete": "Deleted Event",
  "user.add_role": "Added Role",
  "user.remove_role": "Removed Role",
  "suggestion.approve": "Approved Suggestion",
  "suggestion.reject": "Rejected Suggestion",
  "suggestion.edit": "Edited Suggestion",
  "suggestion.mark_duplicate": "Marked Duplicate",
  "suggestion.merge": "Merged Suggestions",
  "waitlist.issue_standby": "Issued Standby Tickets",
  "referral.toggle": "Toggled Referrals",
};

const ACTION_OPTIONS = [
  { group: "Tickets", actions: ["ticket.get", "ticket.cancel", "ticket.create", "ticket.delete", "ticket.update_name", "ticket.update_type", "ticket.unscan"] },
  { group: "Email", actions: ["email.send", "email.send_mass"] },
  { group: "Events", actions: ["event.create", "event.edit", "event.toggle_live", "event.toggle_standby", "event.delete"] },
  { group: "Users", actions: ["user.add_role", "user.remove_role"] },
  { group: "Suggestions", actions: ["suggestion.approve", "suggestion.reject", "suggestion.edit", "suggestion.mark_duplicate", "suggestion.merge"] },
  { group: "Waitlist", actions: ["waitlist.issue_standby"] },
  { group: "Referrals", actions: ["referral.toggle"] },
  { group: "Notify", actions: ["notify.signup"] },
];

function getActionColor(action: string) {
  if (action.startsWith("ticket.")) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (action.startsWith("email.")) return "bg-blue-500/15 text-blue-400 border-blue-500/30";
  if (action.startsWith("event.")) return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  if (action.startsWith("user.")) return "bg-pink-500/15 text-pink-400 border-pink-500/30";
  if (action.startsWith("suggestion.")) return "bg-orange-500/15 text-orange-400 border-orange-500/30";
  if (action.startsWith("waitlist.")) return "bg-cyan-500/15 text-cyan-400 border-cyan-500/30";
  if (action.startsWith("referral.")) return "bg-indigo-500/15 text-indigo-400 border-indigo-500/30";
  if (action.startsWith("notify.")) return "bg-purple-500/15 text-purple-400 border-purple-500/30";
  return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
}

function getSourceColor(source: string) {
  return source === "admin"
    ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
    : "bg-sky-500/15 text-sky-400 border-sky-500/30";
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function renderMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "ticketId") continue;
    if (value === null || value === undefined) continue;
    parts.push(`${key}: ${value}`);
  }
  return parts.join(", ");
}

const PAGE_SIZE = 50;

export default function AuditLogClient() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  // Filters
  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [targetFilter, setTargetFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Debounce refs
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (actionFilter) params.set("action", actionFilter);
      if (actorFilter) params.set("actor", actorFilter);
      if (targetFilter) params.set("targetEmail", targetFilter);
      if (eventFilter) params.set("eventName", eventFilter);
      if (sourceFilter) params.set("source", sourceFilter);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(page * PAGE_SIZE));

      const res = await fetch(`/api/audit?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setLogs(data.logs);
      setTotal(data.total);
    } catch (err) {
      console.error("Failed to fetch audit logs:", err);
    } finally {
      setLoading(false);
    }
  }, [actionFilter, actorFilter, targetFilter, eventFilter, sourceFilter, startDate, endDate, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  function handleTextFilter(setter: (v: string) => void, value: string) {
    clearTimeout(debounceRef.current);
    setter(value);
    debounceRef.current = setTimeout(() => {
      setPage(0);
    }, 300);
  }

  function handleSelectFilter(setter: (v: string) => void, value: string) {
    setter(value);
    setPage(0);
  }

  function clearFilters() {
    setActionFilter("");
    setActorFilter("");
    setTargetFilter("");
    setEventFilter("");
    setSourceFilter("");
    setStartDate("");
    setEndDate("");
    setPage(0);
  }

  const hasFilters = actionFilter || actorFilter || targetFilter || eventFilter || sourceFilter || startDate || endDate;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const showingFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-1">
          Audit Log
        </h1>
        <p className="text-zinc-400 text-sm">
          Track all admin and user actions across the platform.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Action */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
              Action
            </label>
            <select
              value={actionFilter}
              onChange={(e) => handleSelectFilter(setActionFilter, e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/50"
            >
              <option value="">All actions</option>
              {ACTION_OPTIONS.map((group) => (
                <optgroup key={group.group} label={group.group}>
                  {group.actions.map((a) => (
                    <option key={a} value={a}>
                      {ACTION_LABELS[a] || a}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Actor */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
              Actor
            </label>
            <input
              type="text"
              value={actorFilter}
              onChange={(e) => handleTextFilter(setActorFilter, e.target.value)}
              placeholder="Who did it..."
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/50 placeholder:text-zinc-600"
            />
          </div>

          {/* Target */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
              Target
            </label>
            <input
              type="text"
              value={targetFilter}
              onChange={(e) => handleTextFilter(setTargetFilter, e.target.value)}
              placeholder="Done to whom..."
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/50 placeholder:text-zinc-600"
            />
          </div>

          {/* Event */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
              Event
            </label>
            <input
              type="text"
              value={eventFilter}
              onChange={(e) => handleTextFilter(setEventFilter, e.target.value)}
              placeholder="Which event..."
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/50 placeholder:text-zinc-600"
            />
          </div>

          {/* Source */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
              Source
            </label>
            <select
              value={sourceFilter}
              onChange={(e) => handleSelectFilter(setSourceFilter, e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/50"
            >
              <option value="">All sources</option>
              <option value="admin">Admin</option>
              <option value="web">Web</option>
            </select>
          </div>

          {/* Start date */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
              From
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => handleSelectFilter(setStartDate, e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/50 [color-scheme:dark]"
            />
          </div>

          {/* End date */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
              To
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => handleSelectFilter(setEndDate, e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/50 [color-scheme:dark]"
            />
          </div>

          {/* Clear */}
          <div className="flex items-end">
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="w-full bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-lg px-3 py-2 text-sm transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results count + pagination info */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-zinc-500 text-sm">
          {total === 0 ? "No entries found" : `Showing ${showingFrom}\u2013${showingTo} of ${total}`}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg text-sm hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="text-zinc-500 text-sm">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg text-sm hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-800/50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Time</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Action</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Actor</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Event</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Target</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Source</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-t border-zinc-800/50">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-zinc-800 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-zinc-500">
                    {hasFilters ? "No entries match your filters." : "No audit log entries yet."}
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="border-t border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
                    <td className="px-4 py-3 text-sm text-zinc-400 whitespace-nowrap" title={formatTimestamp(log.created_at)}>
                      {timeAgo(log.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block border rounded-full px-2.5 py-0.5 text-xs font-medium ${getActionColor(log.action)}`}>
                        {ACTION_LABELS[log.action] || log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-300 max-w-[200px] truncate" title={log.actor}>
                      {log.actor}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-400 max-w-[180px] truncate" title={log.event_name ?? undefined}>
                      {log.event_name || "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-400 max-w-[200px] truncate" title={log.target_email ?? undefined}>
                      {log.target_email || "\u2014"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block border rounded-full px-2 py-0.5 text-xs font-medium ${getSourceColor(log.source)}`}>
                        {log.source === "admin" ? "Admin" : "Web"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-500 max-w-[250px] truncate" title={renderMetadata(log.metadata)}>
                      {renderMetadata(log.metadata) || "\u2014"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom pagination */}
      {totalPages > 1 && (
        <div className="flex justify-end mt-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg text-sm hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="text-zinc-500 text-sm">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg text-sm hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
