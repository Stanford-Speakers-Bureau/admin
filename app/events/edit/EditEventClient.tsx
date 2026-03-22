"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { PACIFIC_TIMEZONE } from "@/app/lib/constants";
import { useEventContext } from "@/app/EventContext";
import MarkdownEditor from "../MarkdownEditor";
import { Event } from "../AdminEventsClient";

function formatDateTimeForInput(dateString: string | null): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const lookup: Record<string, string> = {};
  parts.forEach(({ type, value }) => {
    lookup[type] = value;
  });

  return `${lookup.year}-${lookup.month}-${lookup.day}T${lookup.hour}:${lookup.minute}`;
}

type FormData = {
  name: string;
  desc: string;
  tagline: string;
  capacity: string;
  tickets: string;
  reserved: string;
  venue: string;
  venue_link: string;
  release_date: string;
  ticketing_date: string;
  start_time_date: string;
  end_time_date: string;
  doors_open: string;
  route: string;
  priority: string;
  hide_ticketing_date: boolean;
  referrals_enabled: boolean;
  livestream: string;
  latitude: string;
  longitude: string;
  address: string;
};

const emptyForm: FormData = {
  name: "",
  desc: "",
  tagline: "",
  capacity: "",
  tickets: "",
  reserved: "",
  venue: "",
  venue_link: "",
  release_date: "",
  ticketing_date: "",
  start_time_date: "",
  end_time_date: "",
  doors_open: "",
  route: "",
  priority: "This event is only open to Stanford affiliates",
  hide_ticketing_date: false,
  referrals_enabled: false,
  livestream: "",
  latitude: "",
  longitude: "",
  address: "",
};

function sortEvents(events: Event[]): Event[] {
  return [...events].sort((a, b) => {
    const aVal = a.start_time_date ?? "";
    const bVal = b.start_time_date ?? "";
    return bVal.localeCompare(aVal);
  });
}

function toEventOption(event: Event) {
  return {
    id: event.id,
    name: event.name,
    start_time_date: event.start_time_date,
    standbyEnabled: event.standby_enabled ?? false,
    live: event.live ?? false,
  };
}

function eventToFormData(event: Event): FormData {
  return {
    name: event.name || "",
    desc: event.desc || "",
    tagline: event.tagline || "",
    capacity: event.capacity?.toString() || "",
    tickets: event.tickets?.toString() || "",
    reserved: event.reserved?.toString() || "",
    venue: event.venue || "",
    venue_link: event.venue_link || "",
    release_date: formatDateTimeForInput(event.release_date),
    ticketing_date: formatDateTimeForInput(event.ticketing_date ?? null),
    start_time_date: formatDateTimeForInput(event.start_time_date),
    end_time_date: formatDateTimeForInput(event.end_time_date),
    doors_open: formatDateTimeForInput(event.doors_open),
    route: event.route || "",
    priority: event.priority || "This event is only open to Stanford affiliates",
    hide_ticketing_date: event.hide_ticketing_date || false,
    referrals_enabled: event.referrals_enabled || false,
    livestream: event.livestream || "",
    latitude: event.latitude?.toString() || "",
    longitude: event.longitude?.toString() || "",
    address: event.address || "",
  };
}

function readFilePreview(
  file: File,
  onLoad: (result: string) => void,
) {
  const reader = new FileReader();
  reader.onloadend = () => {
    onLoad(reader.result as string);
  };
  reader.readAsDataURL(file);
}

type EditEventClientProps = {
  allEvents: Event[];
};

