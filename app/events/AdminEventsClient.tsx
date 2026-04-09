"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { PACIFIC_TIMEZONE } from "@/app/lib/constants";
import { useEventContext } from "@/app/EventContext";
import type { TicketingRole } from "@/app/lib/ticketingRoles";

function formatDisplayDate(dateString: string | null): string {
  if (!dateString) return "TBD";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "TBD";

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
  tickets_sold?: number;
  waitlist_count?: number;
  standby_count?: number;
};

type EventStatus = {
  label: string;
  color: string;
};

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

type EventCardImageProps = {
  event: Event;
};

function EventCardImage({ event }: EventCardImageProps) {
  const [isLoading, setIsLoading] = useState(true);

  if (!event.image_url) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <svg
          className="w-16 h-16 text-zinc-700"
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
    );
  }

  return (
    <>
      {isLoading && (
        <div className="absolute inset-0 bg-zinc-800 animate-pulse flex items-center justify-center">
          <svg
            className="w-10 h-10 text-zinc-700 animate-pulse"
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
      )}
      <Image
        src={event.image_url}
        alt={event.name || "Event"}
        fill
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        className={`object-cover transition-opacity duration-300 ${isLoading ? "opacity-0" : "opacity-100"}`}
        onLoad={() => setIsLoading(false)}
        priority
        unoptimized
      />
    </>
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
  const [events, setEvents] = useState<Event[]>(initialEvents);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setEvents(initialEvents);
  }, [initialEvents]);

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this event?")) return;

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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
            Event Management
          </h1>
          <p className="text-zinc-400">View and manage speaker events.</p>
        </div>
        <Link
          href="/events/edit?create=1"
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {events.map((event) => (
            <div
              key={event.id}
              className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden hover:border-zinc-700 transition-colors group"
            >
              <div className="relative h-48 bg-zinc-800">
                <EventCardImage event={event} />
                {event.live && (
                  <div className="absolute top-3 right-3 px-2 py-1 bg-red-500 text-white text-xs font-medium rounded-full z-10 flex items-center gap-1">
                    <svg
                      className="w-3 h-3"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                        clipRule="evenodd"
                      />
                    </svg>
                    LIVE
                  </div>
                )}
              </div>
              <div className="p-5">
                <h3 className="text-lg font-semibold text-white mb-1 truncate">
                  {event.name || "Mystery Speaker"}
                </h3>
                <div className="flex items-center gap-3 text-sm text-zinc-500 mb-1">
                  <span className="flex items-center gap-1">
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
                    {formatDisplayDate(event.start_time_date)}
                  </span>
                  <span className="flex items-center gap-1">
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
                    {event.tickets_sold ?? 0}/{event.capacity}
                    {(event.standby_count ?? 0) > 0 && (
                      <span className="text-amber-400/80 ml-1">
                        (+{event.standby_count} standby)
                      </span>
                    )}
                  </span>
                </div>
                <p
                  className={`text-xs font-medium mb-4 ${getEventStatus(event).color}`}
                >
                  {getEventStatus(event).label}
                </p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSelectAndEdit(event)}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 text-white rounded text-sm font-medium hover:bg-zinc-700 transition-colors"
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
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(event.id)}
                      className="px-4 py-2 text-rose-400 hover:bg-rose-500/10 rounded text-sm font-medium transition-colors"
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
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
