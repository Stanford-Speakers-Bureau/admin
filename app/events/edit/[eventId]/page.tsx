import { EventSync } from "@/app/EventSync";
import EditEventClient from "../EditEventClient";
import { getSignedImageUrl, verifyAdminRequest, serializeEvent } from "@/app/lib/supabase";
import { db } from "@ssb/db";
import { Event } from "../../AdminEventsClient";

export const dynamic = "force-dynamic";

async function getAllEvents(): Promise<Event[]> {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) return [];

    const eventList = await db.query.events.findMany({
      orderBy: (t, { desc }) => [desc(t.startTimeDate)],
    });

    const eventsWithImages = await Promise.all(
      eventList.map(async (event) => {
        const serialized = serializeEvent(event);
        return {
          ...serialized,
          image_url: event.img
            ? await getSignedImageUrl(event.img, 60 * 60)
            : null,
        };
      }),
    );

    return eventsWithImages as Event[];
  } catch (error) {
    console.error("Failed to fetch events:", error);
    return [];
  }
}

export default async function EditEventWithIdPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const events = await getAllEvents();
  return (
    <>
      <EventSync eventId={eventId} />
      <EditEventClient allEvents={events} />
    </>
  );
}
