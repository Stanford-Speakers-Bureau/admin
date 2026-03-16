"use client";

import { useEffect, useState } from "react";
import { PACIFIC_TIMEZONE } from "@/app/lib/constants";
import { useEventContext } from "@/app/EventContext";

type WaitlistEntry = {
  id: string;
  email: string;
  name: string | null;
  referral: string | null;
  position: number;
  created_at: string;
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

export default function WaitlistViewerClient() {
  const { events, selectedEventId, updateEvent } = useEventContext();
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [showStandbyConfirm, setShowStandbyConfirm] = useState(false);
  const [isSendingEmails, setIsSendingEmails] = useState(false);
  const [isTogglingStandby, setIsTogglingStandby] = useState(false);
  const [standbyOpenTime, setStandbyOpenTime] = useState("7:30 PM");
  const [expectedCapacity, setExpectedCapacity] = useState("100-200");
  const [notifySuccess, setNotifySuccess] = useState<string | null>(null);
  const [notifyError, setNotifyError] = useState<string | null>(null);

  const selectedEvent = events.find((e) => e.id === selectedEventId);
  const isStandbyMode = selectedEvent?.standbyEnabled ?? false;

  async function fetchWaitlist() {
    if (!selectedEventId) {
      setWaitlist([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.append("eventId", selectedEventId);

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
      setWaitlist(data.waitlist || []);
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

  async function handleToggleStandby(enable: boolean) {
    if (!selectedEventId) return;

    setIsTogglingStandby(true);
    setNotifyError(null);
    setNotifySuccess(null);

    try {
      const response = await fetch("/api/events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedEventId, standbyEnabled: enable }),
      });

      if (!response.ok) {
        let errorMessage = "Failed to toggle standby mode";
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      updateEvent(selectedEventId, { standbyEnabled: enable });
      setNotifySuccess(enable ? "Standby line enabled." : "Standby line disabled.");
    } catch (err) {
      console.error("Error toggling standby mode:", err);
      setNotifyError(err instanceof Error ? err.message : "Failed to toggle standby mode");
    } finally {
      setIsTogglingStandby(false);
      setShowStandbyConfirm(false);
    }
  }

  async function handleSendStandbyEmails() {
    if (!selectedEventId) {
      setNotifyError("Please select an event first");
      return;
    }

    setIsSendingEmails(true);
    setNotifyError(null);
    setNotifySuccess(null);

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventId: selectedEventId,
          waitlistOpenTime: standbyOpenTime,
          expectedCapacity,
        }),
      });

      if (!response.ok) {
        let errorMessage = "Failed to send standby emails";
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setNotifySuccess(
        `Successfully sent ${data.emailsSent} email${data.emailsSent !== 1 ? "s" : ""} to waitlist entries${data.errors > 0 ? ` (${data.errors} failed)` : ""}`,
      );
      setShowSendDialog(false);
      fetchWaitlist();
    } catch (err) {
      console.error("Error sending standby emails:", err);
      setNotifyError(
        err instanceof Error ? err.message : "Failed to send emails",
      );
    } finally {
      setIsSendingEmails(false);
    }
  }

  return (
    <div className="px-4 sm:px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
            Waitlist Management
          </h1>
          <p className="text-zinc-400">
            View and manage event waitlist entries
          </p>
        </div>
        <div className="flex items-center gap-3">
          {selectedEventId && (
            <>
              {/* Standby Line Toggle */}
              <button
                onClick={() => {
                  if (isStandbyMode) {
                    handleToggleStandby(false);
                  } else {
                    setShowStandbyConfirm(true);
                  }
                }}
                disabled={isTogglingStandby}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 shrink-0 ${
                  isStandbyMode
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                }`}
              >
                {isTogglingStandby ? (
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <div className={`w-8 h-5 rounded-full relative transition-colors ${isStandbyMode ? "bg-emerald-400" : "bg-zinc-600"}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isStandbyMode ? "translate-x-3.5" : "translate-x-0.5"}`} />
                  </div>
                )}
                Standby Line
              </button>

              {/* Send Standby Emails — only when standby is ON and entries exist */}
              {isStandbyMode && waitlist.length > 0 && (
                <button
                  onClick={() => setShowSendDialog(true)}
                  disabled={isLoading || isSendingEmails}
                  className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 shrink-0"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Send Standby Emails
                </button>
              )}
            </>
          )}
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

      {notifySuccess && (
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
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-emerald-400 text-sm">{notifySuccess}</p>
        </div>
      )}

      {notifyError && (
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
          <p className="text-rose-400 text-sm">{notifyError}</p>
        </div>
      )}

      {!selectedEventId ? (
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
          <p className="text-zinc-400 text-lg mb-2">No event selected</p>
          <p className="text-zinc-600 text-sm">
            Select an event from the sidebar to view its waitlist
          </p>
        </div>
      ) : isLoading ? (
        <div className="text-center py-16 bg-zinc-900/50 rounded-2xl border border-zinc-800">
          <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <div className="w-8 h-8 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
          </div>
          <p className="text-zinc-400">Loading waitlist...</p>
        </div>
      ) : waitlist.length === 0 ? (
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
            No waitlist entries for {selectedEvent?.name || "this event"}
          </p>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          <div className="p-6 border-b border-zinc-800">
            <div className="flex items-center gap-4 text-sm text-zinc-400">
              <span>
                Total Entries:{" "}
                <span className="text-emerald-400 font-semibold">
                  {waitlist.length}
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
                    Name
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
                {waitlist.map((entry, index) => (
                  <tr
                    key={entry.id}
                    className="hover:bg-zinc-800/30 transition-colors"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-zinc-800 text-white font-semibold text-sm">
                        {index + 1}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-white">
                      {entry.name || "\u2014"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-white font-medium">
                      {entry.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-zinc-400">
                      {entry.referral || "\u2014"}
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

      {/* Standby Enable Confirmation Dialog */}
      {showStandbyConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6 max-w-md w-full">
            <h2 className="text-xl font-bold text-white mb-4">
              Enable Standby Line?
            </h2>
            <p className="text-zinc-400 mb-6">
              This closes the online waitlist and shows the standby ticket option on the event page.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowStandbyConfirm(false)}
                disabled={isTogglingStandby}
                className="flex-1 px-4 py-2 bg-zinc-800 text-white rounded-lg font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleToggleStandby(true)}
                disabled={isTogglingStandby}
                className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isTogglingStandby ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Enabling...
                  </>
                ) : (
                  "Enable"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send Standby Emails Dialog */}
      {showSendDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6 max-w-md w-full">
            <h2 className="text-xl font-bold text-white mb-4">
              Send Standby Emails
            </h2>
            <p className="text-zinc-400 mb-6">
              This will send standby line emails to all waitlist entries for the
              selected event, converting them to standby tickets.
            </p>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">
                  Standby Line Open Time
                </label>
                <input
                  type="text"
                  value={standbyOpenTime}
                  onChange={(e) => setStandbyOpenTime(e.target.value)}
                  placeholder="7:30 PM"
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">
                  Expected Capacity
                </label>
                <input
                  type="text"
                  value={expectedCapacity}
                  onChange={(e) => setExpectedCapacity(e.target.value)}
                  placeholder="100-200"
                  className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setShowSendDialog(false);
                  setNotifyError(null);
                  setNotifySuccess(null);
                }}
                disabled={isSendingEmails}
                className="flex-1 px-4 py-2 bg-zinc-800 text-white rounded-lg font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSendStandbyEmails()}
                disabled={isSendingEmails}
                className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSendingEmails ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Send Emails"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