export default function EditEventClient({ allEvents }: EditEventClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedEventId, setSelectedEventId, upsertEvent } = useEventContext();
  const [events, setEvents] = useState<Event[]>(allEvents);
  const isCreating = searchParams.get("create") === "1";

  const currentEvent = events.find((e) => e.id === selectedEventId) ?? null;

  const [formData, setFormData] = useState<FormData>(
    currentEvent ? eventToFormData(currentEvent) : emptyForm,
  );
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(
    currentEvent?.image_url || null,
  );
  const [mobileImageFile, setMobileImageFile] = useState<File | null>(null);
  const [mobileImagePreview, setMobileImagePreview] = useState<string | null>(
    currentEvent?.mobile_image_url || null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mobileFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEvents(allEvents);
  }, [allEvents]);

  // Sync form when selected event changes
  useEffect(() => {
    if (isCreating) {
      setFormData(emptyForm);
      setImagePreview(null);
      setMobileImagePreview(null);
    } else if (currentEvent) {
      setFormData(eventToFormData(currentEvent));
      setImagePreview(currentEvent.image_url || null);
      setMobileImagePreview(currentEvent.mobile_image_url || null);
    } else {
      setFormData(emptyForm);
      setImagePreview(null);
      setMobileImagePreview(null);
    }
    setImageFile(null);
    setMobileImageFile(null);
    setError(null);
    setSuccess(null);
  }, [selectedEventId, isCreating, currentEvent]);

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      readFilePreview(file, setImagePreview);
    }
  }

  function handleMobileImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setMobileImageFile(file);
      readFilePreview(file, setMobileImagePreview);
    }
  }

  function handleStartCreate() {
    router.push("/events/edit?create=1");
  }

  function handleCancelCreate() {
    if (currentEvent) {
      router.push(`/events/edit/${currentEvent.id}`);
      return;
    }

    router.push("/events/edit");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      if (formData.release_date && formData.ticketing_date) {
        const publish = new Date(formData.release_date);
        const ticketing = new Date(formData.ticketing_date);
        if (Number.isNaN(publish.getTime()) || Number.isNaN(ticketing.getTime())) {
          setError("Invalid date format");
          return;
        }
        if (ticketing.getTime() < publish.getTime()) {
          setError("Ticketing date must be on or after the release date.");
          return;
        }
      }

      if (formData.start_time_date && formData.end_time_date) {
        const start = new Date(formData.start_time_date);
        const end = new Date(formData.end_time_date);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          setError("Invalid date format");
          return;
        }
        if (end.getTime() < start.getTime()) {
          setError("End time must be on or after the event start time.");
          return;
        }
      }

      const submitData = new FormData();
      submitData.append("name", formData.name);
      submitData.append("desc", formData.desc);
      submitData.append("tagline", formData.tagline);
      submitData.append("capacity", formData.capacity);
      submitData.append("tickets", formData.tickets);
      submitData.append("reserved", formData.reserved);
      submitData.append("venue", formData.venue);
      submitData.append("venue_link", formData.venue_link);
      submitData.append("release_date", formData.release_date);
      submitData.append("ticketing_date", formData.ticketing_date);
      submitData.append("start_time_date", formData.start_time_date);
      submitData.append("end_time_date", formData.end_time_date);
      submitData.append("doors_open", formData.doors_open);
      submitData.append("route", formData.route);
      submitData.append("priority", formData.priority);
      submitData.append("hide_ticketing_date", formData.hide_ticketing_date.toString());
      submitData.append("referrals_enabled", formData.referrals_enabled.toString());
      submitData.append("livestream", formData.livestream);
      submitData.append("latitude", formData.latitude);
      submitData.append("longitude", formData.longitude);
      submitData.append("address", formData.address);

      if (imageFile) {
        submitData.append("image", imageFile);
      }
      if (mobileImageFile) {
        submitData.append("mobile_image", mobileImageFile);
      }

      if (!isCreating && currentEvent) {
        submitData.append("id", currentEvent.id);
      }

      const response = await fetch("/api/events", {
        method: "POST",
        body: submitData,
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to save event");
        return;
      }

      const savedEvent = data.event as Event;
      setEvents((prev) => {
        const exists = prev.some((event) => event.id === savedEvent.id);
        if (exists) {
          return sortEvents(prev.map((event) => (
            event.id === savedEvent.id ? savedEvent : event
          )));
        }

        return sortEvents([savedEvent, ...prev]);
      });
      upsertEvent(toEventOption(savedEvent));
      setFormData(eventToFormData(savedEvent));
      setImagePreview(savedEvent.image_url || null);
      setMobileImagePreview(savedEvent.mobile_image_url || null);
      setImageFile(null);
      setMobileImageFile(null);
      setSelectedEventId(savedEvent.id);
      setSuccess(isCreating ? "Event created!" : "Changes saved!");

      if (isCreating) {
        router.push(`/events/edit/${savedEvent.id}`);
      }

      router.refresh();
    } catch (err) {
      console.error("Failed to save event:", err);
      setError("Failed to save event. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const editingEvent = isCreating ? null : currentEvent;
  const hasEvent = !!selectedEventId && !!currentEvent;
  const mobileImageDisplayPreview = mobileImagePreview || imagePreview;

  return (
    <div className="px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
            {isCreating ? "Create New Event" : hasEvent ? "Edit Event" : "Edit Event"}
          </h1>
          {hasEvent && !isCreating && (
            <p className="text-zinc-400">
              Editing: {currentEvent?.name || "Unnamed Event"}
            </p>
          )}
        </div>
        {!isCreating && (
          <button
            onClick={handleStartCreate}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            New Event
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-3">
          <svg className="w-5 h-5 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-rose-400 text-sm">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-3">
          <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-emerald-400 text-sm">{success}</p>
        </div>
      )}

      {!hasEvent && !isCreating ? (
        <div className="text-center py-16 bg-zinc-900/50 rounded-2xl border border-zinc-800">
          <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-zinc-400 text-lg mb-2">No event selected</p>
          <p className="text-zinc-600 text-sm mb-6">
            Select an event from the sidebar, or create a new one.
          </p>
          <button
            onClick={handleStartCreate}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Create Event
          </button>
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6">
          {isCreating && (
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">New Event</h2>
              <button
                onClick={handleCancelCreate}
                className="text-zinc-400 hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Speaker Name</label>
                <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g., John Doe" className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">URL Route</label>
                <div className="flex items-center">
                  <span className="text-zinc-500 pr-2">/events/</span>
                  <input type="text" value={formData.route} onChange={(e) => setFormData({ ...formData, route: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} placeholder="john-doe" className="flex-1 px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Capacity</label>
                <input type="number" value={formData.capacity} onChange={(e) => setFormData({ ...formData, capacity: e.target.value })} placeholder="e.g., 500" className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Tickets Sold</label>
                <input type="number" value={formData.tickets} disabled={true} placeholder="e.g., 250" className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-400 cursor-not-allowed" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Reserved Seats (optional)</label>
                <input type="number" value={formData.reserved} onChange={(e) => setFormData({ ...formData, reserved: e.target.value })} placeholder="e.g., 50" className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Venue</label>
                <input type="text" value={formData.venue} onChange={(e) => setFormData({ ...formData, venue: e.target.value })} placeholder="e.g., Memorial Auditorium" className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-zinc-300 mb-2">Venue Link (Google Maps)</label>
                <input type="url" value={formData.venue_link} onChange={(e) => setFormData({ ...formData, venue_link: e.target.value })} placeholder="https://maps.google.com/..." className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-zinc-300 mb-2">Address</label>
                <input type="text" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="123 Main St, City, State 12345" className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Latitude <span className="text-rose-400">*</span></label>
                <input type="number" step="any" value={formData.latitude} onChange={(e) => setFormData({ ...formData, latitude: e.target.value })} placeholder="e.g., 37.7749" className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Longitude <span className="text-rose-400">*</span></label>
                <input type="number" step="any" value={formData.longitude} onChange={(e) => setFormData({ ...formData, longitude: e.target.value })} placeholder="e.g., -122.4194" className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Release Date (when to reveal speaker)</label>
                <input type="datetime-local" value={formData.release_date} onChange={(e) => setFormData({ ...formData, release_date: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Ticketing Date (when ticket sales open)</label>
                <input type="datetime-local" value={formData.ticketing_date} onChange={(e) => setFormData({ ...formData, ticketing_date: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50" />
                {formData.release_date && formData.ticketing_date && (() => {
                  const publish = new Date(formData.release_date);
                  const ticketing = new Date(formData.ticketing_date);
                  if (Number.isNaN(publish.getTime()) || Number.isNaN(ticketing.getTime())) return null;
                  if (ticketing.getTime() < publish.getTime()) {
                    return <p className="mt-2 text-sm text-rose-400">Ticketing date must be on or after the release date.</p>;
                  }
                  return null;
                })()}
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Event Start Date & Time</label>
                <input type="datetime-local" value={formData.start_time_date} onChange={(e) => setFormData({ ...formData, start_time_date: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Event End Date & Time</label>
                <input type="datetime-local" value={formData.end_time_date} onChange={(e) => setFormData({ ...formData, end_time_date: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50" />
                {formData.start_time_date && formData.end_time_date && (() => {
                  const start = new Date(formData.start_time_date);
                  const end = new Date(formData.end_time_date);
                  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
                  if (end.getTime() < start.getTime()) {
                    return <p className="mt-2 text-sm text-rose-400">End time must be on or after the event start time.</p>;
                  }
                  return null;
                })()}
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Doors Open</label>
                <input type="datetime-local" value={formData.doors_open} onChange={(e) => setFormData({ ...formData, doors_open: e.target.value })} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50" />
              </div>

              <MarkdownEditor label="Priority Notice" value={formData.priority} onChange={(v) => setFormData({ ...formData, priority: v })} placeholder="e.g. This event is only open to Stanford affiliates" rows={2} />

              <div className="flex items-center gap-3">
                <input type="checkbox" id="hide_ticketing_date" checked={formData.hide_ticketing_date} onChange={(e) => setFormData({ ...formData, hide_ticketing_date: e.target.checked })} className="w-5 h-5 rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500/50" />
                <label htmlFor="hide_ticketing_date" className="text-sm font-medium text-zinc-300">Hide Ticketing Date</label>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Livestream URL</label>
                <input type="text" value={formData.livestream} onChange={(e) => setFormData({ ...formData, livestream: e.target.value })} placeholder="https://youtube.com/..." className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50" />
              </div>
            </div>

            <MarkdownEditor label="Tagline" value={formData.tagline} onChange={(v) => setFormData({ ...formData, tagline: v })} placeholder="Short tagline for the speaker..." rows={2} />
            <MarkdownEditor label="Description" value={formData.desc} onChange={(v) => setFormData({ ...formData, desc: v })} placeholder="Event description..." rows={4} />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Event Image</label>
                <div className="flex items-start gap-4">
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="relative w-32 h-32 bg-zinc-800 border-2 border-dashed border-zinc-600 rounded-xl overflow-hidden cursor-pointer hover:border-zinc-500 transition-colors flex items-center justify-center"
                  >
                    {imagePreview ? (
                      <Image src={imagePreview} alt="Event image preview" fill className="object-cover" unoptimized />
                    ) : (
                      <svg className="w-8 h-8 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                    )}
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                  <div className="text-sm text-zinc-500 space-y-1">
                    <p>Recommended: 800x800px or larger</p>
                    <p>Supported formats: JPG, PNG, WebP</p>
                    {imageFile && <p className="text-emerald-400 pt-1">Selected: {imageFile.name}</p>}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Mobile Event Image (optional)</label>
                <div className="flex items-start gap-4">
                  <div
                    onClick={() => mobileFileInputRef.current?.click()}
                    className="relative w-32 h-32 bg-zinc-800 border-2 border-dashed border-zinc-600 rounded-xl overflow-hidden cursor-pointer hover:border-zinc-500 transition-colors flex items-center justify-center"
                  >
                    {mobileImageDisplayPreview ? (
                      <Image src={mobileImageDisplayPreview} alt="Mobile event image preview" fill className="object-cover" unoptimized />
                    ) : (
                      <svg className="w-8 h-8 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                    )}
                  </div>
                  <input ref={mobileFileInputRef} type="file" accept="image/*" onChange={handleMobileImageChange} className="hidden" />
                  <div className="text-sm text-zinc-500 space-y-1">
                    <p>Shown on mobile event pages only.</p>
                    <p>Leave extra space near the top for safe cropping.</p>
                    <p>Avoid placing faces or key text near the top edge.</p>
                    <p>Falls back to the regular event image when omitted.</p>
                    {mobileImageFile && <p className="text-emerald-400 pt-1">Selected: {mobileImageFile.name}</p>}
                    {!mobileImageFile && !mobileImagePreview && imagePreview && (
                      <p className="text-zinc-400 pt-1">Currently previewing the regular event image as the fallback.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4 pt-4 border-t border-zinc-800">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isSubmitting ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {editingEvent ? "Save Changes" : "Create Event"}
              </button>
              {isCreating && (
                <button type="button" onClick={handleCancelCreate} className="px-6 py-3 text-zinc-400 hover:text-white transition-colors">
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
