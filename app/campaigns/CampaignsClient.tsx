"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AUDIENCE_TYPE_LABELS } from "@/app/lib/campaignAudienceConfig";

type Campaign = {
  id: string;
  subject: string;
  status: string;
  audiences: string;
  eventId: string | null;
  eventName: string | null;
  includeHeroCard: boolean;
  sentAt: string | null;
  sentBy: string | null;
  recipientCount: number | null;
  failedCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "sent"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
      : status === "partial"
        ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
      : status === "sending"
        ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
        : "bg-zinc-700/30 text-zinc-400 border-zinc-600/30";

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles}`}
    >
      {status === "sending" && (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mr-1.5 animate-pulse" />
      )}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

export default function CampaignsClient() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/campaigns")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setCampaigns(data.campaigns ?? []);
        }
      })
      .catch(() => setError("Failed to load campaigns"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white font-serif">
            Email Campaigns
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Create and send mass emails to your audience
            {campaigns.length > 0 && (
              <span className="text-zinc-600"> · {campaigns.length} total</span>
            )}
          </p>
        </div>
        <button
          onClick={() => router.push("/campaigns/new")}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:opacity-90 transition-opacity"
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
              d="M12 4v16m8-8H4"
            />
          </svg>
          New Campaign
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 px-4 py-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-3">
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

      {/* Loading */}
      {loading ? (
        <div className="text-center py-16">
          <div className="w-8 h-8 border-2 border-zinc-600 border-t-emerald-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-zinc-500 text-sm">Loading campaigns...</p>
        </div>
      ) : campaigns.length === 0 ? (
        /* Empty state */
        <div className="text-center py-16 bg-zinc-900/50 rounded-2xl border border-zinc-800">
          <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-zinc-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h3 className="text-white font-medium mb-1">No campaigns yet</h3>
          <p className="text-zinc-500 text-sm mb-4">
            Create your first email campaign to get started.
          </p>
          <button
            onClick={() => router.push("/campaigns/new")}
            className="px-5 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:opacity-90 transition-opacity"
          >
            Create Campaign
          </button>
        </div>
      ) : (
        /* Campaign table */
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-zinc-800/50 border-b border-zinc-800">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    Subject
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    Audience
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    Recipients
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => router.push(`/campaigns/${c.id}`)}
                    className="border-b border-zinc-800 last:border-0 hover:bg-zinc-800/40 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="text-sm text-white font-medium truncate max-w-xs">
                        {c.subject || "Untitled"}
                      </div>
                      {c.eventName && (
                        <div className="text-xs text-zinc-500 mt-0.5 truncate max-w-xs">
                          {c.eventName}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-400">
                      {(() => {
                        try {
                          const entries = JSON.parse(c.audiences || "[]") as { type: string }[];
                          return entries
                            .map((e) => AUDIENCE_TYPE_LABELS[e.type as keyof typeof AUDIENCE_TYPE_LABELS] || e.type)
                            .join(", ") || "\u2014";
                        } catch { return "\u2014"; }
                      })()}
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-400">
                      {(c.status === "sent" || c.status === "partial") && c.recipientCount != null
                        ? `${c.recipientCount.toLocaleString()}${c.failedCount > 0 ? ` sent, ${c.failedCount.toLocaleString()} failed` : ""}`
                        : "\u2014"}
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-500 whitespace-nowrap">
                      {formatDate(c.sentAt || c.createdAt)}
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
