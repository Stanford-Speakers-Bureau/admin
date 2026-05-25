"use client";

import { useMemo, useState, useTransition } from "react";
import { useEventContext } from "@/app/EventContext";
import type { AdminEventQuestion } from "./data";

type EnableState = "enabled" | "disabled";

type FilterTab =
  | "pending"
  | "approved"
  | "hidden"
  | "rejected"
  | "duplicate"
  | "all";

type ActionState = {
  busy: boolean;
  error: string | null;
};

const buttonBase =
  "px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const tones = {
  approve:
    "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30",
  reject:
    "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 border border-rose-500/30",
  amber:
    "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30",
  sky:
    "bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 border border-sky-500/30",
  neutral:
    "bg-zinc-800 text-zinc-200 hover:bg-zinc-700 border border-zinc-700",
  ghost:
    "border border-zinc-700 text-zinc-300 hover:bg-zinc-800",
} as const;

export default function AdminEventQuestionsClient({
  initialQuestions,
}: {
  initialQuestions: AdminEventQuestion[];
}) {
  const { events, selectedEventId, updateEvent } = useEventContext();
  const [questions, setQuestions] = useState(initialQuestions);
  const [togglingEnable, setTogglingEnable] = useState(false);
  const [togglingRankings, setTogglingRankings] = useState(false);
  const [tab, setTab] = useState<FilterTab>("pending");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [merging, setMerging] = useState<AdminEventQuestion | null>(null);
  const [voteEditing, setVoteEditing] = useState<{
    id: string;
    value: string;
  } | null>(null);
  const [state, setState] = useState<ActionState>({ busy: false, error: null });
  const [, startTransition] = useTransition();

  const currentEvent = events.find((e) => e.id === selectedEventId);

  const scopedQuestions = useMemo(
    () =>
      selectedEventId
        ? questions.filter((q) => q.event_id === selectedEventId)
        : [],
    [questions, selectedEventId],
  );

  const filtered = useMemo(() => {
    switch (tab) {
      case "pending":
        return scopedQuestions.filter((q) => !q.reviewed);
      case "approved":
        return scopedQuestions.filter(
          (q) => q.approved && !q.hidden && !q.duplicate,
        );
      case "hidden":
        return scopedQuestions.filter((q) => q.hidden);
      case "rejected":
        return scopedQuestions.filter(
          (q) => q.reviewed && !q.approved && !q.duplicate,
        );
      case "duplicate":
        return scopedQuestions.filter((q) => q.duplicate);
      case "all":
      default:
        return scopedQuestions;
    }
  }, [scopedQuestions, tab]);

  const refresh = (incoming: AdminEventQuestion[]) => {
    startTransition(() => setQuestions(incoming));
  };

  const post = async (
    body: Record<string, unknown>,
    method: "POST" | "PATCH" | "PUT" = "POST",
    path = "/api/event-questions",
  ) => {
    setState({ busy: true, error: null });
    try {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        success?: boolean;
        questions?: AdminEventQuestion[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Action failed");
      if (data.questions) refresh(data.questions);
    } catch (err) {
      setState({
        busy: false,
        error: err instanceof Error ? err.message : "Action failed",
      });
      return false;
    }
    setState({ busy: false, error: null });
    return true;
  };

  const handleApprove = (id: string) => post({ id, action: "approve" });
  const handleReject = (id: string) => post({ id, action: "reject" });
  const handleHide = (id: string, hidden: boolean) =>
    post({ id, hidden }, "PATCH");

  const handleEditSave = async () => {
    if (!editing) return;
    const ok = await post({ id: editing.id, question: editing.text }, "PATCH");
    if (ok) setEditing(null);
  };

  const handleMerge = async (targetId: string) => {
    if (!merging) return;
    const ok = await post(
      { sourceId: merging.id, targetId, eventId: merging.event_id },
      "PUT",
    );
    if (ok) setMerging(null);
  };

  const handleVoteSave = async () => {
    if (!voteEditing) return;
    const n = Number(voteEditing.value);
    if (!Number.isFinite(n) || n < 0) {
      setState({ busy: false, error: "Vote count must be a non-negative number" });
      return;
    }
    const ok = await post(
      { id: voteEditing.id, votes: Math.floor(n) },
      "PATCH",
      "/api/event-questions/votes",
    );
    if (ok) setVoteEditing(null);
  };

  const handleSyncVotes = async (id: string) => {
    await post({ id }, "POST", "/api/event-questions/sync-votes");
  };

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    {
      key: "pending",
      label: "Pending",
      count: scopedQuestions.filter((q) => !q.reviewed).length,
    },
    {
      key: "approved",
      label: "Approved",
      count: scopedQuestions.filter(
        (q) => q.approved && !q.hidden && !q.duplicate,
      ).length,
    },
    {
      key: "hidden",
      label: "Hidden",
      count: scopedQuestions.filter((q) => q.hidden).length,
    },
    {
      key: "rejected",
      label: "Rejected",
      count: scopedQuestions.filter(
        (q) => q.reviewed && !q.approved && !q.duplicate,
      ).length,
    },
    {
      key: "duplicate",
      label: "Duplicate",
      count: scopedQuestions.filter((q) => q.duplicate).length,
    },
    { key: "all", label: "All", count: scopedQuestions.length },
  ];

  const eventApprovedTargets = merging
    ? scopedQuestions.filter(
        (q) => q.approved && !q.hidden && !q.duplicate && q.id !== merging.id,
      )
    : [];

  if (!selectedEventId || !currentEvent) {
    return (
      <div className="px-4 sm:px-6 py-8 max-w-7xl mx-auto w-full text-sm">
        <header className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
            Moderator Q&amp;A
          </h1>
          <p className="text-zinc-400">
            Pick an event from the sidebar to moderate its questions.
          </p>
        </header>
      </div>
    );
  }

  const enabled = currentEvent.questionsEnabled ?? false;
  const toggleEnabled = async () => {
    if (togglingEnable) return;
    setTogglingEnable(true);
    setState({ busy: false, error: null });
    const next: EnableState = enabled ? "disabled" : "enabled";
    try {
      const res = await fetch("/api/event-questions/event-toggle", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: currentEvent.id, enabled: !enabled }),
      });
      const data = (await res.json()) as {
        questions?: AdminEventQuestion[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Toggle failed");
      updateEvent(currentEvent.id, { questionsEnabled: !enabled });
      if (data.questions) refresh(data.questions);
    } catch (err) {
      setState({
        busy: false,
        error: err instanceof Error ? err.message : `Failed to ${next}`,
      });
    } finally {
      setTogglingEnable(false);
    }
  };

  const rankingsHidden = currentEvent.questionsRankingsHidden ?? false;
  const toggleRankings = async () => {
    if (togglingRankings) return;
    setTogglingRankings(true);
    setState({ busy: false, error: null });
    const nextHidden = !rankingsHidden;
    try {
      const res = await fetch("/api/event-questions/rankings-toggle", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: currentEvent.id,
          rankingsHidden: nextHidden,
        }),
      });
      const data = (await res.json()) as {
        questions?: AdminEventQuestion[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Toggle failed");
      updateEvent(currentEvent.id, { questionsRankingsHidden: nextHidden });
      if (data.questions) refresh(data.questions);
    } catch (err) {
      setState({
        busy: false,
        error:
          err instanceof Error
            ? err.message
            : `Failed to ${nextHidden ? "hide" : "show"} rankings`,
      });
    } finally {
      setTogglingRankings(false);
    }
  };

  return (
    <div className="px-4 sm:px-6 py-8 max-w-7xl mx-auto w-full text-sm">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
            Moderator Q&amp;A · {currentEvent.name}
          </h1>
          <p className="text-zinc-400">
            Review, approve, and curate questions for this event. The moderator
            will ask the top-voted approved questions during the Q&amp;A.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <button
            onClick={toggleEnabled}
            disabled={togglingEnable}
            className={`shrink-0 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
              enabled
                ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                enabled ? "bg-emerald-400" : "bg-zinc-500"
              }`}
            />
            Questions {enabled ? "enabled" : "disabled"} · click to{" "}
            {enabled ? "disable" : "enable"}
          </button>
          <button
            onClick={toggleRankings}
            disabled={togglingRankings}
            title="When rankings are hidden, the public sees approved questions in a random order with no rank numbers. You still see votes and ranking here."
            className={`shrink-0 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
              rankingsHidden
                ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700"
                : "bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 border border-sky-500/30"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                rankingsHidden ? "bg-zinc-500" : "bg-sky-400"
              }`}
            />
            Public rankings {rankingsHidden ? "hidden" : "shown"} · click to{" "}
            {rankingsHidden ? "show" : "hide"}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 mb-5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === t.key
                ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                : "bg-zinc-900 text-zinc-400 border border-zinc-800 hover:bg-zinc-800"
            }`}
          >
            {t.label}{" "}
            <span className="opacity-60 ml-1">({t.count})</span>
          </button>
        ))}
      </div>

      {state.error && (
        <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {state.error}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 px-4 py-12 text-center text-zinc-400 text-sm">
          No questions in this view.
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((q) => (
            <li
              key={q.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500 mb-2">
                    <span>{q.email || "anonymous"}</span>
                    <span>·</span>
                    <span>{new Date(q.created_at).toLocaleString()}</span>
                    <span>·</span>
                    <span className="font-semibold text-zinc-300">
                      {q.votes} {q.votes === 1 ? "vote" : "votes"}
                    </span>
                  </div>
                  {editing?.id === q.id ? (
                    <textarea
                      rows={3}
                      value={editing.text}
                      onChange={(e) =>
                        setEditing({ id: q.id, text: e.target.value })
                      }
                      className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500/40"
                    />
                  ) : (
                    <p className="text-base leading-snug font-serif text-zinc-100">
                      {q.question}
                    </p>
                  )}
                  {q.voters.length > 0 && (
                    <details className="mt-2 text-xs text-zinc-500">
                      <summary className="cursor-pointer hover:text-zinc-400">
                        {q.voters.length} voter(s)
                      </summary>
                      <ul className="mt-1 pl-4 list-disc space-y-0.5">
                        {q.voters.map((v) => (
                          <li key={v}>{v}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                <div className="shrink-0 flex flex-col gap-1.5 min-w-[140px]">
                  {!q.reviewed && (
                    <>
                      <button
                        disabled={state.busy}
                        onClick={() => handleApprove(q.id)}
                        className={`${buttonBase} ${tones.approve}`}
                      >
                        Approve
                      </button>
                      <button
                        disabled={state.busy}
                        onClick={() => handleReject(q.id)}
                        className={`${buttonBase} ${tones.reject}`}
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {q.approved && !q.hidden && (
                    <button
                      disabled={state.busy}
                      onClick={() => handleHide(q.id, true)}
                      className={`${buttonBase} ${tones.ghost}`}
                    >
                      Hide
                    </button>
                  )}
                  {q.hidden && (
                    <button
                      disabled={state.busy}
                      onClick={() => handleHide(q.id, false)}
                      className={`${buttonBase} ${tones.ghost}`}
                    >
                      Unhide
                    </button>
                  )}
                  {editing?.id === q.id ? (
                    <>
                      <button
                        disabled={state.busy}
                        onClick={handleEditSave}
                        className={`${buttonBase} ${tones.approve}`}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className={`${buttonBase} ${tones.ghost}`}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setEditing({ id: q.id, text: q.question })}
                      className={`${buttonBase} ${tones.ghost}`}
                    >
                      Edit text
                    </button>
                  )}
                  {!q.duplicate && (
                    <button
                      disabled={state.busy}
                      onClick={() => setMerging(q)}
                      className={`${buttonBase} ${tones.amber}`}
                    >
                      Merge into…
                    </button>
                  )}
                  {voteEditing?.id === q.id ? (
                    <>
                      <input
                        type="number"
                        min={0}
                        value={voteEditing.value}
                        onChange={(e) =>
                          setVoteEditing({ id: q.id, value: e.target.value })
                        }
                        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500/40"
                      />
                      <button
                        onClick={handleVoteSave}
                        disabled={state.busy}
                        className={`${buttonBase} ${tones.sky}`}
                      >
                        Save votes
                      </button>
                      <button
                        onClick={() => setVoteEditing(null)}
                        className={`${buttonBase} ${tones.ghost}`}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() =>
                        setVoteEditing({ id: q.id, value: String(q.votes) })
                      }
                      className={`${buttonBase} ${tones.ghost}`}
                    >
                      Edit votes
                    </button>
                  )}
                  <button
                    onClick={() => handleSyncVotes(q.id)}
                    disabled={state.busy}
                    className={`${buttonBase} ${tones.ghost}`}
                  >
                    Resync
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {merging && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setMerging(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl"
          >
            <h3 className="text-base font-serif font-semibold text-white mb-2">
              Mark duplicate and merge votes
            </h3>
            <p className="text-sm text-zinc-400 mb-4 italic">
              &ldquo;{merging.question}&rdquo;
            </p>
            {eventApprovedTargets.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No approved questions for this event to merge into.
              </p>
            ) : (
              <ul className="space-y-2 max-h-72 overflow-auto">
                {eventApprovedTargets.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2"
                  >
                    <span className="text-sm text-zinc-200 flex-1 line-clamp-2">
                      {t.question}
                    </span>
                    <button
                      onClick={() => handleMerge(t.id)}
                      disabled={state.busy}
                      className={`${buttonBase} ${tones.amber}`}
                    >
                      Merge votes
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => setMerging(null)}
              className="mt-5 w-full rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
