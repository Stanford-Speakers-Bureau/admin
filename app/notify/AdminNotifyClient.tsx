"use client";

import { useState } from "react";

export type EventWithNotifications = {
  id: string;
  name: string | null;
  start_time_date: string | null;
  route?: string | null;
  ticketing_date?: string | null;
  notifications: {
    id: string;
    email: string;
    created_at: string;
  }[];
};

type AdminNotifyClientProps = {
  initialEvents: EventWithNotifications[];
};

/** Returns a duration from now to ticketing_date for "available in approximately X" (e.g. "2 hours", "1 day"). */
function approxDurationUntil(ticketingDate: string): string {
  const d = new Date(ticketingDate);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const ms = d.getTime() - now;
  if (ms <= 0) return "a moment"; // already passed
  const minutes = Math.round(ms / (60 * 1000));
  const hours = Math.round(ms / (60 * 60 * 1000));
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (minutes < 60) return minutes <= 1 ? "1 minute" : `${minutes} minutes`;
  if (hours < 24) return hours === 1 ? "1 hour" : `${hours} hours`;
  return days === 1 ? "1 day" : `${days} days`;
}

export default function AdminNotifyClient({
  initialEvents,
}: AdminNotifyClientProps) {
  const [events, setEvents] = useState<EventWithNotifications[]>(initialEvents);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sendEmailEventId, setSendEmailEventId] = useState<string | null>(null);
  const [sendEmailSingleEmail, setSendEmailSingleEmail] = useState<string | null>(null);
  const [sendVariant, setSendVariant] = useState<"now" | "in">("now");
  const [sendApproxTime, setSendApproxTime] = useState("");
  const [isSendingNotify, setIsSendingNotify] = useState(false);
  const [notifySuccess, setNotifySuccess] = useState<string | null>(null);
  const [notifyError, setNotifyError] = useState<string | null>(null);

  function exportToCSV(event: EventWithNotifications) {
    const csv = [
      "Email,Signup Date",
      ...event.notifications.map(
        (n) => `${n.email},${new Date(n.created_at).toISOString()}`,
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${event.name || "event"}-notifications.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openSendEmailModal(event: EventWithNotifications, singleEmail?: string) {
    setSendEmailEventId(event.id);
    setSendEmailSingleEmail(singleEmail ?? null);
    setSendVariant("now");
    setSendApproxTime(
      event.ticketing_date ? approxDurationUntil(event.ticketing_date) : "",
    );
    setNotifySuccess(null);
    setNotifyError(null);
  }

  function closeSendEmailModal() {
    setSendEmailEventId(null);
    setSendEmailSingleEmail(null);
    setSendApproxTime("");
    setNotifyError(null);
  }

  async function handleSendNotifyEmails() {
    if (!sendEmailEventId) return;
    if (sendVariant === "in" && !sendApproxTime.trim()) {
      setNotifyError("Please enter when tickets will be available.");
      return;
    }
    const event = events.find((e) => e.id === sendEmailEventId);
    const eventName = event?.name || "this event";
    const recipientCount = sendEmailSingleEmail ? 1 : (event?.notifications.length ?? 0);
    if (recipientCount === 0) {
      setNotifyError("No recipients to send to.");
      return;
    }
    const confirmMessage = sendEmailSingleEmail
      ? `Send "${sendVariant === "now" ? "Tickets available now" : `Tickets available in ${sendApproxTime.trim()}`}" email to ${sendEmailSingleEmail} for ${eventName}?`
      : `Send "${sendVariant === "now" ? "Tickets available now" : `Tickets available in ${sendApproxTime.trim()}`}" email to all ${recipientCount} people on the list for ${eventName}?`;
    if (!confirm(confirmMessage)) return;

    setIsSendingNotify(true);
    setNotifyError(null);
    setNotifySuccess(null);

    try {
      const res = await fetch("/api/notify/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: sendEmailEventId,
          variant: sendVariant,
          ...(sendVariant === "in" && { approxTimeUntilAvailable: sendApproxTime.trim() }),
          ...(sendEmailSingleEmail && { singleEmail: sendEmailSingleEmail }),
        }),
      });
      const data = (await res.json()) as { error?: string; sent?: number; failed?: number };

      if (!res.ok) {
        throw new Error(data.error || "Failed to send emails");
      }
      const { sent = 0, failed = 0 } = data;
      setNotifySuccess(
        sendEmailSingleEmail
          ? "Email sent."
          : `Emails sent: ${sent} sent, ${failed} failed.`,
      );
      if (sent > 0 && failed === 0) {
        setTimeout(closeSendEmailModal, 1500);
      }
    } catch (err) {
      setNotifyError(err instanceof Error ? err.message : "Failed to send emails");
    } finally {
      setIsSendingNotify(false);
    }
  }

  const filteredEvents = events.filter((event) => {
    const term = searchTerm.toLowerCase();
    const nameMatch = event.name?.toLowerCase().includes(term);
    const emailMatch = event.notifications.some((n) =>
      n.email.toLowerCase().includes(term),
    );
    return nameMatch || emailMatch;
  });

  const totalSignups = events.reduce(
    (acc, e) => acc + e.notifications.length,
    0,
  );

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
          Notification Signups
        </h1>
        <p className="text-zinc-400">
          View users who signed up for event notifications.
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <svg
          className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          placeholder="Search by event name or email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/50"
        />
      </div>

      {filteredEvents.length === 0 ? (
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
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
              />
            </svg>
          </div>
          <p className="text-zinc-400 text-lg mb-1">
            No notification signups found
          </p>
          <p className="text-zinc-600 text-sm">
            {searchTerm
              ? "Try a different search term."
              : "No users have signed up for notifications yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredEvents.map((event) => (
            <div
              key={event.id}
              className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden"
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() =>
                  setExpandedEvent(expandedEvent === event.id ? null : event.id)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setExpandedEvent(
                      expandedEvent === event.id ? null : event.id,
                    );
                  }
                }}
                className="w-full p-6 flex items-center justify-between hover:bg-zinc-800/50 transition-colors cursor-pointer"
              >
                <div className="text-left">
                  <h3 className="text-lg font-semibold text-white mb-1">
                    {event.name || "Mystery Speaker"}
                  </h3>
                  <div className="flex items-center gap-4 text-sm text-zinc-500">
                    <span className="flex items-center gap-1.5">
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
                          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                      {(() => {
                        const startDateStr = event.start_time_date;
                        return startDateStr != null
                          ? new Date(startDateStr).toLocaleDateString()
                          : "TBD";
                      })()}
                    </span>
                    <span className="flex items-center gap-1.5">
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
                          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                        />
                      </svg>
                      {event.notifications.length} signups
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {event.notifications.length > 0 && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openSendEmailModal(event);
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded text-sm hover:bg-rose-500/30 transition-colors"
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
                            d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                          />
                        </svg>
                        Send email
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          exportToCSV(event);
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded text-sm hover:bg-zinc-700 transition-colors"
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
                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                          />
                        </svg>
                        Export CSV
                      </button>
                    </>
                  )}
                  <svg
                    className={`w-5 h-5 text-zinc-500 transition-transform ${
                      expandedEvent === event.id ? "rotate-180" : ""
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
                </div>
              </div>

              {expandedEvent === event.id && event.notifications.length > 0 && (
                <div className="border-t border-zinc-800 p-4">
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full">
                      <thead className="text-left text-sm text-zinc-500 border-b border-zinc-800">
                        <tr>
                          <th className="pb-3 font-medium">Email</th>
                          <th className="pb-3 font-medium">Signed Up</th>
                          <th className="pb-3 font-medium w-20 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/50">
                        {event.notifications.map((notification) => (
                          <tr key={notification.id} className="text-sm">
                            <td className="py-3 text-white">
                              {notification.email}
                            </td>
                            <td className="py-3 text-zinc-500">
                              {new Date(
                                notification.created_at,
                              ).toLocaleString()}
                            </td>
                            <td className="py-3 text-right">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openSendEmailModal(event, notification.email);
                                }}
                                className="text-blue-400 hover:text-blue-300 transition-colors"
                                title="Send email to this person"
                              >
                                <svg
                                  className="w-5 h-5 inline"
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
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {expandedEvent === event.id &&
                event.notifications.length === 0 && (
                  <div className="border-t border-zinc-800 p-8 text-center">
                    <p className="text-zinc-500">
                      No signups for this event yet.
                    </p>
                  </div>
                )}
            </div>
          ))}
        </div>
      )}

      {/* Stats Summary */}
      {events.length > 0 && (
        <div className="mt-8 p-6 bg-zinc-900/50 rounded-xl border border-zinc-800">
          <h3 className="text-lg font-semibold text-white mb-4">Summary</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-zinc-500 text-sm">Total Events</p>
              <p className="text-2xl font-bold text-white">{events.length}</p>
            </div>
            <div>
              <p className="text-zinc-500 text-sm">Total Signups</p>
              <p className="text-2xl font-bold text-blue-400">{totalSignups}</p>
            </div>
            <div>
              <p className="text-zinc-500 text-sm">Avg per Event</p>
              <p className="text-2xl font-bold text-emerald-400">
                {(totalSignups / events.length || 0).toFixed(1)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Send email modal */}
      {sendEmailEventId && (() => {
        const event = events.find((e) => e.id === sendEmailEventId);
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
                {event?.name || "Event"}
                {sendEmailSingleEmail ? (
                  <> → {sendEmailSingleEmail}</>
                ) : (
                  <> → all {event?.notifications.length ?? 0} on list</>
                )}
              </p>
              <div className="space-y-3 mb-4">
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
