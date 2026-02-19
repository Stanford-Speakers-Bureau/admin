import AdminEventsClient, { Event } from "./AdminEventsClient";
import { getSignedImageUrl, verifyAdminRequest, serializeEvent } from "@/app/lib/supabase";
import { db } from "@ssb/db";

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

    const eventsWithImages = await Promise.all(
      events.map(async (event) => {
        const serialized = serializeEvent(event);
        return {
          ...serialized,
          image_url: event.img
            ? await getSignedImageUrl(event.img, 60 * 60) // 1 hour expiry
            : null,
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
