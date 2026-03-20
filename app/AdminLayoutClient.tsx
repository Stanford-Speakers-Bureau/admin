"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEventContext } from "./EventContext";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  group: "top" | "events" | "analytics" | "admin";
};

type AdminLayoutClientProps = {
  children: React.ReactNode;
  userEmail: string | null;
  navItems: NavItem[];
  emailDisabled: boolean;
  hasLiveEvent: boolean;
};

/** Event-scoped base paths (longest first for matching). */
const EVENT_SCOPED_PATHS = [
  "/events/edit",
  "/sales",
  "/check-in",
  "/summary",
  "/tickets",
  "/waitlist",
  "/referrals",
  "/notify",
];

function getEventScopedHref(baseHref: string, eventId: string): string {
  return eventId ? `${baseHref}/${eventId}` : baseHref;
}

function isEventScoped(href: string): boolean {
  return EVENT_SCOPED_PATHS.includes(href);
}

export default function AdminLayoutClient({
  children,
  userEmail,
  navItems,
  emailDisabled,
  hasLiveEvent,
}: AdminLayoutClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { events, selectedEventId, setSelectedEventId } = useEventContext();

  const topItems = navItems.filter((i) => i.group === "top");
  const eventItems = navItems.filter((i) => i.group === "events");
  const analyticsItems = navItems.filter((i) => i.group === "analytics");
  const adminItems = navItems.filter((i) => i.group === "admin");

  function handleEventChange(newEventId: string) {
    setSelectedEventId(newEventId);
    if (!newEventId) return;

    // Find which event-scoped section we're currently in
    const currentSection = EVENT_SCOPED_PATHS.find(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    );
    if (currentSection) {
      router.push(`${currentSection}/${newEventId}`);
    }
  }

  function navHref(item: { href: string }): string {
    if (isEventScoped(item.href) && selectedEventId) {
      return `${item.href}/${selectedEventId}`;
    }
    return item.href;
  }

  function isNavActive(item: { href: string }): boolean {
    if (isEventScoped(item.href)) {
      return pathname === item.href || pathname.startsWith(item.href + "/");
    }
    return pathname === item.href;
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Desktop Sidebar — lg+ full, md icons-only */}
      <aside className="hidden md:flex fixed top-0 left-0 bottom-0 z-50 flex-col bg-zinc-900 border-r border-zinc-800 md:w-16 lg:w-64 transition-all">
        {/* Live event left stripe */}
        {hasLiveEvent && (
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500 z-10" />
        )}

        {/* Branding */}
        <div className="h-16 flex items-center gap-3 px-4 border-b border-zinc-800 shrink-0">
          <div className="w-8 h-8 bg-gradient-to-br from-rose-500 to-orange-500 rounded flex items-center justify-center shrink-0">
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <span className="text-white font-bold text-lg font-serif hidden lg:block">
            SSB Admin
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
          {topItems.map((item) => {
            const active = isNavActive(item);
            return (
              <Link
                key={item.href}
                href={navHref(item)}
                prefetch={false}
                title={item.label}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-rose-500/10 text-rose-400"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                }`}
              >
                <svg
                  className="w-5 h-5 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={item.icon}
                  />
                </svg>
                <span className="hidden lg:block">{item.label}</span>
              </Link>
            );
          })}

          <div className="my-3 border-t border-zinc-800" />

          <span className="hidden lg:block px-3 pb-1 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            Events
          </span>
          {eventItems.map((item) => {
            const active = isNavActive(item);
            return (
              <Link
                key={item.href}
                href={navHref(item)}
                prefetch={false}
                title={item.label}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-rose-500/10 text-rose-400"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                }`}
              >
                <svg
                  className="w-5 h-5 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={item.icon}
                  />
                </svg>
                <span className="hidden lg:block">{item.label}</span>
              </Link>
            );
          })}

          <div className="my-3 border-t border-zinc-800" />

          <span className="hidden lg:block px-3 pb-1 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            Analytics
          </span>
          {analyticsItems.map((item) => {
            const active = isNavActive(item);
            return (
              <Link
                key={item.href}
                href={navHref(item)}
                prefetch={false}
                title={item.label}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-rose-500/10 text-rose-400"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                }`}
              >
                <svg
                  className="w-5 h-5 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={item.icon}
                  />
                </svg>
                <span className="hidden lg:block">{item.label}</span>
              </Link>
            );
          })}

          <div className="my-3 border-t border-zinc-800" />

          <span className="hidden lg:block px-3 pb-1 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            Admin
          </span>
          {adminItems.map((item) => {
            const active = isNavActive(item);
            return (
              <Link
                key={item.href}
                href={navHref(item)}
                prefetch={false}
                title={item.label}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-rose-500/10 text-rose-400"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                }`}
              >
                <svg
                  className="w-5 h-5 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={item.icon}
                  />
                </svg>
                <span className="hidden lg:block">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Event selector */}
        <div className="px-2 py-3 border-t border-zinc-800">
          {/* Full dropdown on lg+ */}
          <div className="hidden lg:block">
            <label className="block px-3 pb-1 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Event
            </label>
            <select
              value={selectedEventId}
              onChange={(e) => handleEventChange(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm focus:outline-none focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/50"
            >
              <option value="">Select event</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name || "Unnamed Event"}
                </option>
              ))}
            </select>
          </div>
          {/* Icon-only trigger on md */}
          <div className="lg:hidden relative group">
            <div className="flex items-center justify-center">
              <svg
                className="w-5 h-5 text-zinc-400"
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
            {/* Tooltip-style dropdown on hover */}
            <div className="absolute left-full top-0 bottom-0 hidden group-hover:block z-50 pl-2">
              <div className="bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl p-2 min-w-[200px]">
                <p className="px-2 pb-1 text-xs font-semibold text-zinc-500 uppercase">Event</p>
                <select
                  value={selectedEventId}
                  onChange={(e) => handleEventChange(e.target.value)}
                  className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-600 rounded text-white text-sm focus:outline-none"
                >
                  <option value="">Select event</option>
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name || "Unnamed Event"}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Exit link */}
        <div className="px-2 pb-4 border-t border-zinc-800 pt-3">
          <Link
            href="https://stanfordspeakersbureau.com"
            prefetch={false}
            title="Exit to main site"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <svg
              className="w-5 h-5 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
            <span className="hidden lg:block">Exit</span>
          </Link>
        </div>
      </aside>

      {/* Mobile Event Selector */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-zinc-900/95 backdrop-blur-xl border-b border-zinc-800">
        <div className="flex items-center gap-2 px-3 py-2">
          <svg className="w-4 h-4 text-zinc-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <select
            value={selectedEventId}
            onChange={(e) => handleEventChange(e.target.value)}
            className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1.5 text-white text-sm focus:outline-none focus:border-rose-500/50 truncate"
          >
            <option value="">Select event</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name || "Unnamed Event"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-zinc-900/95 backdrop-blur-xl border-t border-zinc-800 z-50">
        <div className="h-full flex items-center gap-1 px-2 overflow-x-auto scrollbar-hide">
          {navItems.map((item) => {
            const active = isNavActive(item);
            return (
              <Link
                key={item.href}
                href={navHref(item)}
                prefetch={false}
                className={`flex flex-col items-center gap-1 px-3 py-2 rounded transition-all shrink-0 ${
                  active ? "text-rose-400" : "text-zinc-500 hover:text-white"
                }`}
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
                    d={item.icon}
                  />
                </svg>
                <span className="text-xs">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Global Live Event Indicator */}
      {hasLiveEvent && (
        <div className="fixed top-12 md:top-0 left-0 right-0 md:left-16 lg:left-64 z-[100] flex justify-center pointer-events-none">
          <div className="bg-red-500 px-4 py-1 rounded-b-md flex items-center gap-2">
            <svg
              className="w-4 h-4 text-white shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                clipRule="evenodd"
              />
            </svg>
            <p className="text-white text-sm font-bold">EVENT LIVE</p>
          </div>
        </div>
      )}

      {/* Global Email Disabled Banner */}
      {emailDisabled && (
        <div className="fixed top-12 md:top-0 left-0 right-0 md:left-16 lg:left-64 z-40 bg-amber-500/10 border-b border-amber-500/30 backdrop-blur-sm">
          <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
            <svg
              className="w-5 h-5 text-amber-400 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
            <p className="text-amber-400 text-sm font-medium">
              EMAIL SENDING DISABLED
            </p>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main
        className={`pb-20 md:pb-8 min-h-screen pt-12 md:pt-0 md:ml-16 lg:ml-64 ${
          emailDisabled ? "md:pt-12" : ""
        }`}
      >
        {children}
      </main>
    </div>
  );
}
