"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { useConfirmationDialog } from "@/app/components/ConfirmationDialog";
import { sanitizeSchema } from "@/app/lib/sanitize";
import MarkdownEditor from "@/app/components/MarkdownEditor";
import BulkSendProgress from "@/app/components/BulkSendProgress";
import { useEventContext } from "@/app/EventContext";
import {
  BulkSendProgressState,
  runChunkedSend,
} from "@/app/lib/bulkSend";
import {
  AUDIENCE_OPTIONS,
  isTicketHolderAudience,
  parseAudienceSegments,
  TICKET_TYPES,
  type AudienceSegment,
} from "@/app/lib/campaignAudienceConfig";

type FooterType =
  | "event_unsubscribe"
  | "announce_unsubscribe"
  | "essential"
  | "none";

const FOOTER_TYPE_OPTIONS: Array<{
  value: FooterType;
  label: string;
  hint: string;
}> = [
  {
    value: "event_unsubscribe",
    label: "Event unsubscribe link",
    hint: "Lets recipients opt out of promotional emails for this event only. Best for event-tied marketing (announcements, tickets available).",
  },
  {
    value: "announce_unsubscribe",
    label: "Announce unsubscribe link",
    hint: "Lets recipients opt out of all SSB promotional email. Best for general newsletters not tied to a single event.",
  },
  {
    value: "essential",
    label: "Event-essential (no unsubscribe)",
    hint: "Footer says \"you got a ticket to X\". Recipients can't opt out — use only for service mail to confirmed ticket holders.",
  },
  {
    value: "none",
    label: "No footer extra",
    hint: "Only the base SSB footer (no unsubscribe link, no notice). Use sparingly.",
  },
];

function suggestFooterType(args: {
  segments: AudienceSegment[];
  hasEvent: boolean;
}): FooterType {
  if (!args.hasEvent) return "announce_unsubscribe";
  if (args.segments.length === 0) return "event_unsubscribe";
  const allTicketHolders = args.segments.every((s) =>
    isTicketHolderAudience(s.type),
  );
  return allTicketHolders ? "essential" : "event_unsubscribe";
}

const EMAIL_CHUNK_SIZE = 50;

// ── Multi-event picker with tags ────────────────────────────────────────────

