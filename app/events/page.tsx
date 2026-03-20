import AdminEventsClient, { Event } from "./AdminEventsClient";
import { getSignedImageUrl, verifyAdminRequest, serializeEvent } from "@/app/lib/supabase";
import { db, eq, ne, count as dbCount, tickets, waitlist } from "@ssb/db";

export const dynamic = "force-dynamic";

async function getInitialEvents(): Promise<Event[]> {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return [];
    }

    const events = await db.query.events.findMany({
      orderBy: (t, { desc }) => [desc(t.startTimeDate)],
    });

    // Batch count queries — one query each instead of per-event
    const [ticketCounts, waitlistCounts, standbyCounts] = await Promise.all([
      db.select({ eventId: tickets.eventId, count: dbCount() })
        .from(tickets)
        .where(ne(tickets.type, "STANDBY"))
        .groupBy(tickets.eventId),
      db.select({ eventId: waitlist.eventId, count: dbCount() })
        .from(waitlist)
        .groupBy(waitlist.eventId),
      db.select({ eventId: tickets.eventId, count: dbCount() })
        .from(tickets)
        .where(eq(tickets.type, "STANDBY"))
        .groupBy(tickets.eventId),
    ]);

    const ticketMap = new Map(ticketCounts.map((r) => [r.eventId, r.count]));
    const waitlistMap = new Map(waitlistCounts.map((r) => [r.eventId, r.count]));
    const standbyMap = new Map(standbyCounts.map((r) => [r.eventId, r.count]));

    const eventsWithImages = await Promise.all(
      events.map(async (event) => {
        const serialized = serializeEvent(event);
        return {
          ...serialized,
          image_url: event.img
            ? await getSignedImageUrl(event.img, 60 * 60)
            : null,
          tickets_sold: ticketMap.get(event.id) ?? 0,
          waitlist_count: waitlistMap.get(event.id) ?? 0,
          standby_count: standbyMap.get(event.id) ?? 0,
        };
      }),
    );

    return eventsWithImages as Event[];
  } catch (error) {
    console.error("Failed to fetch initial events:", error);
    return [];
  }
}

export default async function AdminEventsPage() {
  const initialEvents = await getInitialEvents();
  return <AdminEventsClient initialEvents={initialEvents} />;
}
