"use client";

import { useEffect, useState } from "react";
import { useEventContext } from "@/app/EventContext";

type Notification = {
  id: string;
  email: string;
  created_at: string;
  hasTicket: boolean;
  hasProfile: boolean;
  displayName: string | null;
  affiliations: string[];
};

type EventData = {
  name: string | null;
  route: string | null;
  start_time_date: string | null;
  ticketing_date: string | null;
  ticketingOpen: boolean;
};

type NotifyResponse = {
  notifications?: Notification[];
  eventData?: EventData | null;
  error?: string;
};

/** Returns a duration from now to ticketing_date (e.g. "2 hours", "1 day"). */
function approxDurationUntil(ticketingDate: string): string {
  const d = new Date(ticketingDate);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const ms = d.getTime() - now;
  if (ms <= 0) return "a moment";
  const minutes = Math.round(ms / (60 * 1000));
  const hours = Math.round(ms / (60 * 60 * 1000));
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (minutes < 60) return minutes <= 1 ? "1 minute" : `${minutes} minutes`;
  if (hours < 24) return hours === 1 ? "1 hour" : `${hours} hours`;
  return days === 1 ? "1 day" : `${days} days`;
}

function formatAffiliationLabel(affiliation: string): string {
  return affiliation
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const AFFILIATION_STAT_ORDER = [
  "student",
  "faculty",
  "staff",
  "postdoc",
  "alum",
  "affiliate",
  "member",
  "employee",
] as const;

async function fetchNotificationsForEvent(eventId: string): Promise<NotifyResponse> {
  const response = await fetch(`/api/notify?eventId=${eventId}`);

  if (!response.ok) {
    let errorMessage = "Failed to fetch notifications";
    try {
      const errorData = await response.json() as NotifyResponse;
      errorMessage = errorData.error || errorMessage;
    } catch {
      errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    }
    throw new Error(errorMessage);
  }

  return response.json() as Promise<NotifyResponse>;
}

async function loadNotificationsForSelection(
  eventId: string | null,
  options: {
    setNotifications: (notifications: Notification[]) => void;
    setEventData: (eventData: EventData | null) => void;
    setIsLoading: (isLoading: boolean) => void;
    setError: (error: string | null) => void;
  },
) {
  const { setNotifications, setEventData, setIsLoading, setError } = options;

  if (!eventId) {
    setNotifications([]);
    setEventData(null);
    return;
  }

  setIsLoading(true);
  setError(null);

  try {
    const data = await fetchNotificationsForEvent(eventId);
    setNotifications(data.notifications || []);
    setEventData(data.eventData || null);
  } catch (err) {
    console.error("Error fetching notifications:", err);
    setError(err instanceof Error ? err.message : "Failed to load notifications");
  } finally {
    setIsLoading(false);
  }
}

export default function AdminNotifyClient() {
  const { events, selectedEventId } = useEventContext();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [eventData, setEventData] = useState<EventData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [affiliationFilter, setAffiliationFilter] = useState<string | null>(null);

  // Send email modal state
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendEmailSingleEmail, setSendEmailSingleEmail] = useState<string | null>(null);
  const [sendVariant, setSendVariant] = useState<"now" | "in" | "claim">("now");
  const [sendApproxTime, setSendApproxTime] = useState("");
  const [isSendingNotify, setIsSendingNotify] = useState(false);
  const [notifySuccess, setNotifySuccess] = useState<string | null>(null);
  const [notifyError, setNotifyError] = useState<string | null>(null);

  async function fetchNotifications() {
    await loadNotificationsForSelection(selectedEventId, {
      setNotifications,
      setEventData,
      setIsLoading,
      setError,
    });
  }

  useEffect(() => {
    void loadNotificationsForSelection(selectedEventId, {
      setNotifications,
      setEventData,
      setIsLoading,
      setError,
    });
  }, [selectedEventId]);

  function openSendEmailModal(singleEmail?: string) {
    setSendEmailSingleEmail(singleEmail ?? null);
    setSendVariant(eventData?.ticketingOpen ? "claim" : "now");
    setSendApproxTime(
      eventData?.ticketing_date ? approxDurationUntil(eventData.ticketing_date) : "",
    );
    setNotifySuccess(null);
    setNotifyError(null);
    setShowSendModal(true);
  }

  function closeSendEmailModal() {
    setShowSendModal(false);
    setSendEmailSingleEmail(null);
    setSendApproxTime("");
    setNotifyError(null);
  }

  async function handleSendNotifyEmails() {
    if (!selectedEventId) return;
    if (sendVariant === "in" && !sendApproxTime.trim()) {
      setNotifyError("Please enter when tickets will be available.");
      return;
    }
    const eventName = eventData?.name || "this event";

    let recipientCount: number;
    if (sendEmailSingleEmail) {
      recipientCount = 1;
    } else if (sendVariant === "claim") {
      recipientCount = notifications.filter((n) => !n.hasTicket).length;
    } else {
      recipientCount = notifications.length;
    }
    if (recipientCount === 0) {
      setNotifyError(
        sendVariant === "claim"
          ? "No recipients without tickets to send to."
          : "No recipients to send to.",
      );
      return;
    }

    const variantLabel =
      sendVariant === "claim"
        ? "Claim your ticket"
        : sendVariant === "now"
          ? "Tickets available now"
          : `Tickets available in ${sendApproxTime.trim()}`;
    const confirmMessage = sendEmailSingleEmail
      ? `Send "${variantLabel}" email to ${sendEmailSingleEmail} for ${eventName}?`
      : `Send "${variantLabel}" email to ${recipientCount} ${sendVariant === "claim" ? "people without tickets" : "people on the list"} for ${eventName}?`;
    if (!confirm(confirmMessage)) return;

    setIsSendingNotify(true);
    setNotifyError(null);
    setNotifySuccess(null);

    try {
      const res = await fetch("/api/notify/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: selectedEventId,
          variant: sendVariant,
          ...(sendVariant === "in" && { approxTimeUntilAvailable: sendApproxTime.trim() }),
          ...(sendEmailSingleEmail && { singleEmail: sendEmailSingleEmail }),
        }),
      });
      const data = (await res.json()) as { error?: string; sent?: number; failed?: number; skipped?: number };

      if (!res.ok) {
        throw new Error(data.error || "Failed to send emails");
      }
      const { sent = 0, failed = 0, skipped = 0 } = data;
      const skippedMsg = skipped > 0 ? `, ${skipped} skipped (already have ticket)` : "";
      if (sendEmailSingleEmail) {
        if (failed > 0) {
          setNotifyError("Failed to send email.");
        } else {
          setNotifySuccess("Email sent.");
          setTimeout(closeSendEmailModal, 1500);
        }
      } else {
        setNotifySuccess(`Emails sent: ${sent} sent, ${failed} failed${skippedMsg}.`);
        if (sent > 0 && failed === 0) {
          setTimeout(closeSendEmailModal, 1500);
        }
      }
    } catch (err) {
      setNotifyError(err instanceof Error ? err.message : "Failed to send emails");
    } finally {
      setIsSendingNotify(false);
    }
  }

  function exportToCSV() {
    const csv = [
      "Email,Affiliations,Has Profile,Has Ticket,Signup Date",
      ...notifications.map(
        (n) =>
          `${n.email},"${n.affiliations.map(formatAffiliationLabel).join("; ")}",${n.hasProfile ? "Yes" : "No"},${n.hasTicket ? "Yes" : "No"},${new Date(n.created_at).toISOString()}`,
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${eventData?.name || "event"}-notifications.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const selectedEvent = events.find((e) => e.id === selectedEventId);

  const filtered = notifications.filter((n) => {
    if (affiliationFilter) {
      if (affiliationFilter === "missing") {
        if (n.affiliations.length > 0) return false;
      } else {
        if (!n.affiliations.some((a) => a === affiliationFilter)) return false;
      }
    }
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      if (
        !(n.displayName?.toLowerCase().includes(lower) ?? false) &&
        !n.email.toLowerCase().includes(lower) &&
        !n.affiliations.some((affiliation) =>
          formatAffiliationLabel(affiliation).toLowerCase().includes(lower) ||
          affiliation.toLowerCase().includes(lower),
        )
      ) return false;
    }
    return true;
  });

  const affiliationCounts = new Map<string, number>();
  let missingAffiliationCount = 0;

  for (const notification of notifications) {
    if (notification.affiliations.length === 0) {
      missingAffiliationCount += 1;
      continue;
    }

    for (const affiliation of notification.affiliations) {
      affiliationCounts.set(
        affiliation,
        (affiliationCounts.get(affiliation) ?? 0) + 1,
      );
    }
  }

  const preferredAffiliationStats = AFFILIATION_STAT_ORDER
    .filter((affiliation) => (affiliationCounts.get(affiliation) ?? 0) > 0)
    .map((affiliation) => ({
      key: affiliation,
      label: formatAffiliationLabel(affiliation),
      value: affiliationCounts.get(affiliation) ?? 0,
    }));

  const additionalAffiliationStats = [...affiliationCounts.entries()]
    .filter(([affiliation]) => !AFFILIATION_STAT_ORDER.includes(
      affiliation as (typeof AFFILIATION_STAT_ORDER)[number],
    ))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([affiliation, value]) => ({
      key: affiliation,
      label: formatAffiliationLabel(affiliation),
      value,
    }));

  const statCards = [
    {
      key: "total",
      label: "Total Signups",
      value: notifications.length,
      tone: "text-blue-400",
    },
    {
      key: "missing",
      label: "Missing Affiliation",
      value: missingAffiliationCount,
      tone: "text-amber-400",
    },
  ];

  return (
    <div className="px-4 sm:px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
            Notification Signups
          </h1>
          <p className="text-zinc-400">
            View users who signed up for event notifications.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {selectedEventId && notifications.length > 0 && (
            <>
              <button
                onClick={() => openSendEmailModal()}
                className="flex items-center gap-2 px-5 py-2.5 bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl font-medium hover:bg-rose-500/30 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Send Email
              </button>
              <button
                onClick={exportToCSV}
                className="flex items-center gap-2 px-5 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl font-medium hover:bg-zinc-700 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export CSV
              </button>
            </>
          )}
          <button
            onClick={fetchNotifications}
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
      </div>

      {error && (
        <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-3">
          <svg className="w-5 h-5 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-rose-400 text-sm">{error}</p>
        </div>
      )}

      {!selectedEventId ? (
        <div className="text-center py-16 bg-zinc-900/50 rounded-2xl border border-zinc-800">
          <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </div>
          <p className="text-zinc-400 text-lg mb-2">No event selected</p>
          <p className="text-zinc-600 text-sm">
            Select an event from the sidebar to view its notification signups
          </p>
        </div>
      ) : isLoading ? (
        <div className="text-center py-16 bg-zinc-900/50 rounded-2xl border border-zinc-800">
          <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <div className="w-8 h-8 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
          </div>
          <p className="text-zinc-400">Loading notifications...</p>
        </div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-16 bg-zinc-900/50 rounded-2xl border border-zinc-800">
          <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </div>
          <p className="text-zinc-400 text-lg mb-2">No notification signups</p>
          <p className="text-zinc-600 text-sm">
            No signups for {selectedEvent?.name || "this event"} yet
          </p>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          <div className="p-6 border-b border-zinc-800">
            <div className="flex flex-col gap-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {statCards.map((stat) => (
                  <div
                    key={stat.key}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                      {stat.label}
                    </p>
                    <p className={`mt-2 text-2xl font-bold ${stat.tone}`}>
                      {stat.value}
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  {[...preferredAffiliationStats, ...additionalAffiliationStats].map((stat) => {
                    const isActive = affiliationFilter === stat.key;
                    return (
                      <button
                        key={stat.key}
                        type="button"
                        onClick={() => setAffiliationFilter(isActive ? null : stat.key)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                          isActive
                            ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                            : "bg-zinc-800 text-zinc-300 border border-zinc-700 hover:border-zinc-500"
                        }`}
                      >
                        {stat.label}
                        <span className={isActive ? "text-rose-400/70" : "text-zinc-500"}>
                          {stat.value}
                        </span>
                      </button>
                    );
                  })}
                  {missingAffiliationCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setAffiliationFilter(affiliationFilter === "missing" ? null : "missing")}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                        affiliationFilter === "missing"
                          ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                          : "bg-zinc-800 text-zinc-300 border border-zinc-700 hover:border-zinc-500"
                      }`}
                    >
                      Missing
                      <span className={affiliationFilter === "missing" ? "text-rose-400/70" : "text-zinc-500"}>
                        {missingAffiliationCount}
                      </span>
                    </button>
                  )}
                  {affiliationFilter && (
                    <button
                      type="button"
                      onClick={() => setAffiliationFilter(null)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Clear
                    </button>
                  )}
                </div>
                <div className="relative">
                  <svg
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search name, email, or affiliation..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 pr-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500/50 text-sm w-full lg:w-72"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-800/50">
                  <th className="text-left px-6 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                    Affiliation
                  </th>
                  {eventData?.ticketingOpen && (
                    <th className="text-left px-6 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                      Ticket
                    </th>
                  )}
                  <th className="text-left px-6 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                    Signed Up
                  </th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider w-20">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {filtered.map((notification) => (
                  <tr
                    key={notification.id}
                    className="hover:bg-zinc-800/30 transition-colors"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-white font-medium">
                      {notification.displayName || <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-white font-medium">
                      {notification.email}
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-300">
                      {notification.affiliations.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {notification.affiliations.map((affiliation) => (
                            <span
                              key={`${notification.id}-${affiliation}`}
                              className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200"
                            >
                              {formatAffiliationLabel(affiliation)}
                            </span>
                          ))}
                        </div>
                      ) : notification.hasProfile ? (
                        <span className="text-zinc-500">No affiliation provided</span>
                      ) : (
                        <span className="text-zinc-500">
                          Unavailable for backfilled signup
                        </span>
                      )}
                    </td>
                    {eventData?.ticketingOpen && (
                      <td className="px-6 py-4 whitespace-nowrap">
                        {notification.hasTicket ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Has ticket
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            No ticket
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-6 py-4 whitespace-nowrap text-zinc-400 text-sm">
                      {new Date(notification.created_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      {!(eventData?.ticketingOpen && notification.hasTicket) && (
                        <button
                          type="button"
                          onClick={() => openSendEmailModal(notification.email)}
                          className="text-blue-400 hover:text-blue-300 transition-colors"
                          title="Send email to this person"
                        >
                          <svg className="w-5 h-5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Send email modal */}
      {showSendModal && (() => {
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeSendEmailModal();
            }}
          >
            <div
              className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-white mb-1">
                Send email
              </h3>
              <p className="text-zinc-500 text-sm mb-4">
                {eventData?.name || "Event"}
                {sendEmailSingleEmail ? (
                  <> &rarr; {sendEmailSingleEmail}</>
                ) : (
                  <> &rarr; all {notifications.length} on list</>
                )}
              </p>
              <div className="space-y-3 mb-4">
                {eventData?.ticketingOpen && !sendEmailSingleEmail && (
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="variant"
                      checked={sendVariant === "claim"}
                      onChange={() => setSendVariant("claim")}
                      className="rounded-full border-zinc-600 text-rose-500 focus:ring-rose-500"
                    />
                    <div>
                      <span className="text-white">Claim your ticket</span>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Only sent to {notifications.filter((n) => !n.hasTicket).length} people without tickets
                      </p>
                    </div>
                  </label>
                )}
                {eventData?.ticketingOpen && sendEmailSingleEmail && (
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="variant"
                      checked={sendVariant === "claim"}
                      onChange={() => setSendVariant("claim")}
                      className="rounded-full border-zinc-600 text-rose-500 focus:ring-rose-500"
                    />
                    <span className="text-white">Claim your ticket</span>
                  </label>
                )}
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="variant"
                    checked={sendVariant === "now"}
                    onChange={() => setSendVariant("now")}
                    className="rounded-full border-zinc-600 text-rose-500 focus:ring-rose-500"
                  />
                  <span className="text-white">Tickets available now</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="variant"
                    checked={sendVariant === "in"}
                    onChange={() => setSendVariant("in")}
                    className="rounded-full border-zinc-600 text-rose-500 focus:ring-rose-500"
                  />
                  <span className="text-white">
                    Tickets available in (approx time)
                  </span>
                </label>
                {sendVariant === "in" && (
                  <input
                    type="text"
                    value={sendApproxTime}
                    onChange={(e) => setSendApproxTime(e.target.value)}
                    placeholder="e.g. 2 hours, or Mon Feb 17 at 10am PT"
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500/50 text-sm ml-6"
                  />
                )}
              </div>
              {notifyError && (
                <p className="text-rose-400 text-sm mb-3">{notifyError}</p>
              )}
              {notifySuccess && (
                <p className="text-emerald-400 text-sm mb-3">{notifySuccess}</p>
              )}
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={closeSendEmailModal}
                  disabled={isSendingNotify}
                  className="px-4 py-2 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSendNotifyEmails}
                  disabled={
                    isSendingNotify ||
                    (sendVariant === "in" && !sendApproxTime.trim())
                  }
                  className="px-4 py-2 rounded-lg bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isSendingNotify ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Sending…
                    </>
                  ) : (
                    "Send"
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
