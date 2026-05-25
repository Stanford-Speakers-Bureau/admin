"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useConfirmationDialog } from "@/app/components/ConfirmationDialog";
import { PACIFIC_TIMEZONE } from "@/app/lib/constants";
import { useEventContext } from "@/app/EventContext";
import type { TicketingRole } from "@/app/lib/ticketingRoles";

export type Event = {
  id: string;
  created_at: string;
  name: string | null;
  desc: string | null;
  tagline: string | null;
  img: string | null;
  mobile_img: string | null;
  apple_wallet_img: string | null;
  img_version: number | null;
  capacity: number;
  tickets?: number | null;
  venue: string | null;
  reserved: number | null;
  venue_link: string | null;
  release_date: string | null;
  ticketing_date?: string | null;
  start_time_date: string | null;
  end_time_date: string | null;
  doors_open: string | null;
  route: string | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  image_url?: string | null;
  mobile_image_url?: string | null;
  apple_wallet_image_url?: string | null;
  live?: boolean | null;
  priority?: string | null;
  hide_ticketing_date?: boolean;
  livestream?: string | null;
  referrals_enabled?: boolean;
  standby_enabled?: boolean | null;
  ticketing_roles?: TicketingRole[];
  external_ticketing_enabled?: boolean;
  external_ticketing_url?: string | null;
  banner_eligible?: boolean;
  identity_verification_enabled?: boolean;
  allow_admitting_standby?: boolean;
  tickets_sold?: number;
  waitlist_count?: number;
  standby_count?: number;
};

type EventStatus = {
  label: string;
  color: string;
};

function formatShortDate(dateString: string | null): {
  date: string;
  time: string;
} {
  if (!dateString) return { date: "TBD", time: "" };
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return { date: "TBD", time: "" };

  return {
    date: new Intl.DateTimeFormat("en-US", {
      timeZone: PACIFIC_TIMEZONE,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date),
    time: new Intl.DateTimeFormat("en-US", {
      timeZone: PACIFIC_TIMEZONE,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date),
  };
}

function getEventStatus(event: Event): EventStatus {
  const now = new Date();

  // Mystery event: no name and release_date in future
  const isMystery =
    !event.name && event.release_date && new Date(event.release_date) > now;

  const eventStart = event.start_time_date
    ? new Date(event.start_time_date)
    : null;
  const eventEnd = event.end_time_date
    ? new Date(event.end_time_date)
    : eventStart
      ? new Date(eventStart.getTime() + 6 * 60 * 60 * 1000)
      : null;

  if (eventEnd && now >= eventEnd) {
    return { label: "Event Over", color: "text-zinc-500" };
  }

  if (event.live) {
    return { label: "Happening Now", color: "text-emerald-400" };
  }

  if (eventStart && now >= eventStart) {
    return { label: "Event Started", color: "text-emerald-400" };
  }

  if (event.standby_enabled) {
    return { label: "Standby Line Open", color: "text-amber-400" };
  }

  if (isMystery) {
    return { label: "Mystery Speaker", color: "text-purple-400" };
  }

  const maxPublic = Math.max(0, event.capacity - (event.reserved || 0));
  const isSoldOut =
    event.capacity > 0 && (event.tickets_sold || 0) >= maxPublic;

  if (isSoldOut) {
    return { label: "Sold Out", color: "text-orange-400" };
  }

  const ticketingDate = event.ticketing_date
    ? new Date(event.ticketing_date)
    : null;
  if (ticketingDate && now < ticketingDate) {
    if (event.hide_ticketing_date) {
      return { label: "Tickets Drop (Hidden)", color: "text-blue-400" };
    }
    const formatted = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: PACIFIC_TIMEZONE,
    }).format(ticketingDate);
    return { label: `Tickets Drop ${formatted}`, color: "text-blue-400" };
  }

  return { label: "Tickets Available", color: "text-emerald-400" };
}

type EventThumbnailProps = {
  event: Event;
};

function EventThumbnail({ event }: EventThumbnailProps) {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-zinc-800 ring-1 ring-white/5">
      {!event.image_url ? (
        <div className="flex size-full items-center justify-center">
          <svg
            className="size-6 text-zinc-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
      ) : (
        <>
          {isLoading && (
            <div className="absolute inset-0 animate-pulse bg-zinc-800" />
          )}
          <Image
            src={event.image_url}
            alt={event.name || "Event"}
            fill
            sizes="48px"
            className={`object-cover transition-opacity duration-300 ${isLoading ? "opacity-0" : "opacity-100"}`}
            onLoad={() => setIsLoading(false)}
            unoptimized
          />
        </>
      )}
    </div>
  );
}

function StatusBadge({ event }: { event: Event }) {
  const status = getEventStatus(event);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2 py-1 text-xs font-medium whitespace-nowrap ${status.color}`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {status.label}
    </span>
  );
}

function CapacityMeter({ event }: { event: Event }) {
  const sold = event.tickets_sold ?? 0;
  const capacity = event.capacity || 0;
  const pct = capacity > 0 ? Math.min(100, Math.round((sold / capacity) * 100)) : 0;
  const isFull = capacity > 0 && sold >= capacity;

  return (
    <div className="w-32">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-zinc-300 tabular-nums">
          {sold}
          <span className="text-zinc-600">/{capacity}</span>
        </span>
        {(event.standby_count ?? 0) > 0 && (
          <span className="text-amber-400/80 tabular-nums">
            +{event.standby_count}
          </span>
        )}
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full w-(--fill) rounded-full ${isFull ? "bg-orange-400" : "bg-emerald-500"}`}
          style={{ "--fill": `${pct}%` } as Record<string, string>}
        />
      </div>
    </div>
  );
}

