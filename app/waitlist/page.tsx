import WaitlistViewerClient from "./WaitlistViewerClient";
import { verifyAdminRequest } from "@/app/lib/supabase";
import { db } from "@ssb/db";

export const dynamic = "force-dynamic";

type WaitlistEntry = {
  id: string;
  email: string;
  name: string | null;
  referral: string | null;
  position: number;
  created_at: string;
};

type EventDetails = {
  id: string;
  name: string | null;
  capacity: number;
  reserved: number | null;
  start_time_date: string | null;
  venue: string | null;
};

type EventGroup = {
  event: EventDetails;
  waitlist: WaitlistEntry[];
  totalCount: number;
};

async function getInitialWaitlist(): Promise<{
  waitlist: EventGroup[];
  isGrouped: boolean;
}> {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return { waitlist: [], isGrouped: true };
    }

    // Get all waitlist entries with event data
    const waitlistEntries = await db.query.waitlist.findMany({
      columns: {
        id: true,
        email: true,
        name: true,
        referral: true,
        position: true,
        createdAt: true,
        eventId: true,
      },
      with: {
        event: {
          columns: {
            id: true,
            name: true,
            capacity: true,
            reserved: true,
            startTimeDate: true,
            venue: true,
          },
        },
      },
      orderBy: (t, { desc, asc }) => [desc(t.eventId), asc(t.position)],
    });

    // Group by event
    const groupedByEvent: Record<string, EventGroup> = {};

    for (const entry of waitlistEntries) {
      const eventId = entry.eventId;
      if (!eventId || !entry.event) continue;

      if (!groupedByEvent[eventId]) {
        groupedByEvent[eventId] = {
          event: {
            id: entry.event.id,
            name: entry.event.name,
            capacity: entry.event.capacity,
            reserved: entry.event.reserved ?? null,
            start_time_date: entry.event.startTimeDate?.toISOString() ?? null,
            venue: entry.event.venue,
          },
          waitlist: [],
          totalCount: 0,
        };
      }

      groupedByEvent[eventId].waitlist.push({
        id: entry.id,
        email: entry.email,
        name: entry.name ?? null,
        referral: entry.referral,
        position: entry.position,
        created_at: entry.createdAt.toISOString(),
      });
      groupedByEvent[eventId].totalCount++;
    }

    return {
      waitlist: Object.values(groupedByEvent),
      isGrouped: true,
    };
  } catch (error) {
    console.error("Failed to fetch initial waitlist:", error);
    return { waitlist: [], isGrouped: true };
  }
}

async function getEvents() {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return [];
    }

    const events = await db.query.events.findMany({
      columns: { id: true, name: true, startTimeDate: true },
      orderBy: (t, { desc }) => [desc(t.startTimeDate)],
    });

    return events.map((e) => ({
      id: e.id,
      name: e.name,
      start_time_date: e.startTimeDate?.toISOString() ?? null,
    }));
  } catch (error) {
    console.error("Failed to fetch events:", error);
    return [];
  }
}

function getNextEventId(
  events: { id: string; start_time_date: string | null }[],
): string {
  if (!events.length) return "";
  const now = new Date().toISOString();
  const sorted = [...events].sort((a, b) => {
    const aVal = a.start_time_date ?? "";
    const bVal = b.start_time_date ?? "";
    return aVal.localeCompare(bVal);
  });
  const next = sorted.find((e) => (e.start_time_date ?? "") >= now);
  return next?.id ?? sorted[0]?.id ?? "";
}

export default async function AdminWaitlistPage() {
  const [{ waitlist, isGrouped }, events] = await Promise.all([
    getInitialWaitlist(),
    getEvents(),
  ]);

  const initialEventId = getNextEventId(events);

  return (
    <WaitlistViewerClient
      initialWaitlist={waitlist}
      initialEvents={events}
      isGrouped={isGrouped}
      initialEventId={initialEventId || undefined}
    />
  );
}
