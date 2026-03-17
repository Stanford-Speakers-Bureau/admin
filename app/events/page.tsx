import AdminEventsClient, { Event } from "./AdminEventsClient";
import { getSignedImageUrl, verifyAdminRequest, serializeEvent } from "@/app/lib/supabase";
import { db, eq, and, count as dbCount, tickets, waitlist } from "@ssb/db";

export const dynamic = "force-dynamic";

async function getTicketCount(eventId: string): Promise<number> {
  try {
    const [result] = await db.select({ count: dbCount() })
      .from(tickets)
      .where(eq(tickets.eventId, eventId));
    return result?.count ?? 0;
  } catch {
    return 0;
  }
}

async function getWaitlistCount(eventId: string): Promise<number> {
  try {
    const [result] = await db.select({ count: dbCount() })
      .from(waitlist)
      .where(eq(waitlist.eventId, eventId));
    return result?.count ?? 0;
  } catch {
    return 0;
  }
}

async function getStandbyCount(eventId: string): Promise<number> {
  try {
    const [result] = await db.select({ count: dbCount() })
      .from(tickets)
      .where(and(eq(tickets.eventId, eventId), eq(tickets.type, "STANDBY")));
    return result?.count ?? 0;
  } catch {
    return 0;
  }
}

async function getInitialEvents(): Promise<Event[]> {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return [];
    }

    const events = await db.query.events.findMany({
      orderBy: (t, { desc }) => [desc(t.startTimeDate)],
    });

    const eventsWithImages = await Promise.all(
      events.map(async (event) => {
        const serialized = serializeEvent(event);
        const [ticketsSold, waitlistCount, standbyCount] = await Promise.all([
          getTicketCount(event.id),
          getWaitlistCount(event.id),
          getStandbyCount(event.id),
        ]);
        return {
          ...serialized,
          image_url: event.img
            ? await getSignedImageUrl(event.img, 60 * 60) // 1 hour expiry
            : null,
          tickets_sold: ticketsSold,
          waitlist_count: waitlistCount,
          standby_count: standbyCount,
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