type AdminEventsClientProps = {
  initialEvents: Event[];
};

export default function AdminEventsClient({
  initialEvents,
}: AdminEventsClientProps) {
  const router = useRouter();
  const { setSelectedEventId, removeEvent } = useEventContext();
  const { confirm: confirmAction, confirmationDialog } =
    useConfirmationDialog();
  const [events, setEvents] = useState<Event[]>(initialEvents);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setEvents(initialEvents);
  }, [initialEvents]);

  const filteredEvents = events.filter((event) => {
    if (!query.trim()) return true;
    const haystack = `${event.name ?? "Mystery Speaker"} ${event.venue ?? ""} ${event.tagline ?? ""}`;
    return haystack.toLowerCase().includes(query.trim().toLowerCase());
  });

  async function handleDelete(id: string) {
    const shouldDelete = await confirmAction({
      title: "Delete this event?",
      description:
        "This permanently removes the event from the admin dashboard.",
      confirmLabel: "Delete event",
      tone: "danger",
    });
    if (!shouldDelete) return;

    try {
      const response = await fetch("/api/events", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (response.ok) {
        setEvents((prev) => prev.filter((e) => e.id !== id));
        removeEvent(id);
        setSuccess("Event deleted successfully!");
        router.refresh();
      } else {
        const data = await response.json();
        setError(data.error || "Failed to delete event");
      }
    } catch (err) {
      console.error("Failed to delete event:", err);
      setError("Failed to delete event. Please try again.");
    }
  }

  function handleSelectAndEdit(event: Event) {
    setSelectedEventId(event.id);
    router.push(`/events/edit/${event.id}`);
  }

  return (
    <div className="px-4 sm:px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
            Event Management
          </h1>
          <p className="text-zinc-400">
            View and manage speaker events.
            {events.length > 0 && (
              <span className="text-zinc-600">
                {" "}
                · {events.length} total
              </span>
            )}
          </p>
        </div>
        <Link
          href="/events/edit?create=1"
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
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
          Create Event
        </Link>
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

      {events.length === 0 ? (
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
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <p className="text-zinc-400 text-lg mb-2">No events yet</p>
          <p className="text-zinc-600 text-sm mb-6">
            Create your first speaker event to get started.
          </p>
          <Link
            href="/events/edit?create=1"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
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
            Create Event
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-4 relative max-w-sm">
            <svg
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500"
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
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or venue…"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900/50 py-2 pr-3 pl-9 text-sm text-white placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          {filteredEvents.length === 0 ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 py-16 text-center">
              <p className="text-zinc-400">
                No events match &ldquo;{query}&rdquo;.
              </p>
            </div>
          ) : (
            <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6">
              <div className="inline-block min-w-full px-4 py-2 align-middle sm:px-6">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-800 text-left text-xs font-medium text-zinc-500">
                      <th className="py-3 pr-4 font-medium whitespace-nowrap">
                        Event
                      </th>
                      <th className="px-4 py-3 font-medium whitespace-nowrap">
                        Date
                      </th>
                      <th className="px-4 py-3 font-medium whitespace-nowrap">
                        Status
                      </th>
                      <th className="px-4 py-3 font-medium whitespace-nowrap">
                        Tickets
                      </th>
                      <th className="py-3 pl-4 text-right font-medium whitespace-nowrap">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEvents.map((event) => {
                      const { date, time } = formatShortDate(
                        event.start_time_date,
                      );
                      return (
                        <tr
                          key={event.id}
                          className="group border-b border-zinc-800/70 transition-colors hover:bg-zinc-900/60"
                        >
                          <td className="py-3 pr-4">
                            <button
                              onClick={() => handleSelectAndEdit(event)}
                              className="flex items-center gap-3 text-left"
                            >
                              <EventThumbnail event={event} />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="truncate font-medium text-white group-hover:text-emerald-400 transition-colors">
                                    {event.name || "Mystery Speaker"}
                                  </span>
                                  {event.live && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 py-0.5 pr-2 pl-1.5 text-xs font-medium text-red-400">
                                      <span className="size-1.5 animate-pulse rounded-full bg-red-400" />
                                      LIVE
                                    </span>
                                  )}
                                </div>
                                {event.venue && (
                                  <p className="truncate text-xs text-zinc-500">
                                    {event.venue}
                                  </p>
                                )}
                              </div>
                            </button>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="text-sm text-zinc-300">{date}</div>
                            {time && (
                              <div className="text-xs text-zinc-500">{time}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge event={event} />
                          </td>
                          <td className="px-4 py-3">
                            <CapacityMeter event={event} />
                          </td>
                          <td className="py-3 pl-4">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleSelectAndEdit(event)}
                                className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
                                title="Edit event"
                              >
                                <svg
                                  className="size-4"
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
                              <button
                                onClick={() => handleDelete(event.id)}
                                className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                                title="Delete event"
                              >
                                <svg
                                  className="size-4"
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
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
      {confirmationDialog}
    </div>
  );
}
