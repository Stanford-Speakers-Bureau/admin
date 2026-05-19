"use client";

import { useState } from "react";

export type Admin = {
  id: string;
  email: string;
  created_at: string;
};

export type Ban = {
  id: string;
  email: string;
  created_at: string;
};

export type Scanner = {
  id: string;
  email: string;
  created_at: string;
};

export type FeeWaiver = {
  id: string;
  email: string;
  created_at: string;
};

export type EmailSuppression = {
  id: string;
  email: string;
  created_at: string;
};

type AdminUsersClientProps = {
  initialAdmins: Admin[];
  initialBans: Ban[];
  initialFeeWaivers: FeeWaiver[];
  initialScanners: Scanner[];
  initialEmailSuppressions: EmailSuppression[];
};

export default function AdminUsersClient({
  initialAdmins,
  initialBans,
  initialFeeWaivers,
  initialScanners,
  initialEmailSuppressions,
}: AdminUsersClientProps) {
  const [admins, setAdmins] = useState<Admin[]>(initialAdmins);
  const [bans, setBans] = useState<Ban[]>(initialBans);
  const [feeWaivers, setFeeWaivers] = useState<FeeWaiver[]>(initialFeeWaivers);
  const [scanners, setScanners] = useState<Scanner[]>(initialScanners);
  const [emailSuppressions, setEmailSuppressions] = useState<EmailSuppression[]>(
    initialEmailSuppressions,
  );
  const [activeTab, setActiveTab] = useState<
    "admins" | "bans" | "feeWaivers" | "scanners" | "emailSuppressions"
  >("admins");
  const [newEmail, setNewEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleAddUser(
    type: "admin" | "ban" | "fee_waiver" | "scanner" | "email_suppression",
  ) {
    if (!newEmail.trim()) {
      setError("Please enter an email address");
      return;
    }

    const emails = newEmail
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e);
    const invalidEmails = emails.filter((e) => !e.includes("@"));

    if (invalidEmails.length > 0) {
      setError(`Invalid email(s): ${invalidEmails.join(", ")}`);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    const errors: string[] = [];
    let successCount = 0;

    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emails: emails.map((e) => e.toLowerCase()),
          type,
          action: "add",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to add");
        setIsSubmitting(false);
        return;
      }

      const createdUsers = (data.users ?? []) as Array<
        Admin | Ban | FeeWaiver | Scanner | EmailSuppression
      >;

      if (createdUsers.length > 0) {
        if (type === "admin") {
          setAdmins((prev) => [...(createdUsers as Admin[]), ...prev]);
        } else if (type === "fee_waiver") {
          setFeeWaivers((prev) => [...(createdUsers as FeeWaiver[]), ...prev]);
        } else if (type === "ban") {
          setBans((prev) => [...(createdUsers as Ban[]), ...prev]);
        } else if (type === "email_suppression") {
          setEmailSuppressions((prev) => [
            ...(createdUsers as EmailSuppression[]),
            ...prev,
          ]);
        } else {
          setScanners((prev) => [...(createdUsers as Scanner[]), ...prev]);
        }
      }

      successCount = createdUsers.length;

      const serverErrors = (data.errors ?? []) as Array<{
        email: string;
        error: string;
      }>;
      for (const e of serverErrors) {
        errors.push(`${e.email}: ${e.error}`);
      }
    } catch (err) {
      console.error("Failed to add users:", err);
      setError("Failed to add users. Please try again.");
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);

    if (errors.length > 0) {
      setError(errors.join("; "));
    }

    if (successCount > 0) {
      const typeLabel =
        type === "admin"
          ? "admin(s)"
          : type === "fee_waiver"
            ? "fee waiver user(s)"
          : type === "scanner"
            ? "scanner(s)"
          : type === "email_suppression"
            ? "suppressed email(s)"
            : "banned user(s)";
      const successMsg = `Successfully added ${successCount} ${typeLabel}`;
      setSuccess(
        errors.length > 0 ? `${successMsg}, but with errors` : successMsg,
      );
      if (errors.length === 0) {
        setNewEmail("");
      }
    }
  }

  async function handleClearAllFeeWaivers() {
    if (feeWaivers.length === 0) return;
    const confirmed = window.confirm(
      `Remove fee waiver from all ${feeWaivers.length} user(s)? This cannot be undone.`,
    );
    if (!confirmed) return;

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "fee_waiver", action: "clear_all" }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to clear fee waivers");
      } else {
        setFeeWaivers([]);
        setSuccess(`Cleared fee waiver from ${data.removed ?? 0} user(s)`);
      }
    } catch (err) {
      console.error("Failed to clear fee waivers:", err);
      setError("Failed to clear fee waivers. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRemoveUser(
    id: string,
    type: "admin" | "ban" | "fee_waiver" | "scanner" | "email_suppression",
  ) {
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, type, action: "remove" }),
      });

      if (response.ok) {
        if (type === "admin") {
          setAdmins((prev) => prev.filter((a) => a.id !== id));
        } else if (type === "fee_waiver") {
          setFeeWaivers((prev) => prev.filter((user) => user.id !== id));
        } else if (type === "ban") {
          setBans((prev) => prev.filter((b) => b.id !== id));
        } else if (type === "email_suppression") {
          setEmailSuppressions((prev) => prev.filter((s) => s.id !== id));
        } else {
          setScanners((prev) => prev.filter((s) => s.id !== id));
        }
        setSuccess(`Successfully removed user`);
      } else {
        const data = await response.json();
        setError(data.error || "Failed to remove user");
      }
    } catch (error) {
      console.error("Failed to remove user:", error);
      setError("Failed to remove user. Please try again.");
    }
  }

  return (
    <div className="px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
          User Management
        </h1>
        <p className="text-zinc-400">
          Manage admin access, scanners, fee waiver users, and banned users.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setActiveTab("admins")}
          className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-all ${
            activeTab === "admins"
              ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
              : "bg-zinc-900 text-zinc-400 border border-zinc-800 hover:border-zinc-700"
          }`}
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
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
          Admins ({admins.length})
        </button>
        <button
          onClick={() => setActiveTab("scanners")}
          className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-all ${
            activeTab === "scanners"
              ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
              : "bg-zinc-900 text-zinc-400 border border-zinc-800 hover:border-zinc-700"
          }`}
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
              d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
            />
          </svg>
          Scanners ({scanners.length})
        </button>
        <button
          onClick={() => setActiveTab("feeWaivers")}
          className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-all ${
            activeTab === "feeWaivers"
              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
              : "bg-zinc-900 text-zinc-400 border border-zinc-800 hover:border-zinc-700"
          }`}
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
              d="M12 9v3.75m0 3.75h.008v.008H12v-.008Zm7.938-2.25A9 9 0 1112 3a9 9 0 017.938 9.75Z"
            />
          </svg>
          Fee Waiver ({feeWaivers.length})
        </button>
        <button
          onClick={() => setActiveTab("bans")}
          className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-all ${
            activeTab === "bans"
              ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
              : "bg-zinc-900 text-zinc-400 border border-zinc-800 hover:border-zinc-700"
          }`}
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
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
          Banned Users ({bans.length})
        </button>
        <button
          onClick={() => setActiveTab("emailSuppressions")}
          className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-all ${
            activeTab === "emailSuppressions"
              ? "bg-zinc-500/20 text-zinc-200 border border-zinc-500/30"
              : "bg-zinc-900 text-zinc-400 border border-zinc-800 hover:border-zinc-700"
          }`}
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
          Email Suppression ({emailSuppressions.length})
        </button>
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

      {/* Add User Form */}
      <div className="mb-6 p-6 bg-zinc-900 rounded-xl border border-zinc-800">
        <h3 className="text-lg font-semibold text-white mb-4">
          {activeTab === "admins"
            ? "Add New Admin"
            : activeTab === "scanners"
              ? "Add New Scanner"
              : activeTab === "feeWaivers"
                ? "Add Fee Waiver User"
              : activeTab === "emailSuppressions"
                ? "Suppress Email Address"
              : "Ban a User"}
        </h3>
        <p className="text-zinc-500 text-sm mb-4">
          You can add multiple emails separated by commas.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
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
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            <input
              type="text"
              placeholder="Enter email addresses (comma separated)..."
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" &&
                handleAddUser(
                  activeTab === "admins"
                    ? "admin"
                    : activeTab === "scanners"
                      ? "scanner"
                      : activeTab === "feeWaivers"
                        ? "fee_waiver"
                      : activeTab === "emailSuppressions"
                        ? "email_suppression"
                      : "ban",
                )
              }
              className="w-full pl-12 pr-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/50"
            />
          </div>
          <button
            onClick={() =>
              handleAddUser(
                activeTab === "admins"
                  ? "admin"
                  : activeTab === "scanners"
                    ? "scanner"
                    : activeTab === "feeWaivers"
                      ? "fee_waiver"
                    : activeTab === "emailSuppressions"
                      ? "email_suppression"
                    : "ban",
              )
            }
            disabled={isSubmitting}
            className={`flex items-center justify-center gap-2 px-6 py-3 rounded-xl text:white font-medium transition-all disabled:opacity-50 ${
              activeTab === "admins"
                ? "bg-purple-500 hover:bg-purple-600"
                : activeTab === "scanners"
                  ? "bg-blue-500 hover:bg-blue-600"
                  : activeTab === "feeWaivers"
                    ? "bg-amber-500 hover:bg-amber-600"
                  : activeTab === "emailSuppressions"
                    ? "bg-zinc-600 hover:bg-zinc-500"
                  : "bg-rose-500 hover:bg-rose-600"
            }`}
          >
            {isSubmitting ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
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
                {activeTab === "admins"
                  ? "Add Admin"
                  : activeTab === "scanners"
                    ? "Add Scanner"
                    : activeTab === "feeWaivers"
                      ? "Add Fee Waiver"
                    : activeTab === "emailSuppressions"
                      ? "Suppress Email"
                    : "Ban User"}
              </>
            )}
          </button>
        </div>
      </div>

      {/* User List */}
      <div className="space-y-3">
        {activeTab === "admins" ? (
          admins.length === 0 ? (
            <div className="text-center py-12 bg-zinc-900/50 rounded-xl border border-zinc-800">
              <p className="text-zinc-400">No admins found</p>
            </div>
          ) : (
            admins.map((admin) => (
              <div
                key={admin.id}
                className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-purple-500/20 rounded-full flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-purple-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-medium">{admin.email}</p>
                    <p className="text-zinc-500 text-sm">
                      Added {new Date(admin.created_at).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" })}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveUser(admin.id, "admin")}
                  className="flex items-center gap-2 px-3 py-1.5 text-rose-400 hover:bg-rose-500/10 rounded text-sm transition-colors"
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
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  Remove
                </button>
              </div>
            ))
          )
        ) : activeTab === "scanners" ? (
          scanners.length === 0 ? (
            <div className="text-center py-12 bg-zinc-900/50 rounded-xl border border-zinc-800">
              <p className="text-zinc-400">No scanners found</p>
            </div>
          ) : (
            scanners.map((scanner) => (
              <div
                key={scanner.id}
                className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-blue-500/20 rounded-full flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-blue-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-medium">{scanner.email}</p>
                    <p className="text-zinc-500 text-sm">
                      Added {new Date(scanner.created_at).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" })}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveUser(scanner.id, "scanner")}
                  className="flex items-center gap-2 px-3 py-1.5 text-rose-400 hover:bg-rose-500/10 rounded text-sm transition-colors"
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
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  Remove
                </button>
              </div>
            ))
          )
        ) : activeTab === "feeWaivers" ? (
          feeWaivers.length === 0 ? (
            <div className="text-center py-12 bg-zinc-900/50 rounded-xl border border-zinc-800">
              <p className="text-zinc-400">No fee waiver users</p>
            </div>
          ) : (
            <>
              <div className="flex justify-end">
                <button
                  onClick={handleClearAllFeeWaivers}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
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
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  Clear All ({feeWaivers.length})
                </button>
              </div>
              {feeWaivers.map((feeWaiver) => (
              <div
                key={feeWaiver.id}
                className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-amber-500/20 rounded-full flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-amber-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v3.75m0 3.75h.008v.008H12v-.008Zm7.938-2.25A9 9 0 1112 3a9 9 0 017.938 9.75Z"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-medium">{feeWaiver.email}</p>
                    <p className="text-zinc-500 text-sm">
                      Marked ineligible{" "}
                      {new Date(feeWaiver.created_at).toLocaleDateString("en-US", {
                        timeZone: "America/Los_Angeles",
                      })}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveUser(feeWaiver.id, "fee_waiver")}
                  className="flex items-center gap-2 px-3 py-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded text-sm transition-colors"
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
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Remove Waiver
                </button>
              </div>
              ))}
            </>
          )
        ) : activeTab === "bans" ? (
          bans.length === 0 ? (
            <div className="text-center py-12 bg-zinc-900/50 rounded-xl border border-zinc-800">
              <p className="text-zinc-400">No banned users</p>
            </div>
          ) : (
            bans.map((ban) => (
            <div
              key={ban.id}
              className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-rose-500/20 rounded-full flex items-center justify-center">
                  <svg
                    className="w-5 h-5 text-rose-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-white font-medium">{ban.email}</p>
                  <p className="text-zinc-500 text-sm">
                    Banned {new Date(ban.created_at).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" })}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleRemoveUser(ban.id, "ban")}
                className="flex items-center gap-2 px-3 py-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded text-sm transition-colors"
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
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Unban
              </button>
            </div>
          ))
          )
        ) : emailSuppressions.length === 0 ? (
          <div className="text-center py-12 bg-zinc-900/50 rounded-xl border border-zinc-800">
            <p className="text-zinc-400">No suppressed emails</p>
          </div>
        ) : (
          emailSuppressions.map((suppression) => (
            <div
              key={suppression.id}
              className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-zinc-500/20 rounded-full flex items-center justify-center">
                  <svg
                    className="w-5 h-5 text-zinc-300"
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
                </div>
                <div>
                  <p className="text-white font-medium">{suppression.email}</p>
                  <p className="text-zinc-500 text-sm">
                    Suppressed{" "}
                    {new Date(suppression.created_at).toLocaleDateString(
                      "en-US",
                      { timeZone: "America/Los_Angeles" },
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={() =>
                  handleRemoveUser(suppression.id, "email_suppression")
                }
                className="flex items-center gap-2 px-3 py-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded text-sm transition-colors"
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
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Unsuppress
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
