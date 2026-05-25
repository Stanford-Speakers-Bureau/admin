"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import BulkSendProgress from "@/app/components/BulkSendProgress";
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from "@/app/components/ConfirmationDialog";
import { useEventContext } from "@/app/EventContext";
import { REMINDER_EMAIL_BATCH_SIZE } from "@/app/lib/constants";
import {
  BulkSendProgressState,
  runChunkedSend,
} from "@/app/lib/bulkSend";
import { formatDate } from "@/app/lib/formatting";
import { isValidEmail } from "@/app/lib/validation";

export type Ticket = {
  id: string;
  email: string;
  name: string | null;
  type: string | null;
  created_at: string;
  scanned: boolean;
  scan_time: string | null;
  referral: string | null;
  has_fee_waiver: boolean;
  event_id: string;
  events: {
    id: string;
    name: string | null;
    route: string | null;
    start_time_date: string | null;
  } | null;
};

type TicketRow = { name: string; email: string };
type EmailLookupResult = { type: string; name: string | null } | null;

type ReminderRecipient = Pick<Ticket, "id" | "email">;

type TicketAffiliationKey =
  | "student"
  | "faculty"
  | "affiliate"
  | "staff"
  | "member"
  | "unknown";

type AffiliationCounts = Record<TicketAffiliationKey, number>;

type TicketManagementClientProps = {
  initialTickets: Ticket[];
  initialTotal: number;
  initialScannedCount: number;
  initialUnscannedCount: number;
  initialFeeWaiverCount: number;
  initialFilteredCount: number;
  initialStandardCount: number;
  initialVipCount: number;
  initialExternalCount: number;
  initialStandbyCount: number;
  initialAffiliationCounts: AffiliationCounts;
};

const AFFILIATION_FILTER_ORDER: TicketAffiliationKey[] = [
  "student",
  "faculty",
  "affiliate",
  "staff",
  "member",
  "unknown",
];

function createEmptyAffiliationCounts(): AffiliationCounts {
  return {
    student: 0,
    faculty: 0,
    affiliate: 0,
    staff: 0,
    member: 0,
    unknown: 0,
  };
}

function formatAffiliationLabel(affiliation: TicketAffiliationKey): string {
  if (affiliation === "unknown") return "Unknown";
  return affiliation.charAt(0).toUpperCase() + affiliation.slice(1);
}

function parseSpreadsheetTicketRows(clipboardText: string): TicketRow[] {
  const rows = clipboardText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (rows.length === 0) {
    return [];
  }

  const parsedRows: TicketRow[] = [];

  for (const row of rows) {
    const columns = row.split("\t").map((column) => column.trim());
    const hasUnexpectedExtraColumns = columns.slice(2).some(Boolean);

    if (columns.length < 2 || hasUnexpectedExtraColumns) {
      return [];
    }

    parsedRows.push({
      name: columns[0] || "",
      email: columns[1] || "",
    });
  }

  return parsedRows;
}

const TICKET_TYPES = ["VIP", "STANDARD", "EXTERNAL", "STANDBY"] as const;

function typeBadgeClasses(type: string | null): string {
  switch (type) {
    case "VIP":
      return "bg-blue-500/15 text-blue-300 ring-blue-500/30";
    case "EXTERNAL":
      return "bg-green-500/15 text-green-300 ring-green-500/30";
    case "STANDBY":
      return "bg-amber-500/15 text-amber-300 ring-amber-500/30";
    default:
      return "bg-zinc-700/40 text-zinc-200 ring-zinc-600/40";
  }
}