function EventTagPicker({
  selectedIds,
  onChange,
  disabled,
  events,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  events: { id: string; name: string | null }[];
}) {
  const available = events.filter((e) => !selectedIds.includes(e.id));

  return (
    <div className="space-y-2">
      {/* Selected tags */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map((id) => {
            const ev = events.find((e) => e.id === id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-300 font-medium"
              >
                {ev?.name || "Unknown"}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => onChange(selectedIds.filter((i) => i !== id))}
                    className="text-emerald-400 hover:text-white ml-0.5"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Dropdown to add */}
      {!disabled && available.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...selectedIds, e.target.value]);
          }}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
        >
          <option value="">Add event...</option>
          {available.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name || "Unnamed Event"}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ── Main editor ─────────────────────────────────────────────────────────────

type CampaignEditorProps = {
  campaignId: string | null;
};

export default function CampaignEditorClient({ campaignId }: CampaignEditorProps) {
  const router = useRouter();
  const { events } = useEventContext();
  const { confirm: confirmAction, confirmationDialog } =
    useConfirmationDialog();

  // Form state
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [segments, setSegments] = useState<AudienceSegment[]>([]);
  const [heroEventId, setHeroEventId] = useState<string>("");
  const [includeHeroCard, setIncludeHeroCard] = useState(false);
  const [feedbackEventId, setFeedbackEventId] = useState<string>("");
  const [includeFeedbackPrompt, setIncludeFeedbackPrompt] = useState(false);
  const [footerType, setFooterType] = useState<FooterType>("event_unsubscribe");
  const [footerTypeTouched, setFooterTypeTouched] = useState(false);

  // Campaign metadata
  const [savedId, setSavedId] = useState<string | null>(campaignId);
  const [status, setStatus] = useState<string>("draft");
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [failedCount, setFailedCount] = useState<number>(0);

  // UI state
  const [loading, setLoading] = useState(!!campaignId);
  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [audienceEmails, setAudienceEmails] = useState<string[] | null>(null);
  const [showRecipients, setShowRecipients] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sendState, setSendState] = useState<BulkSendProgressState | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isSent = status === "sent";
  const isPartial = status === "partial";
  const isSending = status === "sending";
  const isLocked = status !== "draft";

  const allReferencedEventIds = [
    ...new Set(segments.flatMap((segment) => segment.eventIds)),
  ];

  const applyCampaignState = useCallback((data: {
    campaign: {
      subject: string;
      body: string;
      audiences: string;
      eventId: string | null;
      includeHeroCard: boolean;
      feedbackEventId: string | null;
      includeFeedbackPrompt: boolean;
      footerType?: string | null;
      status: string;
      sentAt: string | null;
      recipientCount: number | null;
      failedCount?: number | null;
    };
    audienceCount?: number | null;
  }) => {
    const c = data.campaign;
    setSubject(c.subject);
    setBody(c.body);
    try {
      setSegments(parseAudienceSegments(JSON.parse(c.audiences || "[]")));
    } catch {
      setSegments([]);
    }
    setHeroEventId(c.eventId ?? "");
    setIncludeHeroCard(c.includeHeroCard);
    setFeedbackEventId(c.feedbackEventId ?? "");
    setIncludeFeedbackPrompt(c.includeFeedbackPrompt);
    const savedFooter = (c.footerType ?? "event_unsubscribe") as FooterType;
    setFooterType(savedFooter);
    // Treat any saved campaign as "touched" so we don't overwrite the
    // admin's saved choice when the audience changes later.
    setFooterTypeTouched(true);
    setStatus(c.status);
    setSentAt(c.sentAt);
    setRecipientCount(c.recipientCount);
    setFailedCount(c.failedCount ?? 0);
    setAudienceCount(data.audienceCount ?? null);
  }, []);

  // Suggest a default footer type when the audience / event-bound state
  // changes — but only until the admin has explicitly chosen one.
  useEffect(() => {
    if (footerTypeTouched) return;
    const hasEvent =
      segments.some((s) => s.eventIds.length > 0) || !!heroEventId;
    setFooterType(suggestFooterType({ segments, hasEvent }));
  }, [segments, heroEventId, footerTypeTouched]);

  const refreshCampaign = useCallback(async (id: string) => {
    const res = await fetch(`/api/campaigns/${id}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to refresh campaign");
    }
    applyCampaignState(data);
    return data;
  }, [applyCampaignState]);

  // Load existing campaign
  useEffect(() => {
    if (!campaignId) return;
    setLoading(true);
    fetch(`/api/campaigns/${campaignId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        applyCampaignState(data);
      })
      .catch(() => setError("Failed to load campaign"))
      .finally(() => setLoading(false));
  }, [campaignId, applyCampaignState]);

  useEffect(() => {
    setAudienceCount(null);
    setAudienceEmails(null);
    setShowRecipients(false);
  }, [segments]);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(t);
  }, [success]);

  // Segment manipulation
  const addSegment = useCallback(() => {
    setSegments((prev) => [...prev, { type: "all_users", eventIds: [] }]);
  }, []);

  const removeSegment = useCallback((index: number) => {
    setSegments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateSegmentType = useCallback((index: number, type: AudienceSegment["type"]) => {
    setSegments((prev) =>
      prev.map((s, i) => (i === index ? { ...s, type, eventIds: [], ticketType: undefined } : s)),
    );
  }, []);

  const updateSegmentEvents = useCallback((index: number, eventIds: string[]) => {
    setSegments((prev) =>
      prev.map((s, i) => (i === index ? { ...s, eventIds } : s)),
    );
  }, []);

  const updateSegmentTicketType = useCallback((index: number, ticketType: string) => {
    setSegments((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ticketType } : s)),
    );
  }, []);

  const saveDraft = useCallback(async (): Promise<string | null> => {
    if (!subject.trim()) {
      setError("Subject is required");
      return null;
    }
    if (segments.length === 0) {
      setError("Add at least one audience segment");
      return null;
    }
    for (const seg of segments) {
      const opt = AUDIENCE_OPTIONS.find((o) => o.value === seg.type);
      if (opt?.needsEvent && seg.eventIds.length === 0) {
        setError(`Select at least one event for "${opt.label}"`);
        return null;
      }
      if (opt?.needsTicketType && !seg.ticketType) {
        setError(`Select a ticket type for "${opt.label}"`);
        return null;
      }
    }
    if (includeHeroCard) {
      const referencedEventIds = new Set(
        segments.flatMap((segment) => segment.eventIds),
      );
      if (!heroEventId) {
        setError("Select an event for the hero card");
        return null;
      }
      if (!referencedEventIds.has(heroEventId)) {
        setError("Hero card event must be one of the selected audience events");
        return null;
      }
    }
    if (includeFeedbackPrompt) {
      const referencedEventIds = new Set(
        segments.flatMap((segment) => segment.eventIds),
      );
      if (!feedbackEventId) {
        setError("Select an event for the feedback prompt");
        return null;
      }
      if (!referencedEventIds.has(feedbackEventId)) {
        setError(
          "Feedback prompt event must be one of the selected audience events",
        );
        return null;
      }
    }

    setSaving(true);
    setError(null);

    try {
      const payload = {
        subject: subject.trim(),
        body,
        audiences: segments,
        eventId: includeHeroCard ? heroEventId || null : null,
        includeHeroCard,
        feedbackEventId: includeFeedbackPrompt ? feedbackEventId || null : null,
        includeFeedbackPrompt,
        footerType,
      };

      if (savedId) {
        const res = await fetch(`/api/campaigns/${savedId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to save");
        setSuccess("Draft saved");
        return savedId;
      } else {
        const res = await fetch("/api/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create");
        const newId = data.campaign.id;
        setSavedId(newId);
        setSuccess("Campaign created");
        window.history.replaceState(null, "", `/campaigns/${newId}`);
        return newId;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      return null;
    } finally {
      setSaving(false);
    }
  }, [
    subject,
    body,
    segments,
    heroEventId,
    includeHeroCard,
    feedbackEventId,
    includeFeedbackPrompt,
    footerType,
    savedId,
  ]);

  const handlePreviewRecipients = useCallback(async () => {
    const id = await saveDraft();
    if (!id) return;
    setResolving(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}?includeAudience=true`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to resolve audience");
      const emails: string[] = data.audienceEmails ?? [];
      setAudienceEmails(emails);
      setAudienceCount(emails.length);
      setShowRecipients(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve audience");
    } finally {
      setResolving(false);
    }
  }, [saveDraft]);

  const handleSendTest = useCallback(async () => {
    const id = await saveDraft();
    if (!id) return;
    setSendingTest(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send test");
      setSuccess("Test email sent! Check your inbox.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test send failed");
    } finally {
      setSendingTest(false);
    }
  }, [saveDraft]);

  const handleSendCampaign = useCallback(async () => {
    const id = await saveDraft();
    if (!id) return;

    setError(null);
    let emails: string[];
    try {
      const res = await fetch(`/api/campaigns/${id}?includeAudience=true`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to resolve audience");
      emails = data.audienceEmails ?? [];
      setAudienceCount(emails.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve audience");
      return;
    }

    if (emails.length === 0) {
      setError("No recipients found for this audience");
      return;
    }

    setStatus("sending");

    try {
      const finalState = await runChunkedSend({
        items: emails,
        chunkSize: EMAIL_CHUNK_SIZE,
        label: `Sending "${subject}"`,
        onProgress: setSendState,
        shouldAbortOnError: (error) =>
          typeof error === "object" &&
          error !== null &&
          "fatal" in error &&
          error.fatal === true,
        sendChunk: async (chunk, context) => {
          const res = await fetch(`/api/campaigns/${id}/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              emails: chunk,
              auditBatchId: context.batchId,
              chunkIndex: context.chunkIndex,
              chunkCount: context.chunkCount,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            const error = new Error(data.error || "Send failed") as Error & {
              fatal?: boolean;
              status?: number;
            };
            error.status = res.status;
            error.fatal = res.status >= 400 && res.status < 500;
            throw error;
          }
          return data;
        },
      });

      const refreshed = await refreshCampaign(id);
      const refreshedCampaign = refreshed.campaign;
      if (refreshedCampaign.status === "partial") {
        const failed = refreshedCampaign.failedCount ?? finalState.failed;
        setError(
          `Campaign finished with ${failed} failed email${failed === 1 ? "" : "s"}. Successful deliveries have been recorded.`,
        );
      } else {
        setSuccess("Campaign sent successfully");
      }
    } catch (err) {
      try {
        await refreshCampaign(id);
      } catch {
        // best effort
      }
      setError(err instanceof Error ? err.message : "Send failed");
    }
  }, [refreshCampaign, saveDraft, subject]);

  const handleConfirmSendCampaign = useCallback(async () => {
    const shouldSend = await confirmAction({
      title: "Send campaign now?",
      description: (
        <>
          Send <span className="font-medium text-white">&ldquo;{subject}&rdquo;</span>{" "}
          to{" "}
          {audienceCount !== null ? (
            <>
              <span className="font-medium text-white">
                {audienceCount.toLocaleString()}
              </span>{" "}
              recipients
            </>
          ) : (
            "the resolved audience"
          )}{" "}
          across{" "}
          <span className="font-medium text-white">
            {segments.length} audience segment{segments.length !== 1 ? "s" : ""}
          </span>
          .
        </>
      ),
      confirmLabel: "Send Now",
      tone: "primary",
    });
    if (!shouldSend) return;

    await handleSendCampaign();
  }, [audienceCount, confirmAction, handleSendCampaign, segments.length, subject]);

  const handleDelete = useCallback(async () => {
    if (!savedId) return;
    const shouldDelete = await confirmAction({
      title: "Delete this draft campaign?",
      description:
        "This removes the draft campaign and its current audience configuration.",
      confirmLabel: "Delete campaign",
      tone: "danger",
    });
    if (!shouldDelete) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/campaigns/${savedId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Delete failed");
      }
      router.push("/campaigns");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }, [confirmAction, savedId, router]);

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="w-8 h-8 border-2 border-zinc-600 border-t-rose-400 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-zinc-500 text-sm">Loading campaign...</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/campaigns")} className="text-zinc-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <h1 className="text-2xl font-bold text-white font-serif">
            {isLocked ? "Campaign Details" : savedId ? "Edit Campaign" : "New Campaign"}
          </h1>
        </div>
        <button onClick={() => setShowPreview(!showPreview)} className="lg:hidden px-3 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition-colors">
          {showPreview ? "Editor" : "Preview"}
        </button>
      </div>

      {(isSent || isPartial) && (
        <div className="mb-6 px-4 py-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-3">
          <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-emerald-400 text-sm">
            {isPartial ? "Partially sent" : "Sent"} to {recipientCount?.toLocaleString() ?? "?"} recipients
            {isPartial && failedCount > 0
              ? ` with ${failedCount.toLocaleString()} failed`
              : ""}
            {sentAt && ` on ${new Date(sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" })}`}
          </p>
        </div>
      )}

      {isSending && !sendState?.active && (
        <div className="mb-6 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center gap-3">
          <svg className="w-5 h-5 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-amber-300 text-sm">
            This campaign is marked as sending and is locked from further edits.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-rose-400 text-sm">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-300">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      {success && (
        <div className="mb-4 px-4 py-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-3">
          <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-emerald-400 text-sm">{success}</p>
        </div>
      )}

      {sendState && <div className="mb-4"><BulkSendProgress state={sendState} onDismiss={() => setSendState(null)} /></div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Editor */}
        <div className={`space-y-6 ${showPreview ? "hidden lg:block" : ""}`}>
          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Subject Line</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Enter email subject..."
              disabled={isLocked}
              maxLength={200}
              className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Audience Segments */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Audience</h3>

            {segments.length === 0 && (
              <p className="text-sm text-zinc-500 italic">No audience segments added yet.</p>
            )}

            <div className="space-y-3">
              {segments.map((seg, idx) => {
                const opt = AUDIENCE_OPTIONS.find((o) => o.value === seg.type);
                const needsEvent = opt?.needsEvent ?? false;

                return (
                  <div key={idx} className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-zinc-500 font-medium shrink-0">#{idx + 1}</span>
                      <select
                        value={seg.type}
                        onChange={(e) =>
                          updateSegmentType(
                            idx,
                            e.target.value as AudienceSegment["type"],
                          )}
                        disabled={isLocked}
                        className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50"
                      >
                        {AUDIENCE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      {!isLocked && (
                        <button
                          onClick={() => removeSegment(idx)}
                          className="text-zinc-500 hover:text-rose-400 transition-colors shrink-0"
                          title="Remove segment"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>

                    {opt?.needsTicketType && (
                      <select
                        value={seg.ticketType ?? ""}
                        onChange={(e) => updateSegmentTicketType(idx, e.target.value)}
                        disabled={isLocked}
                        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50"
                      >
                        <option value="">Select ticket type...</option>
                        {TICKET_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    )}

                    {needsEvent && (
                      <EventTagPicker
                        selectedIds={seg.eventIds}
                        onChange={(ids) => updateSegmentEvents(idx, ids)}
                        disabled={isLocked}
                        events={events.map((e) => ({ id: e.id, name: e.name }))}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {!isLocked && (
              <button
                onClick={addSegment}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-300 bg-zinc-800 border border-zinc-700 border-dashed rounded-xl hover:bg-zinc-700 hover:text-white transition-colors w-full justify-center"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Segment
              </button>
            )}

            {/* Preview recipients */}
            {!isLocked && segments.length > 0 && (
              <button
                onClick={handlePreviewRecipients}
                disabled={resolving || saving}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-300 bg-zinc-800 rounded-xl hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-full justify-center"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                {resolving ? "Resolving..." : "Preview Recipients"}
              </button>
            )}

            {audienceCount !== null && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-sm text-zinc-400">
                  <span className="text-white font-medium">{audienceCount.toLocaleString()}</span> unique recipients
                </span>
                {audienceEmails && audienceEmails.length > 0 && (
                  <button
                    onClick={() => setShowRecipients(!showRecipients)}
                    className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {showRecipients ? "Hide list" : "Show list"}
                  </button>
                )}
              </div>
            )}

            {showRecipients && audienceEmails && audienceEmails.length > 0 && (
              <div className="rounded-xl border border-zinc-700 bg-zinc-800/50 max-h-64 overflow-y-auto scrollbar-thin">
                <div className="px-3 py-2 border-b border-zinc-700 sticky top-0 bg-zinc-800 flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-400">{audienceEmails.length} emails (deduplicated)</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(audienceEmails.join("\n"));
                      setSuccess("Copied to clipboard");
                    }}
                    className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    Copy all
                  </button>
                </div>
                <div className="divide-y divide-zinc-800">
                  {audienceEmails.map((email) => (
                    <div key={email} className="px-3 py-1.5 text-xs text-zinc-300 font-mono truncate">
                      {email}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Hero card */}
          {allReferencedEventIds.length > 0 && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeHeroCard}
                  onChange={(e) => setIncludeHeroCard(e.target.checked)}
                  disabled={isLocked}
                  className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500/50 focus:ring-offset-0"
                />
                <span className="text-sm font-medium text-zinc-300">Include event hero card</span>
              </label>
              {includeHeroCard && (
                <select
                  value={heroEventId}
                  onChange={(e) => setHeroEventId(e.target.value)}
                  disabled={isLocked}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50"
                >
                  <option value="">Select hero card event...</option>
                  {allReferencedEventIds.map((eid) => {
                    const ev = events.find((e) => e.id === eid);
                    return <option key={eid} value={eid}>{ev?.name || "Unnamed Event"}</option>;
                  })}
                </select>
              )}
            </div>
          )}

          {allReferencedEventIds.length > 0 && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeFeedbackPrompt}
                  onChange={(e) => setIncludeFeedbackPrompt(e.target.checked)}
                  disabled={isLocked}
                  className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500/50 focus:ring-offset-0"
                />
                <span className="text-sm font-medium text-zinc-300">
                  Include post-event feedback prompt
                </span>
              </label>
              <p className="text-xs text-zinc-500">
                Recipients can click 1-10 directly in the email, then land on the event page with that score preselected and an optional comment box.
              </p>
              {includeFeedbackPrompt && (
                <select
                  value={feedbackEventId}
                  onChange={(e) => setFeedbackEventId(e.target.value)}
                  disabled={isLocked}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50"
                >
                  <option value="">Select feedback event...</option>
                  {allReferencedEventIds.map((eid) => {
                    const ev = events.find((e) => e.id === eid);
                    return (
                      <option key={eid} value={eid}>
                        {ev?.name || "Unnamed Event"}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>
          )}

          {/* Footer type */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <label
                htmlFor="footer-type"
                className="text-sm font-medium text-zinc-300"
              >
                Email footer
              </label>
              {(() => {
                const hasEvent =
                  segments.some((s) => s.eventIds.length > 0) || !!heroEventId;
                const suggested = suggestFooterType({ segments, hasEvent });
                if (suggested === footerType) {
                  return (
                    <span className="text-[10px] uppercase tracking-wide text-emerald-400/80">
                      Matches suggestion
                    </span>
                  );
                }
                return (
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => {
                      setFooterType(suggested);
                      setFooterTypeTouched(true);
                    }}
                    className="text-[10px] uppercase tracking-wide text-amber-300/90 hover:text-amber-200 disabled:opacity-50"
                  >
                    Use suggested:{" "}
                    {
                      FOOTER_TYPE_OPTIONS.find((o) => o.value === suggested)
                        ?.label
                    }
                  </button>
                );
              })()}
            </div>
            <select
              id="footer-type"
              value={footerType}
              onChange={(e) => {
                setFooterType(e.target.value as FooterType);
                setFooterTypeTouched(true);
              }}
              disabled={isLocked}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50"
            >
              {FOOTER_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-zinc-500 leading-relaxed">
              {FOOTER_TYPE_OPTIONS.find((o) => o.value === footerType)?.hint}
            </p>
            {(footerType === "essential" || footerType === "none") && (
              <p className="text-xs text-amber-300/90 leading-relaxed">
                Recipients can&rsquo;t unsubscribe from this send and the
                opt-out filter will not run. Only use this for service mail to
                ticket holders.
              </p>
            )}
          </div>

          {/* Email body */}
          <div>
            <div className="px-4 py-3 bg-zinc-800/50 border border-dashed border-zinc-700 rounded-t-xl flex items-center gap-3">
              <img src="/favicon.ico" alt="SSB" className="w-6 h-6 rounded shrink-0" />
              <span className="text-xs text-zinc-500 font-medium">SSB Logo Header (locked)</span>
              <svg className="w-3.5 h-3.5 text-zinc-600 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            {isLocked ? (
              <div className="px-4 py-3 bg-zinc-800 border border-zinc-700 text-white text-sm">
                <div className="prose prose-sm prose-invert prose-p:text-zinc-300 prose-a:text-emerald-400 max-w-none">
                  <ReactMarkdown rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}>{body}</ReactMarkdown>
                </div>
              </div>
            ) : (
              <div className="-mt-px">
                <MarkdownEditor
                  id="campaign-body"
                  value={body}
                  onChange={setBody}
                  placeholder="Write your email content here... Supports **bold**, *italic*, and [links](url)"
                  rows={12}
                  label=""
                  ariaLabel="Campaign email body"
                />
              </div>
            )}
            <div className="px-4 py-3 bg-zinc-800/50 border border-dashed border-zinc-700 rounded-b-xl -mt-px">
              <p className="text-xs text-zinc-500 text-center">Stanford Speakers Bureau &middot; Footer (locked)</p>
            </div>
          </div>

          {/* Action buttons */}
          {!isLocked && (
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={saveDraft} disabled={saving || !!sendState?.active} className="px-5 py-2.5 rounded-xl text-sm font-medium bg-zinc-800 text-white hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {saving ? "Saving..." : "Save Draft"}
              </button>
              <button onClick={handleSendTest} disabled={sendingTest || saving || !!sendState?.active} className="px-5 py-2.5 rounded-xl text-sm font-medium bg-zinc-800 text-white hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {sendingTest ? "Sending..." : "Send Test Email"}
              </button>
              <button onClick={handleConfirmSendCampaign} disabled={saving || sendingTest || !!sendState?.active || !subject.trim() || segments.length === 0} className="px-5 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed">
                Send Campaign
              </button>
              {savedId && (
                <button onClick={handleDelete} disabled={deleting || !!sendState?.active} className="px-5 py-2.5 rounded-xl text-sm font-medium bg-rose-600 text-white hover:bg-rose-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-auto">
                  {deleting ? "Deleting..." : "Delete"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right: Live Preview */}
        <div className={`${!showPreview ? "hidden lg:block" : ""}`}>
          <div className="sticky top-4">
            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">Email Preview</h3>
            <div className="rounded-2xl border border-zinc-700 overflow-hidden shadow-2xl">
              <div style={{ backgroundColor: "#27272a" }}>
                <div className="text-center" style={{ backgroundColor: "#27272a", padding: "24px 20px 12px" }}>
                  <div style={{ maxWidth: 600, margin: "0 auto" }}>
                    <img src="/favicon.ico" alt="Stanford Speakers Bureau" width={46} height={46} style={{ display: "block", margin: "0 auto" }} />
                  </div>
                </div>
                {includeHeroCard && heroEventId && (() => {
                  const ev = events.find((e) => e.id === heroEventId);
                  if (!ev) return null;
                  const publicBase =
                    process.env.NEXT_PUBLIC_BASE_URL
                    || "https://stanfordspeakersbureau.com";
                  const imageUrl = ev.imgVersion
                    ? `${publicBase}/api/images/${ev.id}?v=${ev.imgVersion}`
                    : null;
                  const pillFmt: Intl.DateTimeFormatOptions = {
                    timeZone: "America/Los_Angeles",
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  };
                  const timeFmt: Intl.DateTimeFormatOptions = {
                    timeZone: "America/Los_Angeles",
                    hour: "numeric",
                    minute: "2-digit",
                  };
                  const startPill = ev.start_time_date
                    ? new Date(ev.start_time_date).toLocaleString("en-US", pillFmt)
                    : null;
                  const doorsPill = ev.doors_open
                    ? new Date(ev.doors_open).toLocaleString("en-US", timeFmt)
                    : null;
                  return (
                    <div className="mx-auto" style={{ maxWidth: 600 }}>
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={ev.name ?? "Event"}
                          style={{
                            width: "100%",
                            height: "auto",
                            display: "block",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            background: "linear-gradient(135deg, #A80D0C 0%, #C11211 100%)",
                            padding: 24,
                            textAlign: "center",
                            color: "#ffffff",
                            fontSize: 14,
                            fontWeight: 700,
                            letterSpacing: 1,
                            textTransform: "uppercase",
                          }}
                        >
                          Stanford Speakers Bureau
                        </div>
                      )}
                      <div
                        style={{
                          backgroundColor: "#18181b",
                          borderTop: "4px solid #A80D0C",
                          padding: "24px 24px 20px",
                        }}
                      >
                        <h2
                          style={{
                            color: "#ffffff",
                            fontSize: 28,
                            fontWeight: 700,
                            fontFamily: "Georgia, 'Times New Roman', Times, serif",
                            lineHeight: 1.2,
                            margin: "0 0 6px 0",
                          }}
                        >
                          {ev.name || "Event Name"}
                        </h2>
                        {ev.tagline && (
                          <p
                            style={{
                              color: "#a1a1aa",
                              fontSize: 15,
                              lineHeight: 1.5,
                              margin: "0 0 4px 0",
                            }}
                          >
                            {ev.tagline}
                          </p>
                        )}
                        {(startPill || doorsPill || ev.venue) && (
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 6,
                              marginTop: 14,
                            }}
                          >
                            {startPill && (
                              <span
                                style={{
                                  backgroundColor: "#2a2a2e",
                                  border: "1px solid #3f3f46",
                                  borderRadius: 50,
                                  padding: "5px 12px",
                                  fontSize: 13,
                                  color: "#e4e4e7",
                                  fontWeight: 500,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                <span style={{ color: "#f87171" }}>📅</span>{" "}
                                {startPill}
                              </span>
                            )}
                            {doorsPill && (
                              <span
                                style={{
                                  backgroundColor: "#2a2a2e",
                                  border: "1px solid #3f3f46",
                                  borderRadius: 50,
                                  padding: "5px 12px",
                                  fontSize: 13,
                                  color: "#e4e4e7",
                                  fontWeight: 500,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                <span style={{ color: "#f87171" }}>🚪</span>{" "}
                                Doors open {doorsPill}
                              </span>
                            )}
                            {ev.venue && (
                              <span
                                style={{
                                  backgroundColor: "#2a2a2e",
                                  border: "1px solid #3f3f46",
                                  borderRadius: 50,
                                  padding: "5px 12px",
                                  fontSize: 13,
                                  color: "#e4e4e7",
                                  fontWeight: 500,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                <span style={{ color: "#f87171" }}>📍</span>{" "}
                                {ev.venue}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
                <div className="px-5 py-8 mx-auto" style={{ maxWidth: 600 }}>
                  {body ? (
                    <div className="prose prose-sm prose-invert prose-p:text-zinc-200 prose-p:leading-relaxed prose-a:text-red-400 prose-a:underline prose-strong:text-white prose-em:text-zinc-200 max-w-none" style={{ color: "#f4f4f5", fontSize: 16, lineHeight: 1.7 }}>
                      <ReactMarkdown rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}>{body}</ReactMarkdown>
                    </div>
                  ) : (
                    <p style={{ color: "#71717a", fontSize: 14, fontStyle: "italic" }}>Start typing to see a preview...</p>
                  )}
                  {includeFeedbackPrompt && feedbackEventId && (() => {
                    const ev = events.find((event) => event.id === feedbackEventId);
                    return ev ? (
                      <div
                        className="mt-7 rounded-[20px] border border-zinc-700 bg-zinc-950/80 p-5"
                      >
                        <h4 className="text-xl font-semibold text-white leading-snug mb-2">
                          How likely are you to recommend Stanford Speakers Bureau events to a friend?
                        </h4>
                        <p className="text-sm text-[#d4d4d8] leading-relaxed mb-4">
                          It takes just one click to share your feedback!
                        </p>
                        <div className="grid grid-cols-5 gap-2">
                          {Array.from({ length: 10 }, (_, index) => (
                            <div
                              key={index}
                              className="rounded-[10px] border border-[#8a0a09] bg-[#A80D0C] py-3 text-center text-base font-bold text-white shadow-[0_1px_0_rgba(0,0,0,0.25)]"
                            >
                              {index + 1}
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                          <span>Not likely</span>
                          <span>Extremely likely</span>
                        </div>
                      </div>
                    ) : null;
                  })()}
                </div>
                <div className="text-center py-6 border-t" style={{ backgroundColor: "#18181b", borderColor: "#3f3f46" }}>
                  <p style={{ color: "#71717a", fontSize: 12, margin: "0 0 8px 0" }}>Stanford Speakers Bureau</p>
                  <p style={{ color: "#71717a", fontSize: 12, margin: 0 }}>For ADA accommodations or other questions, please email tickets@stanfordspeakersbureau.com</p>
                  {(() => {
                    const heroEvent = heroEventId
                      ? events.find((e) => e.id === heroEventId)
                      : null;
                    const heroName = heroEvent?.name?.trim() || "this event";
                    if (footerType === "event_unsubscribe") {
                      return (
                        <p style={{ color: "#71717a", fontSize: 12, margin: "12px 0 0 0" }}>
                          <span style={{ color: "#a1a1aa", textDecoration: "underline" }}>
                            Unsubscribe from emails about {heroName}
                          </span>
                        </p>
                      );
                    }
                    if (footerType === "announce_unsubscribe") {
                      return (
                        <p style={{ color: "#71717a", fontSize: 12, margin: "12px 0 0 0" }}>
                          <span style={{ color: "#a1a1aa", textDecoration: "underline" }}>
                            Unsubscribe from announcements
                          </span>
                        </p>
                      );
                    }
                    if (footerType === "essential") {
                      return (
                        <p style={{ color: "#71717a", fontSize: 12, margin: "12px 0 0 0", lineHeight: 1.5 }}>
                          This is an event-essential update. You&rsquo;re
                          receiving it because you got a ticket to{" "}
                          <span style={{ color: "#a1a1aa" }}>{heroName}</span>.
                        </p>
                      );
                    }
                    return null;
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {confirmationDialog}
    </div>
  );
}
