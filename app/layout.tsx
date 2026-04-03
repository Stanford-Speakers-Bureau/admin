import AdminLayoutClient from "./AdminLayoutClient";
import { EventProvider } from "./EventContext";
import { getNextEventId } from "@/app/lib/eventUtils";
import { verifyAdminRequest } from "@/app/lib/auth";
import { db, eq, desc, events } from "@ssb/db";
import "./globals.css";
import { Hedvig_Letters_Serif, Inter } from "next/font/google";
import { Metadata } from "next";
import { connection } from "next/server";

const baseURL = process.env.BASE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(baseURL),
  title: "Stanford Speakers Bureau",
  description:
    "Stanford's largest student organization sponsor of speaking events since 1935. We meet weekly to discuss upcoming speakers and determine who is of interest to the Stanford community.",
  openGraph: {
    title: "Stanford Speakers Bureau",
    description:
      "Stanford's largest student organization sponsor of speaking events since 1935. We meet weekly to discuss upcoming speakers and determine who is of interest to the Stanford community.",
    url: `${baseURL}`,
  },
};

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const hedvigLettersSerif = Hedvig_Letters_Serif({
  variable: "--font-hedvig-letters-serif",
  subsets: ["latin"],
  weight: ["400"],
});

type AdminLayoutProps = {
  children: React.ReactNode;
};

const navItems = [
  {
    href: "/",
    label: "Dashboard",
    group: "top" as const,
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  {
    href: "/events",
    label: "Events",
    group: "events" as const,
    icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  },
  {
    href: "/events/edit",
    label: "Edit Event",
    group: "events" as const,
    icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  },
  {
    href: "/notify-analytics",
    label: "Notify",
    group: "analytics" as const,
    icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
  },
  {
    href: "/sales",
    label: "Sales",
    group: "analytics" as const,
    icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  },
  {
    href: "/check-in",
    label: "Check-in",
    group: "analytics" as const,
    icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    href: "/summary",
    label: "Summary",
    group: "analytics" as const,
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  },
  {
    href: "/tickets",
    label: "Tickets",
    group: "events" as const,
    icon: "M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 002 2h3a2 2 0 002-2V7a2 2 0 00-2-2H5zM5 13a2 2 0 00-2 2v3a2 2 0 002 2h3a2 2 0 002-2v-3a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2v-3z",
  },
  {
    href: "/waitlist",
    label: "Waitlist",
    group: "events" as const,
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
  },
  {
    href: "/referrals",
    label: "Referrals",
    group: "events" as const,
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z",
  },
  {
    href: "/notify",
    label: "Notifications",
    group: "events" as const,
    icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
  },
  {
    href: "/audience",
    label: "Audience",
    group: "events" as const,
    icon: "M17 20h5v-1a4 4 0 00-5.874-3.57M17 20H2v-1a4 4 0 014-4h7a4 4 0 014 4zm-5-9a3 3 0 110-6 3 3 0 010 6zm6-1a2 2 0 110-4 2 2 0 010 4z",
  },
  {
    href: "/attendance",
    label: "Attendance",
    group: "admin" as const,
    icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  },
  {
    href: "/suggest",
    label: "Suggestions",
    group: "admin" as const,
    icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
  },
  {
    href: "/users",
    label: "Users",
    group: "admin" as const,
    icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z",
  },
  {
    href: "/audit",
    label: "Audit Log",
    group: "admin" as const,
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
  },
];

export const dynamic = "force-dynamic";

async function checkLiveEvent(): Promise<boolean> {
  try {
    const liveEvent = await db.query.events.findFirst({
      where: eq(events.live, true),
      columns: { id: true },
    });

    return !!liveEvent;
  } catch (error) {
    console.error("Failed to check live event:", error);
    return false;
  }
}

async function getEvents() {
  try {
    const eventList = await db.query.events.findMany({
      columns: { id: true, name: true, startTimeDate: true, standbyEnabled: true, live: true },
      orderBy: desc(events.startTimeDate),
    });

    return eventList.map((e) => ({
      id: e.id,
      name: e.name,
      start_time_date: e.startTimeDate?.toISOString() ?? null,
      standbyEnabled: e.standbyEnabled ?? false,
      live: e.live ?? false,
    }));
  } catch (error) {
    console.error("Failed to fetch events for layout:", error);
    return [];
  }
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  await connection();
  const auth = await verifyAdminRequest();

  if (!auth.authorized) {
    if (auth.error === "Not authenticated") {
      const loginUrl = `/api/auth/login?redirect_to=${encodeURIComponent("/")}`;
      return (
        <html>
          <body className={`${inter.variable} ${hedvigLettersSerif.variable} antialiased`}>
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
              <div className="text-center">
                <h1 className="text-2xl font-bold text-white mb-4 font-serif">Stanford Speakers Bureau</h1>
                <p className="text-zinc-400 mb-6">Sign in with Stanford SSO to continue.</p>
                <a
                  href={loginUrl}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-white text-zinc-900 rounded-xl font-medium hover:bg-zinc-100 transition-colors"
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
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  Sign in with Stanford
                </a>
              </div>
            </div>
          </body>
        </html>
      );
    }

    // User is authenticated but not an admin
    return (
      <html>
        <body className={`${inter.variable} ${hedvigLettersSerif.variable} antialiased`}>
          <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-white mb-4 font-serif">Access Denied</h1>
              <p className="text-zinc-400 mb-6">Your account does not have admin access.</p>
              <a
                href={process.env.NEXT_PUBLIC_BASE_URL || "https://stanfordspeakersbureau.com"}
                className="inline-flex items-center gap-2 px-6 py-3 bg-zinc-800 text-white rounded-xl font-medium hover:bg-zinc-700 transition-colors"
              >
                Go to Main Site
              </a>
            </div>
          </div>
        </body>
      </html>
    );
  }

  const [emailDisabled, hasLiveEvent, eventList] = await Promise.all([
    Promise.resolve(process.env.DISABLE_EMAIL === "true"),
    checkLiveEvent(),
    getEvents(),
  ]);

  const defaultEventId = getNextEventId(eventList);

  return (
    <html>
      <body
        className={`${inter.variable} ${hedvigLettersSerif.variable} antialiased`}
      >
        <EventProvider events={eventList} defaultEventId={defaultEventId}>
          <AdminLayoutClient
            navItems={navItems}
            emailDisabled={emailDisabled}
            hasLiveEvent={hasLiveEvent}
          >
            {children}
          </AdminLayoutClient>
        </EventProvider>
      </body>
    </html>
  );
}
