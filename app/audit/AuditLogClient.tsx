"use client";

import { Fragment, useState, useEffect, useCallback, useRef } from "react";

type AuditLogEntry = {
  kind: "log";
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

type AuditLogGroup = {
  kind: "group";
  id: string;
  created_at: string;
  action: string;
  actor: string;
  source: string;
  event_id: string | null;
  event_name: string | null;
  target_email: null;
  metadata: Record<string, unknown> | null;
  entries: AuditLogEntry[];
  group_count: number;
  failures?: AuditLogEntry[];
};

type AuditLogItem = AuditLogEntry | AuditLogGroup;

const ACTION_LABELS: Record<string, string> = {
  "notify.signup": "Signed up for Notify",
  "ticket.get": "Got Ticket",
  "ticket.ineligible": "Blocked Ineligible Claim",
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
  "waitlist.join": "Joined Waitlist",
  "waitlist.leave": "Left Waitlist",
  "waitlist.pull": "Pulled From Waitlist",
  "waitlist.issue_standby": "Issued Standby Tickets",
  "referral.toggle": "Toggled Referrals",
};

const ACTION_OPTIONS = [
  { group: "Tickets", actions: ["ticket.get", "ticket.ineligible", "ticket.cancel", "ticket.create", "ticket.delete", "ticket.update_name", "ticket.update_type", "ticket.unscan"] },
  { group: "Email", actions: ["email.send", "email.send_mass"] },
  { group: "Events", actions: ["event.create", "event.edit", "event.toggle_live", "event.toggle_standby", "event.delete"] },
  { group: "Users", actions: ["user.add_role", "user.remove_role"] },
  { group: "Suggestions", actions: ["suggestion.approve", "suggestion.reject", "suggestion.edit", "suggestion.mark_duplicate", "suggestion.merge"] },
  { group: "Waitlist", actions: ["waitlist.join", "waitlist.leave", "waitlist.pull", "waitlist.issue_standby"] },
  { group: "Referrals", actions: ["referral.toggle"] },
  { group: "Notify", actions: ["notify.signup"] },
];

const ACTION_FILTER_OPTIONS = ACTION_OPTIONS.flatMap((group) =>
  group.actions.map((action) => ({
    value: action,
    label: ACTION_LABELS[action] || action,
    group: group.group,
  })),
);
const ACTION_VALUES = ACTION_FILTER_OPTIONS.map((option) => option.value);
const DEFAULT_EXCLUDED_ACTIONS = new Set([
  "notify.signup",
  "ticket.get",
  "waitlist.join",
]);
const DEFAULT_ACTION_VALUES = ACTION_VALUES.filter(
  (action) => !DEFAULT_EXCLUDED_ACTIONS.has(action),
);

const SOURCE_FILTER_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "web", label: "Web" },
] as const;
const SOURCE_VALUES = SOURCE_FILTER_OPTIONS.map((option) => option.value);

type FilterDropdownKey = "action" | "source";
type FilterOption = {
  value: string;
  label: string;
  group?: string;
};

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

function isAuditLogGroup(log: AuditLogItem): log is AuditLogGroup {
  return log.kind === "group";
}

