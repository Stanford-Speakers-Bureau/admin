"use client";

import { useEffect, useState } from "react";

export type Ticket = {
  id: string;
  email: string;
  name: string | null;
  type: string | null;
  created_at: string;
  scanned: boolean;
  scan_time: string | null;
  referral: string | null;
  event_id: string;
  events: {
    id: string;
    name: string | null;
    route: string | null;
    start_time_date: string | null;
  } | null;
};

type TicketRow = { name: string; email: string };

type TicketManagementClientProps = {
  initialTickets: Ticket[];
  initialTotal: number;
  initialScannedCount: number;
  initialUnscannedCount: number;
  initialFilteredCount: number;
  initialStandardCount: number;
  initialVipCount: number;
  initialExternalCount: number;
  initialWaitlistCount: number;
  initialEvents: {
    id: string;
    name: string | null;
    start_time_date: string | null;
    waitlist: boolean;
  }[];
};

function formatDate(dateString: string | null): string {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "N/A";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function getNextEventId(
  events: { id: string; start_time_date: string | null }[],
): string {
  if (!events.length) return "";
  const now = new Date().toISOString();
  const sorted = [...events].sort((a, b) => {
    const aVal = a.start_time_date ?? "";
    const bVal = b.start_time_date ?? "";
    return aVal.localeCompare(bVal);
  });
  const next = sorted.find((e) => (e.start_time_date ?? "") >= now);
  return next?.id ?? sorted[0]?.id ?? "";
}

export default function TicketManagementClient({
  initialTickets,
  initialTotal,
  initialScannedCount,
  initialUnscannedCount,
  initialFilteredCount,
  initialStandardCount,
  initialVipCount,
  initialExternalCount,
  initialWaitlistCount,
  initialEvents,
}: TicketManagementClientProps) {
  const defaultEventId = getNextEventId(initialEvents);
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets);
  const [total, setTotal] = useState(initialTotal);
  const [scannedCount, setScannedCount] = useState(initialScannedCount);
  const [unscannedCount, setUnscannedCount] = useState(initialUnscannedCount);
  const [filteredCount, setFilteredCount] = useState(initialFilteredCount);
  const [standardCount, setStandardCount] = useState(initialStandardCount);
  const [vipCount, setVipCount] = useState(initialVipCount);
  const [externalCount, setExternalCount] = useState(initialExternalCount);
  const [waitlistCount, setWaitlistCount] = useState(initialWaitlistCount);
  const [events, setEvents] = useState(initialEvents);
  const [isTogglingWaitlist, setIsTogglingWaitlist] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string>(defaultEventId);
  const [search, setSearch] = useState("");
  const [ticketTypeFilter, setTicketTypeFilter] = useState<string>("");
  const [scannedFilter, setScannedFilter] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTicketRows, setNewTicketRows] = useState<TicketRow[]>([
    { name: "", email: "" },
  ]);
  const [newTicketEventId, setNewTicketEventId] = useState(defaultEventId);
  const [newTicketType, setNewTicketType] = useState("VIP");
  const [isSubmitting, setIsSubmitting] = useState(false);
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
  const [massEmailType, setMassEmailType] = useState<"early" | "day-of">(
    "early",
  );
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState("");

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

  async function fetchTickets() {
    // Don't fetch if no event is selected
    if (!selectedEventId) {
      setTickets([]);
      setTotal(0);
      setScannedCount(0);
      setUnscannedCount(0);
      setFilteredCount(0);
      setStandardCount(0);
      setVipCount(0);
      setExternalCount(0);
      setWaitlistCount(0);
      return;
    }

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

      const response = await fetch(`/api/tickets?${params}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch tickets");
      }

      const data = await response.json();
      setTickets(data.tickets || []);
      setTotal(data.total || 0);
      setScannedCount(data.scannedCount || 0);
      setUnscannedCount(data.unscannedCount || 0);
      setFilteredCount(data.filteredCount || 0);
      setStandardCount(data.standardCount || 0);
      setVipCount(data.vipCount || 0);
      setExternalCount(data.externalCount || 0);
      setWaitlistCount(data.waitlistCount || 0);
    } catch (err) {
      console.error("Error fetching tickets:", err);
      setError(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchTickets();
  }, [selectedEventId, offset, ticketTypeFilter, scannedFilter]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(0);
      fetchTickets();
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this ticket?")) return;

    // Find the ticket to check if it was scanned
    const ticketToDelete = tickets.find((t) => t.id === id);

    try {
      const response = await fetch("/api/tickets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete ticket");
      }

      setTickets((prev) => prev.filter((t) => t.id !== id));
      setTotal((prev) => prev - 1);
      // Update scanned/unscanned counts
      if (ticketToDelete?.scanned) {
        setScannedCount((prev) => prev - 1);
      } else {
        setUnscannedCount((prev) => prev - 1);
      }
      // Update ticket type counts
      if (ticketToDelete?.type === "STANDARD") {
        setStandardCount((prev) => prev - 1);
      } else if (ticketToDelete?.type === "EXTERNAL") {
        setExternalCount((prev) => prev - 1);
      } else if (ticketToDelete?.type === "WAITLIST") {
        setWaitlistCount((prev) => prev - 1);
      } else {
        setVipCount((prev) => prev - 1);
      }
      setSuccess("Ticket deleted successfully!");
    } catch (err) {
      console.error("Error deleting ticket:", err);
      setError(err instanceof Error ? err.message : "Failed to delete ticket");
    }
  }

  async function handleUnscan(id: string) {
    if (!confirm("Are you sure you want to unscan this ticket?")) return;

    try {
      const response = await fetch("/api/tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "unscan" }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to unscan ticket");
      }

      const data = await response.json();
      setTickets((prev) =>
        prev.map((t) => (t.id === id ? (data.ticket as Ticket) : t)),
      );
      // Update counts: ticket was scanned, now unscanned
      setScannedCount((prev) => prev - 1);
      setUnscannedCount((prev) => prev + 1);
      setSuccess("Ticket unscanned successfully!");
    } catch (err) {
      console.error("Error unscaning ticket:", err);
      setError(err instanceof Error ? err.message : "Failed to unscan ticket");
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
        else if (oldType === "WAITLIST") setWaitlistCount((prev) => prev - 1);

        if (newType === "STANDARD") setStandardCount((prev) => prev + 1);
        else if (newType === "VIP") setVipCount((prev) => prev + 1);
        else if (newType === "EXTERNAL") setExternalCount((prev) => prev + 1);
        else if (newType === "WAITLIST") setWaitlistCount((prev) => prev + 1);
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
    if (
      !confirm(
        "Are you sure you want to resend the confirmation email to this ticket holder?",
      )
    )
      return;

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

    if (
      !confirm(
        `Send day-of reminder emails to all ${total} ticket holders for ${eventName}?\n\nThis will send reminder emails with "no bags" and ADA accommodation info.`,
      )
    )
      return;

    setIsSendingReminders(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/tickets?eventId=${selectedEventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sendDayOfReminders" }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send reminders");
      }

      setSuccess(
        `Day-of reminders sent! ${data.sent} sent, ${data.failed} failed.`,
      );
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

    if (
      !confirm(
        `Send day-of reminder email to ${ticket.email}?\n\nThis will send a reminder with "no bags" and ADA accommodation info.`,
      )
    )
      return;

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

    if (
      !confirm(
        `Send early reminder emails to all ${total} ticket holders for ${eventName}?\n\nThis will send reminder emails with doors open time, ticket validity, and no bags notice.`,
      )
    )
      return;

    setIsSendingEarlyReminders(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/tickets?eventId=${selectedEventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sendEarlyReminders",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send early reminders");
      }

      setSuccess(
        `Early reminders sent! ${data.sent} sent, ${data.failed} failed.`,
      );
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

    if (
      !confirm(
        `Send early reminder email to ${ticket.email}?\n\nThis will send a reminder with doors open time, ticket validity, and no bags notice.`,
      )
    )
      return;

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

  async function handleToggleWaitlist() {
    if (!selectedEventId) return;
    const currentEvent = events.find((e) => e.id === selectedEventId);
    if (!currentEvent) return;
    const newWaitlist = !currentEvent.waitlist;

    setIsTogglingWaitlist(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedEventId, waitlist: newWaitlist }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update waitlist status");
      }

      setEvents((prev) =>
        prev.map((e) =>
          e.id === selectedEventId ? { ...e, waitlist: newWaitlist } : e,
        ),
      );
      setSuccess(
        `Waitlist ${newWaitlist ? "opened" : "closed"} for this event.`,
      );
    } catch (err) {
      console.error("Error toggling waitlist:", err);
      setError(
        err instanceof Error ? err.message : "Failed to update waitlist status",
      );
    } finally {
      setIsTogglingWaitlist(false);
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
      (row) => !row.email.includes("@") || !row.email.includes("."),
    );
    if (invalidRows.length > 0) {
      setError(
        `Invalid email(s): ${invalidRows.map((r) => r.email).join(", ")}`,
      );
      return;
    }

    setIsSubmitting(true);
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
    }

    if (successCount > 0) {
      setTickets((prev) => [...createdTickets, ...prev]);
      setTotal((prev) => prev + successCount);
      setUnscannedCount((prev) => prev + successCount);
      if (newTicketType === "STANDARD") {
        setStandardCount((prev) => prev + successCount);
      } else if (newTicketType === "EXTERNAL") {
        setExternalCount((prev) => prev + successCount);
      } else if (newTicketType === "WAITLIST") {
        setWaitlistCount((prev) => prev + successCount);
      } else {
        setVipCount((prev) => prev + successCount);
      }
      setSuccess(
        `Successfully created ${successCount} ticket(s)${errors.length > 0 ? ` (${errors.length} failed)` : ""}`,
      );
      setNewTicketRows([{ name: "", email: "" }]);
      setNewTicketEventId("");
      setNewTicketType("VIP");
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
            Ticket Management
          </h1>
          <div className="flex flex-wrap items-center gap-3 sm:gap-6 mt-2">
            <div className="flex items-center gap-2">
              <span className="text-zinc-400">Total Tickets Sold:</span>
              <span className="text-white font-bold text-lg">
                {total.toLocaleString()}
              </span>
            </div>
            {tickets.length > 0 && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400">Standard:</span>
                  <span className="text-zinc-300 font-semibold">
                    {standardCount}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400">VIP:</span>
                  <span className="text-blue-400 font-semibold">
                    {vipCount}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400">External:</span>
                  <span className="text-green-400 font-semibold">
                    {externalCount}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400">Waitlist:</span>
                  <span className="text-amber-400 font-semibold">
                    {waitlistCount}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400">Scanned:</span>
                  <span className="text-emerald-400 font-semibold">
                    {scannedCount}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400">Not Scanned:</span>
                  <span className="text-zinc-300 font-semibold">
                    {unscannedCount}
                  </span>
                </div>
              </>
            )}
            {(search || ticketTypeFilter || scannedFilter) &&
              selectedEventId && (
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400">Matching Filters:</span>
                  <span className="text-blue-400 font-semibold">
                    {filteredCount}
                  </span>
                </div>
              )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-stretch rounded-xl overflow-hidden border border-zinc-600 bg-zinc-800/80 shadow-sm">
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
              className="pl-4 pr-8 py-2.5 bg-transparent text-zinc-200 font-medium border-0 focus:ring-0 focus:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed appearance-none bg-[length:1rem_1rem] bg-[right_0.75rem_center] bg-no-repeat"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%239ca3af' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
              }}
              aria-label="Email type"
            >
              <option value="early">Early reminders</option>
              <option value="day-of">Day-of reminders</option>
            </select>
            <button
              onClick={handleSendMassEmail}
              disabled={
                !selectedEventId ||
                total === 0 ||
                isSendingEarlyReminders ||
                isSendingReminders
              }
              className="flex items-center gap-2 px-4 py-2.5 bg-zinc-600 text-white font-medium hover:bg-zinc-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-l border-zinc-600"
              title={
                massEmailType === "early"
                  ? "Send early reminder emails to all ticket holders"
                  : "Send day-of reminder emails to all ticket holders"
              }
            >
              {(isSendingEarlyReminders || isSendingReminders) ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
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
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              )}
              Send
            </button>
<<<<<<< Updated upstream
          </div>{selectedEventId && (() => {
            const currentEvent = events.find((e) => e.id === selectedEventId);
            const isOpen = currentEvent?.waitlist ?? false;
            return (
              <button
                onClick={handleToggleWaitlist}
                disabled={isTogglingWaitlist}
                title={isOpen ? "Waitlist is open — click to close" : "Waitlist is closed — click to open"}
                className={`px-4 py-2.5 rounded-xl border font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${isOpen
                    ? "bg-amber-500/20 border-amber-500/40 text-amber-400 hover:bg-amber-500/30"
                    : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                  }`}
              >
                {isTogglingWaitlist ? (
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : isOpen ? (
                  "Waitlist: Open"
                ) : (
                  "Waitlist: Closed"
                )}
              </button>
            );
          })()}
=======
          </div>
>>>>>>> Stashed changes
          <button
            onClick={() => fetchTickets()}
            disabled={isLoading}
            className="flex items-center gap-2 px-5 py-2.5 bg-zinc-800 border border-zinc-700 text-white rounded-xl font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Reload tickets"
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
            Reload
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6v6m0 0v6m0-6h6m-6 0H6"
              />
            </svg>
            Add Ticket
          </button>
          </div>
          {selectedEventId && (() => {
            const currentEvent = events.find((e) => e.id === selectedEventId);
            const isOpen = currentEvent?.waitlist ?? false;
            return (
              <button
                onClick={handleToggleWaitlist}
                disabled={isTogglingWaitlist}
                title={isOpen ? "Waitlist is open — click to close" : "Waitlist is closed — click to open"}
                className={`px-4 py-2.5 rounded-xl border font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${
                  isOpen
                    ? "bg-amber-500/20 border-amber-500/40 text-amber-400 hover:bg-amber-500/30"
                    : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                }`}
              >
                {isTogglingWaitlist ? (
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : isOpen ? (
                  "Waitlist: Open"
                ) : (
                  "Waitlist: Closed"
                )}
              </button>
            );
          })()}
        </div>
      </div>

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

      {/* Add Ticket Form */}
      {showAddForm && (
        <div className="mb-6 bg-zinc-900 rounded-2xl border border-zinc-800 p-6">
          <h2 className="text-xl font-bold text-white mb-4">Add Tickets</h2>
          <p className="text-sm text-zinc-400 mb-4">
            Each row is one ticket. Name and email are required.
          </p>
          <form onSubmit={handleAddTicket} className="space-y-4">
            {/* Shared: Event + Type */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">
                  Event
                </label>
                <select
                  value={newTicketEventId}
                  onChange={(e) => setNewTicketEventId(e.target.value)}
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
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
                <label className="block text-sm font-medium text-zinc-300 mb-2">
                  Ticket Type
                </label>
                <select
                  value={newTicketType}
                  onChange={(e) => setNewTicketType(e.target.value)}
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                >
                  <option value="VIP">VIP</option>
                  <option value="STANDARD">STANDARD</option>
                  <option value="EXTERNAL">EXTERNAL</option>
                  <option value="WAITLIST">WAITLIST</option>
                </select>
              </div>
            </div>

            {/* Rows: Name + Email per ticket */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-300">
                  Attendees (one per row)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setNewTicketRows((prev) => [...prev, { name: "", email: "" }])
                  }
                  className="text-sm text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add row
                </button>
              </div>
              <div className="rounded-xl border border-zinc-700 overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-zinc-800/80 border-b border-zinc-700">
                      <th className="px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider w-[40%]">
                        Name
                      </th>
                      <th className="px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                        Email
                      </th>
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {newTicketRows.map((row, index) => (
                      <tr
                        key={index}
                        className="border-b border-zinc-800 last:border-0 bg-zinc-800/30"
                      >
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={row.name}
                            onChange={(e) => {
                              setNewTicketRows((prev) => {
                                const next = [...prev];
                                next[index] = { ...next[index], name: e.target.value };
                                return next;
                              });
                            }}
                            placeholder="Attendee name"
                            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 text-sm"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="email"
                            value={row.email}
                            onChange={(e) => {
                              setNewTicketRows((prev) => {
                                const next = [...prev];
                                next[index] = { ...next[index], email: e.target.value };
                                return next;
                              });
                            }}
                            placeholder="email@example.com"
                            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 text-sm"
                          />
                        </td>
                        <td className="px-2 py-2">
                          {newTicketRows.length > 1 ? (
                            <button
                              type="button"
                              onClick={() =>
                                setNewTicketRows((prev) =>
                                  prev.filter((_, i) => i !== index)
                                )
                              }
                              className="p-1.5 text-zinc-400 hover:text-red-400 rounded-lg hover:bg-zinc-700 transition-colors"
                              title="Remove row"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center gap-4 pt-4 border-t border-zinc-800">
              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  !newTicketRows.some(
                    (r) => r.email.trim() && r.name.trim()
                  )
                }
                className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg
                    className="w-5 h-5"
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
                )}
                Create{" "}
                {newTicketRows.filter(
                  (r) => r.email.trim() && r.name.trim()
                ).length || 0}{" "}
                ticket(s)
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setNewTicketRows([{ name: "", email: "" }]);
                  setNewTicketEventId("");
                  setNewTicketType("VIP");
                }}
                className="px-6 py-3 text-zinc-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            Filter by Event
          </label>
          <select
            value={selectedEventId}
            onChange={(e) => {
              setSelectedEventId(e.target.value);
              setOffset(0);
            }}
            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
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
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            Search by Name or Email
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email..."
            disabled={!selectedEventId}
            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            Ticket Type
          </label>
          <select
            value={ticketTypeFilter}
            onChange={(e) => {
              setTicketTypeFilter(e.target.value);
              setOffset(0);
            }}
            disabled={!selectedEventId}
            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">All Types</option>
            <option value="VIP">VIP</option>
            <option value="STANDARD">STANDARD</option>
            <option value="EXTERNAL">EXTERNAL</option>
            <option value="WAITLIST">WAITLIST</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">
            Scanned Status
          </label>
          <select
            value={scannedFilter}
            onChange={(e) => {
              setScannedFilter(e.target.value);
              setOffset(0);
            }}
            disabled={!selectedEventId}
            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">All Statuses</option>
            <option value="true">Scanned</option>
            <option value="false">Not Scanned</option>
          </select>
        </div>
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
              : search || ticketTypeFilter || scannedFilter
                ? "Try adjusting your filters"
                : "Create your first ticket to get started"}
          </p>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-800/50 border-b border-zinc-800">
                <tr>
                  <th className="px-3 sm:px-4 py-3 sm:py-4 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                    Event
                  </th>
                  <th className="px-3 sm:px-4 py-3 sm:py-4 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                    Name
                  </th>
                  <th className="px-3 sm:px-4 py-3 sm:py-4 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                    Email
                  </th>
                  <th className="px-3 sm:px-4 py-3 sm:py-4 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                    Type
                  </th>
                  <th className="hidden lg:table-cell px-3 sm:px-4 py-3 sm:py-4 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                    Created
                  </th>
                  <th className="px-3 sm:px-4 py-3 sm:py-4 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                    Status
                  </th>
                  <th className="px-3 sm:px-4 py-3 sm:py-4 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {tickets.map((ticket) => (
                  <tr
                    key={ticket.id}
                    className="hover:bg-zinc-800/30 transition-colors"
                  >
                    <td className="px-3 sm:px-4 py-3 sm:py-4 whitespace-nowrap max-w-[160px]">
                      <div className="text-sm font-medium text-white truncate" title={ticket.events?.name || "Unknown Event"}>
                        {ticket.events?.name || "Unknown Event"}
                      </div>
                    </td>
                    <td className="px-3 sm:px-4 py-3 sm:py-4 whitespace-nowrap">
                      {editingNameId === ticket.id ? (
                        <input
                          type="text"
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
                          className="w-full px-2 py-1 text-sm bg-zinc-800 border border-zinc-600 rounded text-white focus:outline-none focus:border-emerald-500/50 disabled:opacity-50"
                          placeholder="Enter name"
                        />
                      ) : (
                        <button
                          onClick={() => {
                            setEditingNameId(ticket.id);
                            setEditingNameValue(ticket.name || "");
                          }}
                          className="text-sm text-zinc-300 hover:text-white transition-colors cursor-pointer"
                          title="Click to edit name"
                        >
                          {ticket.name || "--"}
                        </button>
                      )}
                    </td>
                    <td className="px-3 sm:px-4 py-3 sm:py-4 whitespace-nowrap">
                      <div className="text-sm text-zinc-300">
                        {ticket.email}
                      </div>
                    </td>
                    <td className="px-3 sm:px-4 py-3 sm:py-4 whitespace-nowrap">
                      <select
                        value={ticket.type || "STANDARD"}
                        onChange={(e) => {
                          if (e.target.value !== ticket.type) {
                            handleUpdateType(ticket.id, e.target.value);
                          }
                        }}
                        disabled={updatingTicketId === ticket.id}
                        className={`px-2 py-1 text-xs font-medium rounded-lg bg-zinc-800 border border-zinc-700 text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed ${ticket.type === "VIP"
                          ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                          : ticket.type === "EXTERNAL"
                            ? "bg-green-500/20 text-green-400 border-green-500/30"
                            : ticket.type === "WAITLIST"
                              ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                              : ""
                          }`}
                      >
                        <option value="VIP">VIP</option>
                        <option value="STANDARD">STANDARD</option>
                        <option value="EXTERNAL">EXTERNAL</option>
                        <option value="WAITLIST">WAITLIST</option>
                      </select>
                    </td>
                    <td className="hidden lg:table-cell px-3 sm:px-4 py-3 sm:py-4 whitespace-nowrap">
                      <div className="text-sm text-zinc-400">
                        {formatDate(ticket.created_at)}
                      </div>
                    </td>
                    <td className="px-3 sm:px-4 py-3 sm:py-4 whitespace-nowrap">
                      <select
                        value={ticket.scanned ? "scanned" : "not-scanned"}
                        onChange={(e) => {
                          const newScanned = e.target.value === "scanned";
                          if (newScanned !== ticket.scanned) {
                            handleUpdateScanned(ticket.id, newScanned);
                          }
                        }}
                        disabled={updatingTicketId === ticket.id}
                        className={`px-2 py-1 text-xs font-medium rounded-lg bg-zinc-800 border border-zinc-700 text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed ${ticket.scanned
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                          : ""
                          }`}
                      >
                        <option value="scanned">Scanned</option>
                        <option value="not-scanned">Not Scanned</option>
                      </select>
                    </td>
                    <td className="px-3 sm:px-4 py-3 sm:py-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleResendEmail(ticket.id)}
                          disabled={resendingEmailId === ticket.id}
                          className="text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Resend email"
                        >
                          {resendingEmailId === ticket.id ? (
                            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <svg
                              className="w-5 h-5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                              />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={() =>
                            handleSendIndividualEarlyReminder(ticket.id)
                          }
                          disabled={sendingEarlyReminderId === ticket.id}
                          className="text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Send early reminder"
                        >
                          {sendingEarlyReminderId === ticket.id ? (
                            <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <svg
                              className="w-5 h-5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={() =>
                            handleSendIndividualReminder(ticket.id)
                          }
                          disabled={sendingReminderId === ticket.id}
                          className="text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Send day-of reminder"
                        >
                          {sendingReminderId === ticket.id ? (
                            <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <svg
                              className="w-5 h-5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                              />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={() => handleDelete(ticket.id)}
                          className="text-rose-400 hover:text-rose-300 transition-colors"
                          title="Delete ticket"
                        >
                          <svg
                            className="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {filteredCount > limit && (
            <div className="px-6 py-4 border-t border-zinc-800 flex items-center justify-between">
              <div className="text-sm text-zinc-400">
                Showing {offset + 1} to{" "}
                {Math.min(offset + limit, filteredCount)} of {filteredCount}{" "}
                tickets
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="px-4 py-2 bg-zinc-800 text-white rounded-lg text-sm font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setOffset(offset + limit)}
                  disabled={offset + limit >= filteredCount}
                  className="px-4 py-2 bg-zinc-800 text-white rounded-lg text-sm font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