function StatCard({
  label,
  value,
  valueClass = "text-white",
  active = false,
  onClick,
}: {
  label: string;
  value: number;
  valueClass?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const className = `rounded-xl border px-3.5 py-3 text-left transition-colors ${
    active
      ? "border-emerald-500/50 bg-emerald-500/10"
      : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
  } ${onClick ? "cursor-pointer" : "cursor-default"}`;

  const inner = (
    <>
      <div className="flex items-center gap-1.5">
        <span className="truncate text-xs font-medium tracking-wide text-zinc-400">
          {label}
        </span>
        {active && (
          <span className="ml-auto inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
        )}
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${valueClass}`}>
        {value.toLocaleString()}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {inner}
      </button>
    );
  }
  return <div className={className}>{inner}</div>;
}

const SelectChevron = () => (
  <svg
    viewBox="0 0 8 5"
    width="8"
    height="5"
    fill="none"
    className="pointer-events-none col-start-2 row-start-1 place-self-center text-current opacity-60"
  >
    <path d="M.5.5 4 4 7.5.5" stroke="currentColor" />
  </svg>
);

export default function TicketManagementClient({
  initialTickets,
  initialTotal,
  initialScannedCount,
  initialUnscannedCount,
  initialFeeWaiverCount,
  initialFilteredCount,
  initialStandardCount,
  initialVipCount,
  initialExternalCount,
  initialStandbyCount,
  initialAffiliationCounts,
}: TicketManagementClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { events, selectedEventId } = useEventContext();
  const { confirm: confirmAction, confirmationDialog } =
    useConfirmationDialog();
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets);
  const [total, setTotal] = useState(initialTotal);
  const [scannedCount, setScannedCount] = useState(initialScannedCount);
  const [unscannedCount, setUnscannedCount] = useState(initialUnscannedCount);
  const [feeWaiverCount, setFeeWaiverCount] = useState(initialFeeWaiverCount);
  const [filteredCount, setFilteredCount] = useState(initialFilteredCount);
  const [standardCount, setStandardCount] = useState(initialStandardCount);
  const [vipCount, setVipCount] = useState(initialVipCount);
  const [externalCount, setExternalCount] = useState(initialExternalCount);
  const [standbyCount, setStandbyCount] = useState(initialStandbyCount);
  const [affiliationCounts, setAffiliationCounts] = useState<AffiliationCounts>(
    initialAffiliationCounts,
  );
  const [search, setSearch] = useState("");
  const [ticketTypeFilter, setTicketTypeFilter] = useState<string>("");
  const [scannedFilter, setScannedFilter] = useState<string>("");
  const [feeWaiverFilter, setFeeWaiverFilter] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTicketRows, setNewTicketRows] = useState<TicketRow[]>([
    { name: "", email: "" },
  ]);
  const [newTicketEventId, setNewTicketEventId] = useState(selectedEventId);
  const [newTicketType, setNewTicketType] = useState("VIP");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState({ completed: 0, total: 0 });
  const [emailLookups, setEmailLookups] = useState<Record<number, EmailLookupResult>>({});
  const lookupTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const lookupAbortControllers = useRef<Record<number, AbortController>>({});
  // Tracks the in-flight main-list request so a newer fetch (e.g. after an
  // event switch) supersedes and discards the stale one — last call wins.
  const fetchAbortRef = useRef<AbortController | null>(null);
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const [resendingEmailId, setResendingEmailId] = useState<string | null>(null);
  const [updatingTicketId, setUpdatingTicketId] = useState<string | null>(null);
  const [isSendingReminders, setIsSendingReminders] = useState(false);
  const [sendingReminderId, setSendingReminderId] = useState<string | null>(
    null,
  );
  const [isSendingEarlyReminders, setIsSendingEarlyReminders] = useState(false);
  const [sendingEarlyReminderId, setSendingEarlyReminderId] = useState<
    string | null
  >(null);
  const [bulkReminderState, setBulkReminderState] =
    useState<BulkSendProgressState | null>(null);
  const [massEmailType, setMassEmailType] = useState<"early" | "day-of">(
    "early",
  );
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState("");
  const [deleteModalTicket, setDeleteModalTicket] = useState<Ticket | null>(null);
  const [isDeletingTicket, setIsDeletingTicket] = useState(false);
  const [shouldSendCancellationEmail, setShouldSendCancellationEmail] = useState(true);
  const rawAffiliationFilter = searchParams.get("affiliation");
  const affiliationFilter = AFFILIATION_FILTER_ORDER.includes(
    rawAffiliationFilter as TicketAffiliationKey,
  )
    ? (rawAffiliationFilter as TicketAffiliationKey)
    : "";

  const REMINDER_CHUNK_SIZE = REMINDER_EMAIL_BATCH_SIZE;
  const RECIPIENT_PAGE_SIZE = 500;

  function resetNewTicketForm() {
    setNewTicketRows([{ name: "", email: "" }]);
    setNewTicketEventId(selectedEventId);
    setNewTicketType("VIP");
    setEmailLookups({});
  }

  const debouncedEmailLookup = useCallback(
    (index: number, email: string, eventId: string) => {
      // Clear any pending timer for this row
      if (lookupTimers.current[index]) {
        clearTimeout(lookupTimers.current[index]);
      }
      // Abort any in-flight request for this row
      if (lookupAbortControllers.current[index]) {
        lookupAbortControllers.current[index].abort();
      }

      const trimmed = email.trim().toLowerCase();
      if (!trimmed || !isValidEmail(trimmed) || !eventId) {
        setEmailLookups((prev) => {
          const next = { ...prev };
          delete next[index];
          return next;
        });
        return;
      }

      lookupTimers.current[index] = setTimeout(async () => {
        const controller = new AbortController();
        lookupAbortControllers.current[index] = controller;
        try {
          const res = await fetch(
            `/api/tickets/lookup?email=${encodeURIComponent(trimmed)}&eventId=${encodeURIComponent(eventId)}`,
            { signal: controller.signal },
          );
          if (!res.ok) return;
          const data = await res.json();
          if (!controller.signal.aborted) {
            setEmailLookups((prev) => ({
              ...prev,
              [index]: data.ticket
                ? { type: data.ticket.type, name: data.ticket.name }
                : null,
            }));
          }
        } catch {
          // Aborted or network error — silently ignore
        }
      }, 400);
    },
    [],
  );

  function handleSpreadsheetPaste(
    index: number,
    event: React.ClipboardEvent<HTMLInputElement>,
  ) {
    const clipboardText = event.clipboardData.getData("text");

    if (!clipboardText.includes("\t")) {
      return;
    }

    const parsedRows = parseSpreadsheetTicketRows(clipboardText);

    event.preventDefault();

    if (parsedRows.length === 0) {
      setSuccess(null);
      setError("Paste exactly 2 columns from Google Sheets: name and email.");
      return;
    }

    setNewTicketRows((prev) => {
      const next = [...prev];
      const requiredLength = index + parsedRows.length;

      while (next.length < requiredLength) {
        next.push({ name: "", email: "" });
      }

      parsedRows.forEach((row, offset) => {
        next[index + offset] = row;
      });

      return next;
    });

    setError(null);
    setSuccess(
      `Loaded ${parsedRows.length} attendee row${parsedRows.length === 1 ? "" : "s"} from pasted data.`,
    );

    // Trigger lookups for all pasted rows
    parsedRows.forEach((row, offset) => {
      debouncedEmailLookup(index + offset, row.email, newTicketEventId);
    });
  }

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    setBulkReminderState(null);
  }, [selectedEventId]);

  useEffect(() => {
    setFeeWaiverFilter("");
  }, [selectedEventId]);

  useEffect(() => {
    setOffset(0);
  }, [selectedEventId, affiliationFilter]);

  function handleAffiliationFilterChange(nextAffiliation: TicketAffiliationKey | "") {
    const params = new URLSearchParams(searchParams.toString());

    if (nextAffiliation) {
      params.set("affiliation", nextAffiliation);
    } else {
      params.delete("affiliation");
    }

    setOffset(0);
    router.replace(params.size > 0 ? `${pathname}?${params.toString()}` : pathname);
  }

  async function fetchTickets() {
    // Supersede any in-flight request so a newer fetch (event switch, filter
    // change, manual refresh) always wins and stale responses are discarded.
    fetchAbortRef.current?.abort();

    // Don't fetch if no event is selected
    if (!selectedEventId) {
      fetchAbortRef.current = null;
      setTickets([]);
      setTotal(0);
      setScannedCount(0);
      setUnscannedCount(0);
      setFeeWaiverCount(0);
      setFilteredCount(0);
      setStandardCount(0);
      setVipCount(0);
      setExternalCount(0);
      setStandbyCount(0);
      setAffiliationCounts(createEmptyAffiliationCounts());
      return;
    }

    const controller = new AbortController();
    fetchAbortRef.current = controller;
    const { signal } = controller;

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      });

      if (selectedEventId) {
        params.append("eventId", selectedEventId);
      }

      if (search.trim()) {
        params.append("search", search.trim());
      }

      if (ticketTypeFilter) {
        params.append("type", ticketTypeFilter);
      }

      if (scannedFilter) {
        params.append("scanned", scannedFilter);
      }
      if (feeWaiverFilter) {
        params.append("feeWaiver", feeWaiverFilter);
      }
      if (affiliationFilter) {
        params.append("affiliation", affiliationFilter);
      }

      const response = await fetch(`/api/tickets?${params}`, { signal });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch tickets");
      }

      const data = await response.json();
      if (signal.aborted) return;
      setTickets(data.tickets || []);
      setTotal(data.total || 0);
      setScannedCount(data.scannedCount || 0);
      setUnscannedCount(data.unscannedCount || 0);
      setFeeWaiverCount(data.feeWaiverCount || 0);
      setFilteredCount(data.filteredCount || 0);
      setStandardCount(data.standardCount || 0);
      setVipCount(data.vipCount || 0);
      setExternalCount(data.externalCount || 0);
      setStandbyCount(data.standbyCount || 0);
      setAffiliationCounts(data.affiliationCounts || createEmptyAffiliationCounts());
    } catch (err) {
      if (
        signal.aborted ||
        (err as { name?: string } | null)?.name === "AbortError"
      ) {
        return;
      }
      console.error("Error fetching tickets:", err);
      setError(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      if (!signal.aborted) setIsLoading(false);
    }
  }

  const fetchTicketsForEffect = useEffectEvent(() => {
    void fetchTickets();
  });

  async function fetchAllReminderRecipients(
    eventId: string,
  ): Promise<ReminderRecipient[]> {
    const recipients: ReminderRecipient[] = [];

    for (
      let recipientOffset = 0;
      recipientOffset < total;
      recipientOffset += RECIPIENT_PAGE_SIZE
    ) {
      const params = new URLSearchParams({
        eventId,
        limit: Math.min(RECIPIENT_PAGE_SIZE, total - recipientOffset).toString(),
        offset: recipientOffset.toString(),
      });
      const response = await fetch(`/api/tickets?${params.toString()}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          errorData?.error || "Failed to load reminder recipients",
        );
      }

      const data = await response.json() as { tickets?: ReminderRecipient[] };
      const pageRecipients = data.tickets || [];
      recipients.push(
        ...pageRecipients.map((ticket) => ({
          id: ticket.id,
          email: ticket.email,
        })),
      );

      if (pageRecipients.length < RECIPIENT_PAGE_SIZE) {
        break;
      }
    }

    return recipients;
  }

  async function sendBulkReminderEmails(options: {
    action: "sendEarlyReminders" | "sendDayOfReminders";
    eventId: string;
    label: string;
    successLabel: string;
  }) {
    const recipients = await fetchAllReminderRecipients(options.eventId);

    if (recipients.length === 0) {
      setSuccess("No tickets found for this event.");
      return;
    }

    const finalState = await runChunkedSend({
      items: recipients,
      chunkSize: REMINDER_CHUNK_SIZE,
      label: options.label,
      onProgress: setBulkReminderState,
      sendChunk: async (chunk, context) => {
        const response = await fetch(`/api/tickets?eventId=${options.eventId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: options.action,
            auditBatchId: context.batchId,
            ticketIds: chunk.map((recipient) => recipient.id),
          }),
        });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(data?.error || "Failed to send reminder emails");
        }

        return data;
      },
    });

    const suppressedMsg = finalState.suppressed > 0
      ? `, ${finalState.suppressed} suppressed`
      : "";
    setSuccess(
      `${options.successLabel} ${finalState.sent} sent, ${finalState.failed} failed${suppressedMsg}.`,
    );
  }

  useEffect(() => {
    fetchTicketsForEffect();
  }, [selectedEventId, offset, ticketTypeFilter, scannedFilter, feeWaiverFilter, affiliationFilter]);

  // Abort any in-flight tickets request on unmount.
  useEffect(() => {
    return () => fetchAbortRef.current?.abort();
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(0);
      fetchTicketsForEffect();
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  function openDeleteModal(ticket: Ticket) {
    setDeleteModalTicket(ticket);
    setShouldSendCancellationEmail(true);
  }

  async function confirmDelete() {
    if (!deleteModalTicket) return;
    const id = deleteModalTicket.id;
    const ticketToDelete = deleteModalTicket;

    try {
      setIsDeletingTicket(true);
      const response = await fetch("/api/tickets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, sendCancellationEmail: shouldSendCancellationEmail }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete ticket");
      }

      setTickets((prev) => prev.filter((t) => t.id !== id));
      setTotal((prev) => prev - 1);
      // Update scanned/unscanned counts
      if (ticketToDelete.scanned) {
        setScannedCount((prev) => prev - 1);
      } else {
        setUnscannedCount((prev) => prev - 1);
      }
      if (ticketToDelete.has_fee_waiver) {
        setFeeWaiverCount((prev: number) => prev - 1);
      }
      // Update ticket type counts
      if (ticketToDelete.type === "STANDARD") {
        setStandardCount((prev) => prev - 1);
      } else if (ticketToDelete.type === "EXTERNAL") {
        setExternalCount((prev) => prev - 1);
      } else if (ticketToDelete.type === "STANDBY") {
        setStandbyCount((prev) => prev - 1);
      } else {
        setVipCount((prev) => prev - 1);
      }
      setSuccess(
        shouldSendCancellationEmail
          ? "Ticket deleted and cancellation email sent!"
          : "Ticket deleted successfully!",
      );
    } catch (err) {
      console.error("Error deleting ticket:", err);
      setError(err instanceof Error ? err.message : "Failed to delete ticket");
    } finally {
      setIsDeletingTicket(false);
      setDeleteModalTicket(null);
    }
  }

  async function handleUpdateType(id: string, newType: string) {
    // Find the ticket to check its current type
    const ticket = tickets.find((t) => t.id === id);
    const oldType = ticket?.type;

    setUpdatingTicketId(id);
    try {
      const response = await fetch("/api/tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "updateType", type: newType }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update ticket type");
      }

      const data = await response.json();
      setTickets((prev) =>
        prev.map((t) => (t.id === id ? (data.ticket as Ticket) : t)),
      );
      // Update ticket type counts if type actually changed
      if (oldType !== newType) {
        if (oldType === "STANDARD") setStandardCount((prev) => prev - 1);
        else if (oldType === "VIP") setVipCount((prev) => prev - 1);
        else if (oldType === "EXTERNAL") setExternalCount((prev) => prev - 1);
        else if (oldType === "STANDBY") setStandbyCount((prev) => prev - 1);

        if (newType === "STANDARD") setStandardCount((prev) => prev + 1);
        else if (newType === "VIP") setVipCount((prev) => prev + 1);
        else if (newType === "EXTERNAL") setExternalCount((prev) => prev + 1);
        else if (newType === "STANDBY") setStandbyCount((prev) => prev + 1);
      }
      setSuccess("Ticket type updated successfully!");
    } catch (err) {
      console.error("Error updating ticket type:", err);
      setError(
        err instanceof Error ? err.message : "Failed to update ticket type",
      );
    } finally {
      setUpdatingTicketId(null);
    }
  }

  async function handleUpdateScanned(id: string, newScanned: boolean) {
    // Find the ticket to check its current scanned status
    const ticket = tickets.find((t) => t.id === id);
    const wasScanned = ticket?.scanned;

    setUpdatingTicketId(id);
    try {
      const response = await fetch("/api/tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          action: "updateScanned",
          scanned: newScanned,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update scanned status");
      }

      const data = await response.json();
      setTickets((prev) =>
        prev.map((t) => (t.id === id ? (data.ticket as Ticket) : t)),
      );
      // Update counts based on the change
      if (wasScanned && !newScanned) {
        // Was scanned, now unscanned
        setScannedCount((prev) => prev - 1);
        setUnscannedCount((prev) => prev + 1);
      } else if (!wasScanned && newScanned) {
        // Was unscanned, now scanned
        setScannedCount((prev) => prev + 1);
        setUnscannedCount((prev) => prev - 1);
      }
      setSuccess("Scanned status updated successfully!");
    } catch (err) {
      console.error("Error updating scanned status:", err);
      setError(
        err instanceof Error ? err.message : "Failed to update scanned status",
      );
    } finally {
      setUpdatingTicketId(null);
    }
  }

  async function handleUpdateName(id: string, newName: string) {
    const trimmed = newName.trim();
    const ticket = tickets.find((t) => t.id === id);
    // Don't update if value hasn't changed
    if ((ticket?.name || "") === trimmed) {
      setEditingNameId(null);
      return;
    }

    setUpdatingTicketId(id);
    try {
      const response = await fetch("/api/tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "updateName", name: trimmed }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update name");
      }

      const data = await response.json();
      setTickets((prev) =>
        prev.map((t) => (t.id === id ? (data.ticket as Ticket) : t)),
      );
      setSuccess("Name updated successfully!");
    } catch (err) {
      console.error("Error updating name:", err);
      setError(err instanceof Error ? err.message : "Failed to update name");
    } finally {
      setUpdatingTicketId(null);
      setEditingNameId(null);
    }
  }

  async function handleResendEmail(id: string) {
    const ticket = tickets.find((item) => item.id === id);
    const shouldResend = await confirmAction({
      title: "Resend confirmation email?",
      description: (
        <>
          This will resend the ticket confirmation to{" "}
          <span className="font-medium text-white">
            {ticket?.email || "this ticket holder"}
          </span>
          .
        </>
      ),
      confirmLabel: "Resend email",
      tone: "primary",
    });
    if (!shouldResend) return;

    setResendingEmailId(id);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "resendEmail" }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to resend email");
      }

      setSuccess("Email resent successfully!");
    } catch (err) {
      console.error("Error resending email:", err);
      setError(err instanceof Error ? err.message : "Failed to resend email");
    } finally {
      setResendingEmailId(null);
    }
  }

  async function handleSendDayOfReminders() {
    if (!selectedEventId) {
      setError("Please select an event first");
      return;
    }

    const selectedEvent = events.find((e) => e.id === selectedEventId);
    const eventName = selectedEvent?.name || "this event";

    const shouldSend = await confirmAction({
      title: "Send day-of reminder emails?",
      description: (
        <>
          Send reminders to{" "}
          <span className="font-medium text-white">
            {total.toLocaleString()}
          </span>{" "}
          ticket holders for{" "}
          <span className="font-medium text-white">{eventName}</span>. This
          includes the no-bags policy and ADA accommodation info.
        </>
      ),
      confirmLabel: "Send reminders",
      tone: "primary",
    });
    if (!shouldSend) return;

    setIsSendingReminders(true);
    setError(null);
    setSuccess(null);

    try {
      await sendBulkReminderEmails({
        action: "sendDayOfReminders",
        eventId: selectedEventId,
        label: "Sending day-of reminders",
        successLabel: "Day-of reminders sent!",
      });
    } catch (err) {
      console.error("Error sending day-of reminders:", err);
      setError(
        err instanceof Error ? err.message : "Failed to send day-of reminders",
      );
    } finally {
      setIsSendingReminders(false);
    }
  }

  async function handleSendIndividualReminder(id: string) {
    const ticket = tickets.find((t) => t.id === id);
    if (!ticket) return;

    const shouldSend = await confirmAction({
      title: "Send day-of reminder?",
      description: (
        <>
          Send the day-of reminder to{" "}
          <span className="font-medium text-white">{ticket.email}</span>. This
          includes the no-bags policy and ADA accommodation info.
        </>
      ),
      confirmLabel: "Send reminder",
      tone: "primary",
    });
    if (!shouldSend) return;

    setSendingReminderId(id);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/tickets?eventId=${ticket.event_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "sendDayOfReminder" }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send reminder");
      }

      setSuccess(`Day-of reminder sent to ${ticket.email}!`);
    } catch (err) {
      console.error("Error sending individual reminder:", err);
      setError(
        err instanceof Error ? err.message : "Failed to send day-of reminder",
      );
    } finally {
      setSendingReminderId(null);
    }
  }

  async function handleSendMassEmail() {
    if (massEmailType === "early") {
      await handleSendEarlyReminders();
    } else {
      await handleSendDayOfReminders();
    }
  }

  async function handleSendEarlyReminders() {
    if (!selectedEventId) {
      setError("Please select an event first");
      return;
    }

    const selectedEvent = events.find((e) => e.id === selectedEventId);
    const eventName = selectedEvent?.name || "this event";

    const shouldSend = await confirmAction({
      title: "Send early reminder emails?",
      description: (
        <>
          Send reminders to{" "}
          <span className="font-medium text-white">
            {total.toLocaleString()}
          </span>{" "}
          ticket holders for{" "}
          <span className="font-medium text-white">{eventName}</span>. This
          includes doors open time, ticket validity, and the no-bags notice.
        </>
      ),
      confirmLabel: "Send reminders",
      tone: "primary",
    });
    if (!shouldSend) return;

    setIsSendingEarlyReminders(true);
    setError(null);
    setSuccess(null);

    try {
      await sendBulkReminderEmails({
        action: "sendEarlyReminders",
        eventId: selectedEventId,
        label: "Sending early reminders",
        successLabel: "Early reminders sent!",
      });
    } catch (err) {
      console.error("Error sending early reminders:", err);
      setError(
        err instanceof Error ? err.message : "Failed to send early reminders",
      );
    } finally {
      setIsSendingEarlyReminders(false);
    }
  }

  async function handleSendIndividualEarlyReminder(id: string) {
    const ticket = tickets.find((t) => t.id === id);
    if (!ticket) return;

    const shouldSend = await confirmAction({
      title: "Send early reminder?",
      description: (
        <>
          Send the early reminder to{" "}
          <span className="font-medium text-white">{ticket.email}</span>. This
          includes doors open time, ticket validity, and the no-bags notice.
        </>
      ),
      confirmLabel: "Send reminder",
      tone: "primary",
    });
    if (!shouldSend) return;

    setSendingEarlyReminderId(id);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/tickets?eventId=${ticket.event_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          action: "sendEarlyReminder",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send early reminder");
      }

      setSuccess(`Early reminder sent to ${ticket.email}!`);
    } catch (err) {
      console.error("Error sending individual early reminder:", err);
      setError(
        err instanceof Error ? err.message : "Failed to send early reminder",
      );
    } finally {
      setSendingEarlyReminderId(null);
    }
  }

  async function handleAddTicket(e: React.FormEvent) {
    e.preventDefault();

    const rowsWithEmail = newTicketRows.filter((row) => row.email.trim());
    if (rowsWithEmail.length === 0) {
      setError("Please enter at least one email address");
      return;
    }

    const rowsMissingName = rowsWithEmail.filter((row) => !row.name.trim());
    if (rowsMissingName.length > 0) {
      setError("Name is required for each ticket.");
      return;
    }

    if (!newTicketEventId) {
      setError("Please select an event");
      return;
    }

    const rowsToSubmit = newTicketRows.filter(
      (row) => row.email.trim() && row.name.trim(),
    );
    const invalidRows = rowsToSubmit.filter(
      (row) => !isValidEmail(row.email.trim()),
    );
    if (invalidRows.length > 0) {
      setError(
        `Invalid email(s): ${invalidRows.map((r) => r.email).join(", ")}`,
      );
      return;
    }

    setIsSubmitting(true);
    setSubmitProgress({ completed: 0, total: rowsToSubmit.length });
    setError(null);
    setSuccess(null);

    let successCount = 0;
    const errors: string[] = [];
    const createdTickets: Ticket[] = [];

    for (const row of rowsToSubmit) {
      const email = row.email.trim().toLowerCase();
      const name = row.name.trim();
      try {
        const response = await fetch("/api/tickets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            name,
            eventId: newTicketEventId,
            type: newTicketType,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          errors.push(`${email}: ${data.error || "Failed to create ticket"}`);
          setSubmitProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
          continue;
        }

        createdTickets.push(data.ticket as Ticket);
        successCount++;
      } catch (err) {
        console.error(`Error creating ticket for ${email}:`, err);
        errors.push(
          `${email}: ${err instanceof Error ? err.message : "Failed to create ticket"}`,
        );
      }
      setSubmitProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
    }

    if (successCount > 0) {
      setTickets((prev) => [...createdTickets, ...prev]);
      setTotal((prev) => prev + successCount);
      setUnscannedCount((prev) => prev + successCount);
      setFeeWaiverCount(
        (prev: number) =>
          prev + createdTickets.filter((ticket) => ticket.has_fee_waiver).length,
      );
      if (newTicketType === "STANDARD") {
        setStandardCount((prev) => prev + successCount);
      } else if (newTicketType === "EXTERNAL") {
        setExternalCount((prev) => prev + successCount);
      } else if (newTicketType === "STANDBY") {
        setStandbyCount((prev) => prev + successCount);
      } else {
        setVipCount((prev) => prev + successCount);
      }
      setSuccess(
        `Successfully created ${successCount} ticket(s)${errors.length > 0 ? ` (${errors.length} failed)` : ""}`,
      );
      resetNewTicketForm();
      if (errors.length === 0) {
        setShowAddForm(false);
      }
    }

    if (errors.length > 0 && successCount === 0) {
      setError(`Failed to create tickets: ${errors.join("; ")}`);
    } else if (errors.length > 0) {
      setError(`Some tickets failed: ${errors.join("; ")}`);
    }

    setIsSubmitting(false);
  }

  const visibleAffiliationStats = AFFILIATION_FILTER_ORDER
    .filter((key) => affiliationCounts[key] > 0)
    .map((key) => ({
      key,
      label: formatAffiliationLabel(key),
      value: affiliationCounts[key],
    }));

  const filtersActive = Boolean(
    search || ticketTypeFilter || scannedFilter || feeWaiverFilter || affiliationFilter,
  );

  function toggleTypeFilter(type: string) {
    setTicketTypeFilter((prev) => (prev === type ? "" : type));
    setOffset(0);
  }

  function toggleScannedFilter(value: string) {
    setScannedFilter((prev) => (prev === value ? "" : value));
    setOffset(0);
  }

  function toggleFeeWaiverFilter() {
    setFeeWaiverFilter((prev) => (prev === "true" ? "" : "true"));
    setOffset(0);
  }

  function renderNameCell(ticket: Ticket) {
    if (editingNameId === ticket.id) {
      return (
        <input
          type="text"
          name="ticket-name"
          aria-label="Ticket holder name"
          value={editingNameValue}
          onChange={(e) => setEditingNameValue(e.target.value)}
          onBlur={() => handleUpdateName(ticket.id, editingNameValue)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleUpdateName(ticket.id, editingNameValue);
            } else if (e.key === "Escape") {
              setEditingNameId(null);
            }
          }}
          autoFocus
          disabled={updatingTicketId === ticket.id}
          className="w-full rounded-md border border-zinc-600 bg-zinc-800 px-2 py-1 text-base text-white focus:border-emerald-500/50 focus:outline-none disabled:opacity-50 sm:text-sm"
          placeholder="Enter name"
        />
      );
    }
    return (
      <button
        type="button"
        onClick={() => {
          setEditingNameId(ticket.id);
          setEditingNameValue(ticket.name || "");
        }}
        className="group inline-flex max-w-full items-center gap-1.5 text-left text-sm font-medium text-zinc-200 transition-colors hover:text-white"
        title="Click to edit name"
      >
        <span className="truncate">{ticket.name || "—"}</span>
        <svg
          className="h-3.5 w-3.5 shrink-0 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
          />
        </svg>
      </button>
    );
  }

  function renderTypeSelect(ticket: Ticket) {
    const type = ticket.type || "STANDARD";
    return (
      <div className="inline-grid grid-cols-[1fr_--spacing(7)] items-center">
        <select
          aria-label="Ticket type"
          value={type}
          onChange={(e) => {
            if (e.target.value !== ticket.type) {
              handleUpdateType(ticket.id, e.target.value);
            }
          }}
          disabled={updatingTicketId === ticket.id}
          className={`col-span-full row-start-1 appearance-none rounded-lg py-1.5 pr-7 pl-2.5 text-xs font-semibold ring-1 ring-inset focus:ring-emerald-500/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:py-1 ${typeBadgeClasses(type)}`}
        >
          {TICKET_TYPES.map((t) => (
            <option key={t} value={t} className="bg-zinc-900 text-white">
              {t}
            </option>
          ))}
        </select>
        <SelectChevron />
      </div>
    );
  }

  function renderScannedSelect(ticket: Ticket) {
    return (
      <div className="inline-grid grid-cols-[1fr_--spacing(7)] items-center">
        <select
          aria-label="Scanned status"
          value={ticket.scanned ? "scanned" : "not-scanned"}
          onChange={(e) => {
            const newScanned = e.target.value === "scanned";
            if (newScanned !== ticket.scanned) {
              handleUpdateScanned(ticket.id, newScanned);
            }
          }}
          disabled={updatingTicketId === ticket.id}
          className={`col-span-full row-start-1 appearance-none rounded-lg py-1.5 pr-7 pl-2.5 text-xs font-semibold ring-1 ring-inset focus:ring-emerald-500/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:py-1 ${
            ticket.scanned
              ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
              : "bg-zinc-700/40 text-zinc-200 ring-zinc-600/40"
          }`}
        >
          <option value="scanned" className="bg-zinc-900 text-white">
            Scanned
          </option>
          <option value="not-scanned" className="bg-zinc-900 text-white">
            Not scanned
          </option>
        </select>
        <SelectChevron />
      </div>
    );
  }

  function renderActions(ticket: Ticket) {
    const spinner = (color: string) => (
      <div
        className={`h-5 w-5 animate-spin rounded-full border-2 border-t-transparent ${color}`}
      />
    );
    return (
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => handleResendEmail(ticket.id)}
          disabled={resendingEmailId === ticket.id}
          className="rounded-lg p-2 text-blue-400 transition-colors hover:bg-blue-500/10 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
          title="Resend confirmation email"
        >
          {resendingEmailId === ticket.id ? (
            spinner("border-blue-400")
          ) : (
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => handleSendIndividualEarlyReminder(ticket.id)}
          disabled={sendingEarlyReminderId === ticket.id}
          className="rounded-lg p-2 text-indigo-400 transition-colors hover:bg-indigo-500/10 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
          title="Send early reminder"
        >
          {sendingEarlyReminderId === ticket.id ? (
            spinner("border-indigo-400")
          ) : (
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => handleSendIndividualReminder(ticket.id)}
          disabled={sendingReminderId === ticket.id}
          className="rounded-lg p-2 text-amber-400 transition-colors hover:bg-amber-500/10 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
          title="Send day-of reminder"
        >
          {sendingReminderId === ticket.id ? (
            spinner("border-amber-400")
          ) : (
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => openDeleteModal(ticket)}
          className="rounded-lg p-2 text-rose-400 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
          title="Delete ticket"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl font-bold text-white sm:text-3xl">
            Ticket Management
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {selectedEventId ? (
              <>
                <span className="font-semibold text-zinc-200">
                  {total.toLocaleString()}
                </span>{" "}
                ticket{total === 1 ? "" : "s"} sold
                {filtersActive && (
                  <>
                    {" · "}
                    <span className="font-semibold text-blue-300">
                      {filteredCount.toLocaleString()}
                    </span>{" "}
                    matching filters
                  </>
                )}
              </>
            ) : (
              "Select an event to manage tickets"
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-stretch overflow-hidden rounded-xl border border-zinc-700 bg-zinc-800/80">
            <select
              value={massEmailType}
              onChange={(e) =>
                setMassEmailType(e.target.value as "early" | "day-of")
              }
              disabled={
                isSendingEarlyReminders ||
                isSendingReminders ||
                !selectedEventId ||
                total === 0
              }
              className="appearance-none border-0 bg-transparent bg-[length:1rem_1rem] bg-[right_0.75rem_center] bg-no-repeat py-2.5 pr-8 pl-3.5 font-medium text-zinc-200 focus:ring-0 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%239ca3af' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
              }}
              aria-label="Email type"
            >
              <option value="early">Early reminders</option>
              <option value="day-of">Day-of reminders</option>
            </select>
            <button
              type="button"
              onClick={handleSendMassEmail}
              disabled={
                !selectedEventId ||
                total === 0 ||
                isSendingEarlyReminders ||
                isSendingReminders
              }
              className="flex items-center gap-2 border-l border-zinc-700 bg-zinc-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
              title={
                massEmailType === "early"
                  ? "Send early reminder emails to all ticket holders"
                  : "Send day-of reminder emails to all ticket holders"
              }
            >
              {isSendingEarlyReminders || isSendingReminders ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              )}
              <span className="hidden sm:inline">Send</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => fetchTickets()}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
            title="Reload tickets"
          >
            <svg className={`h-5 w-5 ${isLoading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="hidden sm:inline">Reload</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAddForm((prev) => !prev);
              setNewTicketEventId((prev) => prev || selectedEventId);
            }}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2.5 font-medium text-white transition-opacity hover:opacity-90"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add Ticket
          </button>
        </div>
      </div>

      {/* Stat cards */}
      {selectedEventId && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total sold" value={total} />
          <StatCard
            label="Standard"
            value={standardCount}
            valueClass="text-zinc-200"
            active={ticketTypeFilter === "STANDARD"}
            onClick={() => toggleTypeFilter("STANDARD")}
          />
          <StatCard
            label="VIP"
            value={vipCount}
            valueClass="text-blue-300"
            active={ticketTypeFilter === "VIP"}
            onClick={() => toggleTypeFilter("VIP")}
          />
          <StatCard
            label="External"
            value={externalCount}
            valueClass="text-green-300"
            active={ticketTypeFilter === "EXTERNAL"}
            onClick={() => toggleTypeFilter("EXTERNAL")}
          />
          <StatCard
            label="Standby"
            value={standbyCount}
            valueClass="text-amber-300"
            active={ticketTypeFilter === "STANDBY"}
            onClick={() => toggleTypeFilter("STANDBY")}
          />
          <StatCard
            label="Scanned"
            value={scannedCount}
            valueClass="text-emerald-300"
            active={scannedFilter === "true"}
            onClick={() => toggleScannedFilter("true")}
          />
          <StatCard
            label="Not scanned"
            value={unscannedCount}
            valueClass="text-zinc-200"
            active={scannedFilter === "false"}
            onClick={() => toggleScannedFilter("false")}
          />
          {feeWaiverCount > 0 && (
            <StatCard
              label="Fee waiver"
              value={feeWaiverCount}
              valueClass="text-amber-300"
              active={feeWaiverFilter === "true"}
              onClick={toggleFeeWaiverFilter}
            />
          )}
        </div>
      )}

      {/* Messages */}
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
          <button
            onClick={() => setError(null)}
            className="ml-auto text-rose-400 hover:text-rose-300"
          >
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-3">
          <svg
            className="w-5 h-5 text-emerald-400 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          <p className="text-emerald-400 text-sm">{success}</p>
          <button
            onClick={() => setSuccess(null)}
            className="ml-auto text-emerald-400 hover:text-emerald-300"
          >
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {bulkReminderState && (
        <div className="mb-6">
          <BulkSendProgress
            state={bulkReminderState}
            onDismiss={() => setBulkReminderState(null)}
          />
        </div>
      )}

      {/* Add Ticket Form */}
      {showAddForm && (
        <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-6">
          <h2 className="text-lg font-bold text-white sm:text-xl">Add Tickets</h2>
          <p className="mt-1 mb-5 text-sm text-zinc-400">
            Each row is one ticket — name and email are required. Paste two
            columns (name, email) from Google Sheets into any field to fill rows
            automatically.
          </p>
          <form onSubmit={handleAddTicket} className="space-y-5">
            {/* Shared: Event + Type */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="add-event"
                  className="mb-1.5 block text-sm font-medium text-zinc-300"
                >
                  Event
                </label>
                <select
                  id="add-event"
                  name="event"
                  value={newTicketEventId}
                  onChange={(e) => {
                    const eventId = e.target.value;
                    setNewTicketEventId(eventId);
                    setEmailLookups({});
                    newTicketRows.forEach((row, i) => {
                      debouncedEmailLookup(i, row.email, eventId);
                    });
                  }}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-base text-white focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 focus:outline-none sm:text-sm"
                  required
                >
                  <option value="">Select an event</option>
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name || "Unnamed Event"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="add-type"
                  className="mb-1.5 block text-sm font-medium text-zinc-300"
                >
                  Ticket type
                </label>
                <select
                  id="add-type"
                  name="type"
                  value={newTicketType}
                  onChange={(e) => setNewTicketType(e.target.value)}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-base text-white focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 focus:outline-none sm:text-sm"
                >
                  {TICKET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Rows: Name + Email per ticket */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-300">
                  Attendees ({newTicketRows.length})
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setNewTicketRows((prev) => [...prev, { name: "", email: "" }])
                  }
                  className="flex items-center gap-1 text-sm font-medium text-emerald-400 hover:text-emerald-300"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add row
                </button>
              </div>
              <div className="space-y-2">
                {newTicketRows.map((row, index) => (
                  <div
                    key={index}
                    className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-800/40 p-2 sm:flex-row sm:items-center"
                  >
                    <span className="hidden w-6 shrink-0 text-center text-xs font-medium text-zinc-500 tabular-nums sm:block">
                      {index + 1}
                    </span>
                    <input
                      type="text"
                      name={`attendee-name-${index}`}
                      aria-label={`Attendee ${index + 1} name`}
                      value={row.name}
                      onPaste={(event) => handleSpreadsheetPaste(index, event)}
                      onChange={(e) => {
                        setNewTicketRows((prev) => {
                          const next = [...prev];
                          next[index] = { ...next[index], name: e.target.value };
                          return next;
                        });
                      }}
                      placeholder="Attendee name"
                      className="w-full rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-base text-white placeholder-zinc-500 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 focus:outline-none sm:w-2/5 sm:text-sm"
                    />
                    <div className="relative w-full sm:flex-1">
                      <input
                        type="email"
                        name={`attendee-email-${index}`}
                        aria-label={`Attendee ${index + 1} email`}
                        value={row.email}
                        onPaste={(event) => handleSpreadsheetPaste(index, event)}
                        onChange={(e) => {
                          const value = e.target.value;
                          setNewTicketRows((prev) => {
                            const next = [...prev];
                            next[index] = { ...next[index], email: value };
                            return next;
                          });
                          debouncedEmailLookup(index, value, newTicketEventId);
                        }}
                        placeholder="email@example.com"
                        className="w-full rounded-lg border border-zinc-600 bg-zinc-800 py-2 pr-24 pl-3 text-base text-white placeholder-zinc-500 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 focus:outline-none sm:text-sm"
                      />
                      {emailLookups[index] ? (
                        <div className="pointer-events-none absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
                          <span className="inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-400">
                            Exists
                          </span>
                          {emailLookups[index]!.type !== newTicketType && (
                            <span className="inline-flex items-center rounded bg-blue-500/15 px-1.5 py-0.5 text-[11px] font-medium text-blue-400">
                              {emailLookups[index]!.type}
                            </span>
                          )}
                        </div>
                      ) : null}
                    </div>
                    {newTicketRows.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setNewTicketRows((prev) =>
                            prev.filter((_, i) => i !== index)
                          );
                          setEmailLookups((prev) => {
                            const next: Record<number, EmailLookupResult> = {};
                            for (const [k, v] of Object.entries(prev)) {
                              const ki = Number(k);
                              if (ki < index) next[ki] = v;
                              else if (ki > index) next[ki - 1] = v;
                            }
                            return next;
                          });
                        }}
                        className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-rose-400 sm:gap-0"
                        title="Remove row"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        <span className="text-sm sm:hidden">Remove row</span>
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col-reverse items-stretch gap-3 border-t border-zinc-800 pt-4 sm:flex-row sm:items-center sm:gap-4">
              {isSubmitting ? (
                <div className="flex items-center gap-3 px-2 py-1 sm:px-6 sm:py-3">
                  <div className="h-2 w-40 overflow-hidden rounded-full bg-zinc-700">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300"
                      style={{ width: `${submitProgress.total ? (submitProgress.completed / submitProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-sm text-zinc-300 tabular-nums">
                    {submitProgress.completed}/{submitProgress.total}
                  </span>
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={
                    !newTicketRows.some((r) => r.email.trim() && r.name.trim())
                  }
                  className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Create{" "}
                  {newTicketRows.filter(
                    (r) => r.email.trim() && r.name.trim()
                  ).length || 0}{" "}
                  ticket(s)
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  resetNewTicketForm();
                }}
                className="px-6 py-3 text-zinc-400 transition-colors hover:text-white"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      {selectedEventId && total > 0 && visibleAffiliationStats.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {visibleAffiliationStats.map((stat) => {
            const isActive = affiliationFilter === stat.key;
            return (
              <button
                key={stat.key}
                type="button"
                onClick={() =>
                  handleAffiliationFilterChange(isActive ? "" : stat.key)
                }
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? "border-rose-500/40 bg-rose-500/20 text-rose-400"
                    : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500"
                }`}
              >
                {stat.label}
                <span className={isActive ? "text-rose-400/70" : "text-zinc-500"}>
                  {stat.value}
                </span>
              </button>
            );
          })}
          {affiliationFilter && (
            <button
              type="button"
              onClick={() => handleAffiliationFilterChange("")}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
            >
              <svg
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              Clear
            </button>
          )}
        </div>
      )}

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-zinc-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            name="search"
            aria-label="Search by name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            disabled={!selectedEventId}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900 py-2.5 pr-4 pl-10 text-base text-white placeholder-zinc-500 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:flex sm:w-auto">
          <div className="inline-grid grid-cols-[1fr_--spacing(8)] items-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-300 has-disabled:opacity-50">
            <select
              aria-label="Filter by ticket type"
              name="type-filter"
              value={ticketTypeFilter}
              onChange={(e) => {
                setTicketTypeFilter(e.target.value);
                setOffset(0);
              }}
              disabled={!selectedEventId}
              className="col-span-full row-start-1 appearance-none rounded-xl bg-transparent py-2.5 pr-8 pl-4 text-base text-white focus:outline-none disabled:cursor-not-allowed sm:text-sm"
            >
              <option value="">All types</option>
              {TICKET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <SelectChevron />
          </div>
          <div className="inline-grid grid-cols-[1fr_--spacing(8)] items-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-300 has-disabled:opacity-50">
            <select
              aria-label="Filter by scanned status"
              name="scanned-filter"
              value={scannedFilter}
              onChange={(e) => {
                setScannedFilter(e.target.value);
                setOffset(0);
              }}
              disabled={!selectedEventId}
              className="col-span-full row-start-1 appearance-none rounded-xl bg-transparent py-2.5 pr-8 pl-4 text-base text-white focus:outline-none disabled:cursor-not-allowed sm:text-sm"
            >
              <option value="">All statuses</option>
              <option value="true">Scanned</option>
              <option value="false">Not scanned</option>
            </select>
            <SelectChevron />
          </div>
        </div>
        {filtersActive && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setTicketTypeFilter("");
              setScannedFilter("");
              setFeeWaiverFilter("");
              setOffset(0);
              if (affiliationFilter) handleAffiliationFilterChange("");
            }}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear filters
          </button>
        )}
      </div>

      {/* Tickets Table */}
      {isLoading && tickets.length === 0 ? (
        <div className="text-center py-16 bg-zinc-900/50 rounded-2xl border border-zinc-800">
          <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <div className="w-8 h-8 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
          </div>
          <p className="text-zinc-400">Loading tickets...</p>
        </div>
      ) : tickets.length === 0 ? (
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
                d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 002 2h3a2 2 0 002-2V7a2 2 0 00-2-2H5zM5 13a2 2 0 00-2 2v3a2 2 0 002 2h3a2 2 0 002-2v-3a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2v-3z"
              />
            </svg>
          </div>
          <p className="text-zinc-400 text-lg mb-2">
            {!selectedEventId
              ? "Select an event to view tickets"
              : "No tickets found"}
          </p>
          <p className="text-zinc-600 text-sm">
            {!selectedEventId
              ? "Choose an event from the filter above"
              : search || ticketTypeFilter || scannedFilter || feeWaiverFilter || affiliationFilter
                ? "Try adjusting your filters"
                : "Create your first ticket to get started"}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 md:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-zinc-800 bg-zinc-800/50">
                  <tr>
                    <th className="px-4 py-3.5 text-left text-xs font-semibold whitespace-nowrap text-zinc-400">
                      Name
                    </th>
                    <th className="px-4 py-3.5 text-left text-xs font-semibold whitespace-nowrap text-zinc-400">
                      Email
                    </th>
                    <th className="px-4 py-3.5 text-left text-xs font-semibold whitespace-nowrap text-zinc-400">
                      Type
                    </th>
                    <th className="hidden px-4 py-3.5 text-left text-xs font-semibold whitespace-nowrap text-zinc-400 lg:table-cell">
                      Created
                    </th>
                    <th className="px-4 py-3.5 text-left text-xs font-semibold whitespace-nowrap text-zinc-400">
                      Status
                    </th>
                    <th className="px-4 py-3.5 text-right text-xs font-semibold whitespace-nowrap text-zinc-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {tickets.map((ticket) => (
                    <tr key={ticket.id} className="transition-colors hover:bg-zinc-800/40">
                      <td className="max-w-[220px] px-4 py-3">{renderNameCell(ticket)}</td>
                      <td className="px-4 py-3">
                        <div className="max-w-[280px] truncate text-sm text-zinc-300">
                          {ticket.email}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{renderTypeSelect(ticket)}</td>
                      <td className="hidden px-4 py-3 whitespace-nowrap lg:table-cell">
                        <div className="text-sm text-zinc-400">
                          {formatDate(ticket.created_at)}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{renderScannedSelect(ticket)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex justify-end">{renderActions(ticket)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {tickets.map((ticket) => (
              <div
                key={ticket.id}
                className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {renderNameCell(ticket)}
                    <p className="mt-0.5 truncate text-sm text-zinc-400">
                      {ticket.email}
                    </p>
                  </div>
                  <div className="shrink-0">{renderTypeSelect(ticket)}</div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  {renderScannedSelect(ticket)}
                  <span className="text-xs text-zinc-500">
                    {formatDate(ticket.created_at)}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-end border-t border-zinc-800 pt-2">
                  {renderActions(ticket)}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {filteredCount > limit && (
            <div className="mt-4 flex flex-col items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 sm:flex-row sm:px-6">
              <div className="text-sm text-zinc-400">
                Showing{" "}
                <span className="font-medium text-zinc-200">{offset + 1}</span>–
                <span className="font-medium text-zinc-200">
                  {Math.min(offset + limit, filteredCount)}
                </span>{" "}
                of{" "}
                <span className="font-medium text-zinc-200">
                  {filteredCount.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setOffset(offset + limit)}
                  disabled={offset + limit >= filteredCount}
                  className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmationDialog
        open={deleteModalTicket !== null}
        title="Delete Ticket"
        description={
          deleteModalTicket ? (
            <>
              Delete the ticket for{" "}
              <span className="font-semibold text-white">
                {deleteModalTicket.email}
              </span>
              {deleteModalTicket.name ? ` (${deleteModalTicket.name})` : ""}.
            </>
          ) : undefined
        }
        confirmLabel={isDeletingTicket
          ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Deleting...
            </>
          )
          : "Delete Ticket"}
        tone="danger"
        dismissible={!isDeletingTicket}
        isConfirming={isDeletingTicket}
        onCancel={() => {
          if (!isDeletingTicket) {
            setDeleteModalTicket(null);
          }
        }}
        onConfirm={() => {
          void confirmDelete();
        }}
      >
        {deleteModalTicket ? (
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={shouldSendCancellationEmail}
              onChange={(event) =>
                setShouldSendCancellationEmail(event.target.checked)}
              disabled={isDeletingTicket}
              className="rounded border-zinc-600 text-rose-500 focus:ring-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span className="text-sm text-zinc-300">
              Send cancellation email to {deleteModalTicket.email}
            </span>
          </label>
        ) : null}
      </ConfirmationDialog>
      {confirmationDialog}
    </div>
  );
}