function getMetadataNumber(
  metadata: Record<string, unknown> | null,
  key: string,
): number {
  const value = metadata?.[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function formatMetadataKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }

  if (Array.isArray(value)) {
    return value.map((item) => formatMetadataValue(item)).join(", ");
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return String(value);
}

const METADATA_RENDERED_SEPARATELY = new Set([
  "batchId",
  "initial",
  "changes",
  "changedFields",
]);

function getMetadataEntries(
  metadata: Record<string, unknown> | null,
): Array<[string, unknown]> {
  if (!metadata) {
    return [];
  }

  return Object.entries(metadata).filter(([key, value]) => {
    if (METADATA_RENDERED_SEPARATELY.has(key)) return false;
    return value !== null && value !== undefined && value !== "";
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isFromToChange(
  value: unknown,
): value is { from: unknown; to: unknown } {
  return isPlainObject(value) && "from" in value && "to" in value;
}

const ISO_DATE_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (typeof value === "string" && ISO_DATE_REGEX.test(value)) {
    return new Date(value).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
  return formatMetadataValue(value);
}

function getMassEmailLabel(metadata: Record<string, unknown> | null): string {
  const type = metadata?.type;
  const kind = metadata?.kind;
  const variant = metadata?.variant;

  if (type === "bulkSend") {
    if (kind === "announcement") return "Announcements";
    if (kind === "ticketsAvailableNow") return "Tickets available now";
    if (kind === "ticketsAvailableIn") return "Tickets available in";
    if (kind === "claimTicket") return "Claim ticket";
    return "Bulk send";
  }

  if (type === "notifySend") {
    if (variant === "claim") return "Claim ticket notify";
    if (variant === "in") return "Tickets available in notify";
    if (variant === "now") return "Tickets available now notify";
    return "Notify send";
  }

  if (type === "dayOfReminders") return "Day-of reminders";
  if (type === "earlyReminders") return "Early reminders";

  return "Mass email";
}

function getDetailsSummary(log: AuditLogItem): string {
  if (log.action === "event.edit") {
    const changed = log.metadata?.changedFields;
    if (Array.isArray(changed) && changed.length > 0) {
      const fields = changed
        .map((field) => formatMetadataKey(String(field)))
        .slice(0, 3)
        .join(", ");
      const suffix = changed.length > 3 ? ` +${changed.length - 3} more` : "";
      const label = changed.length === 1 ? "field" : "fields";
      return `${changed.length} ${label} updated: ${fields}${suffix}`;
    }
    if (Array.isArray(changed) && changed.length === 0) {
      return "No changes";
    }
  }

  if (log.action === "event.create" && isPlainObject(log.metadata?.initial)) {
    const initial = log.metadata!.initial as Record<string, unknown>;
    const parts: string[] = [];
    if (initial.venue) parts.push(`Venue: ${formatMetadataValue(initial.venue)}`);
    if (typeof initial.capacity === "number")
      parts.push(`Capacity: ${initial.capacity.toLocaleString()}`);
    if (initial.startTime)
      parts.push(`Start: ${formatChangeValue(initial.startTime)}`);
    if (parts.length > 0) return parts.slice(0, 3).join(" • ");
    return "Initial details captured";
  }

  if (log.action === "email.send_mass") {
    const label = getMassEmailLabel(log.metadata);
    const sent = getMetadataNumber(log.metadata, "sent");
    const failed = getMetadataNumber(log.metadata, "failed");
    const skipped = getMetadataNumber(log.metadata, "skipped");
    const chunkCount = isAuditLogGroup(log) ? log.group_count : 1;
    const segments = [`${label}`, `${sent.toLocaleString()} sent`];

    if (failed > 0) {
      segments.push(`${failed.toLocaleString()} failed`);
    }
    if (skipped > 0) {
      segments.push(`${skipped.toLocaleString()} skipped`);
    }
    if (isAuditLogGroup(log)) {
      segments.push(`${chunkCount.toLocaleString()} chunks`);
    }

    return segments.join(" • ");
  }

  const metadataEntries = getMetadataEntries(log.metadata);
  if (metadataEntries.length === 0) {
    return "No additional details";
  }

  return metadataEntries
    .slice(0, 2)
    .map(([key, value]) => `${formatMetadataKey(key)}: ${formatMetadataValue(value)}`)
    .join(" • ");
}

const PAGE_SIZE = 50;

function ChangesGrid({
  changes,
}: {
  changes: Record<string, unknown>;
}) {
  const entries = Object.entries(changes).filter(([, value]) =>
    isFromToChange(value),
  ) as Array<[string, { from: unknown; to: unknown }]>;

  if (entries.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No field-level changes recorded.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map(([field, change]) => (
        <div
          key={field}
          className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            {formatMetadataKey(field)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-rose-200 break-words">
              {formatChangeValue(change.from)}
            </span>
            <span className="text-zinc-500">→</span>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-200 break-words">
              {formatChangeValue(change.to)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SnapshotGrid({
  snapshot,
}: {
  snapshot: Record<string, unknown>;
}) {
  const entries = Object.entries(snapshot).filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );

  if (entries.length === 0) {
    return <p className="text-sm text-zinc-500">No starting values captured.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            {formatMetadataKey(key)}
          </p>
          <p className="mt-1 text-sm text-zinc-200 break-words">
            {formatChangeValue(value)}
          </p>
        </div>
      ))}
    </div>
  );
}

function FailedRecipients({ failures }: { failures: AuditLogEntry[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? failures : failures.slice(0, 25);

  const errorOf = (entry: AuditLogEntry): string => {
    const err = entry.metadata?.error;
    if (typeof err === "string" && err.trim().length > 0) return err;
    if (isPlainObject(err)) {
      const message = (err as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim().length > 0) return message;
      try {
        return JSON.stringify(err);
      } catch {
        return "Unknown error";
      }
    }
    return "Unknown error";
  };

  const csv = () => {
    const header = "email,error\n";
    const body = failures
      .map((f) => {
        const email = f.target_email ?? "";
        const error = errorOf(f).replace(/"/g, '""');
        return `"${email}","${error}"`;
      })
      .join("\n");
    return header + body;
  };

  const downloadCsv = () => {
    const blob = new Blob([csv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `failed-recipients-${failures.length}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-rose-200">
            Failed recipients ({failures.length.toLocaleString()})
          </p>
          <p className="text-xs text-rose-300/70">
            Per-recipient send errors recorded during this run.
          </p>
        </div>
        <button
          type="button"
          onClick={downloadCsv}
          className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition-colors hover:bg-rose-500/20"
        >
          Download CSV
        </button>
      </div>
      <div className="overflow-hidden rounded-lg border border-rose-500/20">
        <table className="w-full text-sm">
          <thead className="bg-rose-500/10">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-rose-200/80">
                Email
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-rose-200/80">
                Error
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((f) => (
              <tr key={f.id} className="border-t border-rose-500/10">
                <td className="px-3 py-2 align-top text-zinc-200 break-all">
                  {f.target_email ?? "(unknown)"}
                </td>
                <td className="px-3 py-2 align-top text-zinc-400 break-words">
                  {errorOf(f)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {failures.length > visible.length ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 text-xs font-medium text-rose-300 underline-offset-2 hover:underline"
        >
          Show all {failures.length.toLocaleString()} failures
        </button>
      ) : showAll && failures.length > 25 ? (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="mt-3 text-xs font-medium text-rose-300 underline-offset-2 hover:underline"
        >
          Show fewer
        </button>
      ) : null}
    </div>
  );
}

function MetadataDetails({
  metadata,
}: {
  metadata: Record<string, unknown> | null;
}) {
  const metadataEntries = getMetadataEntries(metadata);
  const initial = metadata?.initial;
  const changes = metadata?.changes;
  const hasInitial = isPlainObject(initial);
  const hasChanges = isPlainObject(changes) && Object.keys(changes).length > 0;

  if (
    metadataEntries.length === 0 &&
    !hasInitial &&
    !hasChanges
  ) {
    return <p className="text-sm text-zinc-500">No additional details.</p>;
  }

  return (
    <div className="space-y-4">
      {hasChanges ? (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Changes
          </p>
          <ChangesGrid changes={changes as Record<string, unknown>} />
        </div>
      ) : null}

      {hasInitial ? (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Starting values
          </p>
          <SnapshotGrid snapshot={initial as Record<string, unknown>} />
        </div>
      ) : null}

      {metadataEntries.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {metadataEntries.map(([key, value]) => (
            <div
              key={key}
              className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                {formatMetadataKey(key)}
              </p>
              <p className="mt-1 text-sm text-zinc-200 break-words">
                {formatMetadataValue(value)}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function toggleSelection<T extends string>(
  selected: readonly T[],
  value: T,
  orderedOptions: readonly T[],
): T[] {
  const next = new Set(selected);

  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }

  return orderedOptions.filter((option) => next.has(option));
}

function selectionsMatch<T extends string>(
  selected: readonly T[],
  expected: readonly T[],
): boolean {
  return (
    selected.length === expected.length &&
    selected.every((value, index) => value === expected[index])
  );
}

function summarizeSelection(
  options: readonly FilterOption[],
  selectedValues: readonly string[],
  allLabel: string,
  noneLabel: string,
): string {
  if (selectedValues.length === options.length) return allLabel;
  if (selectedValues.length === 0) return noneLabel;

  const selectedLabels = options
    .filter((option) => selectedValues.includes(option.value))
    .map((option) => option.label);

  if (selectedLabels.length <= 2) {
    return selectedLabels.join(", ");
  }

  return `${selectedLabels.length} selected`;
}

function FilterDropdown({
  title,
  summary,
  isOpen,
  options,
  selectedValues,
  onToggle,
  onToggleValue,
  onSelectAll,
  onClear,
}: {
  title: string;
  summary: string;
  isOpen: boolean;
  options: readonly FilterOption[];
  selectedValues: readonly string[];
  onToggle: () => void;
  onToggleValue: (value: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex w-full items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800/80"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <svg
          className="h-4 w-4 text-zinc-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 4a1 1 0 011-1h16a1 1 0 01.8 1.6L14 13.333V19a1 1 0 01-1.447.894l-2-1A1 1 0 0110 18v-4.667L3.2 4.6A1 1 0 013 4z"
          />
        </svg>
        <span>{title}</span>
        <span className="max-w-48 truncate text-zinc-400">{summary}</span>
        <svg
          className={`ml-auto h-4 w-4 text-zinc-500 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-20 mt-2 w-full min-w-[20rem] rounded-2xl border border-zinc-800 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur">
          <div className="mb-3 px-1">
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="text-xs text-zinc-500">
              Choose one or more options to include
            </p>
          </div>
          <div className="mb-3 flex items-center gap-2 px-1">
            <button
              type="button"
              onClick={onSelectAll}
              className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={onClear}
              className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
            >
              Clear
            </button>
          </div>
          <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
            {options.map((option, index) => {
              const checked = selectedValues.includes(option.value);
              const previousGroup = index > 0 ? options[index - 1]?.group : undefined;
              const showGroupLabel = option.group && option.group !== previousGroup;

              return (
                <div key={option.value}>
                  {showGroupLabel ? (
                    <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      {option.group}
                    </p>
                  ) : null}
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors ${
                      checked
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                        : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleValue(option.value)}
                      className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-emerald-500 focus:ring-emerald-500/40"
                    />
                    <span>{option.label}</span>
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AuditLogClient() {
  const filterDropdownRef = useRef<HTMLDivElement | null>(null);
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  // Filters
  const [selectedActions, setSelectedActions] = useState(DEFAULT_ACTION_VALUES);
  const [actorFilter, setActorFilter] = useState("");
  const [targetFilter, setTargetFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>([
    ...SOURCE_VALUES,
  ]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [openFilterDropdown, setOpenFilterDropdown] =
    useState<FilterDropdownKey | null>(null);

  const fetchLogs = useCallback(async () => {
    if (selectedActions.length === 0 || selectedSources.length === 0) {
      setLogs([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedActions.length !== ACTION_VALUES.length) {
        selectedActions.forEach((action) => params.append("action", action));
      }
      if (actorFilter) params.set("actor", actorFilter);
      if (targetFilter) params.set("targetEmail", targetFilter);
      if (eventFilter) params.set("eventName", eventFilter);
      if (selectedSources.length !== SOURCE_VALUES.length) {
        selectedSources.forEach((source) => params.append("source", source));
      }
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(page * PAGE_SIZE));

      const res = await fetch(`/api/audit?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setLogs(data.logs);
      setTotal(data.total);
      setExpandedItems([]);
    } catch (err) {
      console.error("Failed to fetch audit logs:", err);
    } finally {
      setLoading(false);
    }
  }, [
    actorFilter,
    endDate,
    eventFilter,
    page,
    selectedActions,
    selectedSources,
    startDate,
    targetFilter,
  ]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  function handleTextFilter(setter: (v: string) => void, value: string) {
    setPage(0);
    setter(value);
  }

  function toggleExpandedItem(id: string) {
    setExpandedItems((current) =>
      current.includes(id)
        ? current.filter((entryId) => entryId !== id)
        : [...current, id],
    );
  }

  function resetFilters() {
    setSelectedActions(DEFAULT_ACTION_VALUES);
    setActorFilter("");
    setTargetFilter("");
    setEventFilter("");
    setSelectedSources([...SOURCE_VALUES]);
    setStartDate("");
    setEndDate("");
    setPage(0);
  }

  const actionFilterSummary = selectionsMatch(
    selectedActions,
    DEFAULT_ACTION_VALUES,
  )
    ? "All except Signed up for Notify, Got Ticket, and Joined Waitlist"
    : summarizeSelection(
        ACTION_FILTER_OPTIONS,
        selectedActions,
        "All actions",
        "No actions",
      );
  const sourceFilterSummary = summarizeSelection(
    SOURCE_FILTER_OPTIONS,
    selectedSources,
    "All sources",
    "No sources",
  );

  const hasCustomFilters =
    !selectionsMatch(selectedActions, DEFAULT_ACTION_VALUES) ||
    actorFilter ||
    targetFilter ||
    eventFilter ||
    !selectionsMatch(selectedSources, SOURCE_VALUES) ||
    startDate ||
    endDate;
  const isFiltered =
    selectedActions.length !== ACTION_VALUES.length ||
    actorFilter ||
    targetFilter ||
    eventFilter ||
    selectedSources.length !== SOURCE_VALUES.length ||
    startDate ||
    endDate;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const showingFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, total);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!filterDropdownRef.current?.contains(event.target as Node)) {
        setOpenFilterDropdown(null);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenFilterDropdown(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

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
      <div
        ref={filterDropdownRef}
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-6"
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-300">Filters</h3>
            <p className="text-xs text-zinc-500">
              Use dropdowns with checkboxes to narrow the audit log
            </p>
          </div>
          {hasCustomFilters ? (
            <button
              onClick={resetFilters}
              className="text-xs text-zinc-400 hover:text-white transition-colors"
            >
              Reset filters
            </button>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <FilterDropdown
              title="Action"
              summary={actionFilterSummary}
              isOpen={openFilterDropdown === "action"}
              options={ACTION_FILTER_OPTIONS}
              selectedValues={selectedActions}
              onToggle={() =>
                setOpenFilterDropdown((current) =>
                  current === "action" ? null : "action",
                )
              }
              onToggleValue={(value) => {
                setSelectedActions((current) =>
                  toggleSelection(current, value, ACTION_VALUES),
                );
                setPage(0);
              }}
              onSelectAll={() => {
                setSelectedActions(ACTION_VALUES);
                setPage(0);
              }}
              onClear={() => {
                setSelectedActions([]);
                setPage(0);
              }}
            />
            <FilterDropdown
              title="Source"
              summary={sourceFilterSummary}
              isOpen={openFilterDropdown === "source"}
              options={SOURCE_FILTER_OPTIONS}
              selectedValues={selectedSources}
              onToggle={() =>
                setOpenFilterDropdown((current) =>
                  current === "source" ? null : "source",
                )
              }
              onToggleValue={(value) => {
                setSelectedSources((current) =>
                  toggleSelection(current, value, SOURCE_VALUES),
                );
                setPage(0);
              }}
              onSelectAll={() => {
                setSelectedSources([...SOURCE_VALUES]);
                setPage(0);
              }}
              onClear={() => {
                setSelectedSources([]);
                setPage(0);
              }}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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

            {/* Start date */}
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
                From
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => handleTextFilter(setStartDate, e.target.value)}
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
                onChange={(e) => handleTextFilter(setEndDate, e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/50 [color-scheme:dark]"
              />
            </div>
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
                    {isFiltered ? "No entries match your filters." : "No audit log entries yet."}
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isExpanded = expandedItems.includes(log.id);
                  const summary = getDetailsSummary(log);
                  const sent = getMetadataNumber(log.metadata, "sent");
                  const failed = getMetadataNumber(log.metadata, "failed");
                  const skipped = getMetadataNumber(log.metadata, "skipped");
                  const totalRecipients = getMetadataNumber(log.metadata, "total");

                  return (
                    <Fragment key={log.id}>
                      <tr
                        className="border-t border-zinc-800/50 hover:bg-zinc-800/20 transition-colors"
                      >
                        <td
                          className="px-4 py-3 text-sm text-zinc-400 whitespace-nowrap"
                          title={formatTimestamp(log.created_at)}
                        >
                          {timeAgo(log.created_at)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="space-y-1">
                            <span className={`inline-block border rounded-full px-2.5 py-0.5 text-xs font-medium ${getActionColor(log.action)}`}>
                              {ACTION_LABELS[log.action] || log.action}
                            </span>
                            {isAuditLogGroup(log) ? (
                              <p className="text-[11px] text-zinc-500">
                                Grouped from {log.group_count.toLocaleString()} chunks
                              </p>
                            ) : null}
                          </div>
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
                        <td className="px-4 py-3 max-w-[260px]">
                          <button
                            type="button"
                            onClick={() => toggleExpandedItem(log.id)}
                            className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900/70"
                            title={summary}
                          >
                            <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">
                              {summary}
                            </span>
                            <svg
                              className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 9l-7 7-7-7"
                              />
                            </svg>
                          </button>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className="border-t border-zinc-800/50 bg-zinc-950/40">
                          <td colSpan={7} className="px-4 py-4">
                            {isAuditLogGroup(log) ? (
                              <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                                      Sent
                                    </p>
                                    <p className="mt-1 text-lg font-semibold text-white">
                                      {sent.toLocaleString()}
                                    </p>
                                  </div>
                                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                                      Failed
                                    </p>
                                    <p className="mt-1 text-lg font-semibold text-white">
                                      {failed.toLocaleString()}
                                    </p>
                                  </div>
                                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                                      Skipped
                                    </p>
                                    <p className="mt-1 text-lg font-semibold text-white">
                                      {skipped.toLocaleString()}
                                    </p>
                                  </div>
                                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                                      Recipients
                                    </p>
                                    <p className="mt-1 text-lg font-semibold text-white">
                                      {totalRecipients.toLocaleString()}
                                    </p>
                                  </div>
                                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                                      Chunks
                                    </p>
                                    <p className="mt-1 text-lg font-semibold text-white">
                                      {log.group_count.toLocaleString()}
                                    </p>
                                  </div>
                                </div>

                                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                                  <div className="mb-3">
                                    <p className="text-sm font-semibold text-white">
                                      {getMassEmailLabel(log.metadata)}
                                    </p>
                                    <p className="text-xs text-zinc-500">
                                      Grouped mass-email run
                                    </p>
                                  </div>
                                  <MetadataDetails metadata={log.metadata} />
                                </div>

                                {log.failures && log.failures.length > 0 ? (
                                  <FailedRecipients failures={log.failures} />
                                ) : null}

                                <div className="space-y-3">
                                  {log.entries.map((entry, index) => (
                                    <div
                                      key={entry.id}
                                      className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"
                                    >
                                      <div className="mb-3 flex items-start justify-between gap-3">
                                        <div>
                                          <p className="text-sm font-medium text-white">
                                            Chunk {index + 1} of {log.entries.length}
                                          </p>
                                          <p className="text-xs text-zinc-500">
                                            {formatTimestamp(entry.created_at)}
                                          </p>
                                        </div>
                                        <p className="text-xs text-zinc-500">
                                          {getDetailsSummary(entry)}
                                        </p>
                                      </div>
                                      <MetadataDetails metadata={entry.metadata} />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                                <div className="mb-3 flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold text-white">
                                      {ACTION_LABELS[log.action] || log.action}
                                    </p>
                                    <p className="text-xs text-zinc-500">
                                      {formatTimestamp(log.created_at)}
                                    </p>
                                  </div>
                                  <span className={`inline-block border rounded-full px-2 py-0.5 text-xs font-medium ${getSourceColor(log.source)}`}>
                                    {log.source === "admin" ? "Admin" : "Web"}
                                  </span>
                                </div>
                                <MetadataDetails metadata={log.metadata} />
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
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
