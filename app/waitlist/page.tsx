import WaitlistViewerClient from "./WaitlistViewerClient";
import { verifyAdminRequest } from "@/app/lib/supabase";

export const dynamic = "force-dynamic";

type WaitlistEntry = {
  id: string;
  email: string;
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

    const client = auth.adminClient!;

    // Get all waitlist entries with event data
    const { data: waitlistEntries, error: waitlistError } = await client
      .from("waitlist")
      .select(
        `
        id,
        email,
        referral,
        position,
        created_at,
        event_id,
        events (
          id,
          name,
          capacity,
          reserved,
          start_time_date,
          venue
        )
      `,
      )
      .order("event_id", { ascending: false })
      .order("position", { ascending: true });

    if (waitlistError) {
      console.error("Waitlist fetch error:", waitlistError);
      return { waitlist: [], isGrouped: true };
    }

    // Group by event
    const groupedByEvent: Record<string, EventGroup> = {};

    waitlistEntries?.forEach((entry) => {
      const eventId = entry.event_id;
      if (!eventId) return;

      // Handle events relation - Supabase may return it as array or object
      let eventData: EventDetails | null = null;

      if (Array.isArray(entry.events)) {
        eventData = entry.events[0] || null;
      } else if (entry.events) {
        eventData = entry.events as EventDetails;
      }

      if (!eventData || !eventData.id) return;

      if (!groupedByEvent[eventId]) {
        groupedByEvent[eventId] = {
          event: {
            id: eventData.id,
            name: eventData.name,
            capacity: eventData.capacity,
            reserved: eventData.reserved,
            start_time_date: eventData.start_time_date,
            venue: eventData.venue,
          },
          waitlist: [],
          totalCount: 0,
        };
      }

      groupedByEvent[eventId].waitlist.push({
        id: entry.id,
        email: entry.email,
        referral: entry.referral,
        position: entry.position,
        created_at: entry.created_at,
      });
      groupedByEvent[eventId].totalCount++;
    });

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

    const client = auth.adminClient!;

    const { data: events, error } = await client
      .from("events")
      .select("id, name")
      .order("start_time_date", { ascending: false });

    if (error) {
      console.error("Events fetch error:", error);
      return [];
    }

    return events || [];
  } catch (error) {
    console.error("Failed to fetch events:", error);
    return [];
  }
}

export default async function AdminWaitlistPage() {
  const [{ waitlist, isGrouped }, events] = await Promise.all([
    getInitialWaitlist(),
    getEvents(),
  ]);

  return (
    <WaitlistViewerClient
      initialWaitlist={waitlist}
      initialEvents={events}
      isGrouped={isGrouped}
    />
  );
}
