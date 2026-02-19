import AdminNotifyClient, { EventWithNotifications } from "./AdminNotifyClient";
import { verifyAdminRequest } from "@/app/lib/supabase";
import { db } from "@ssb/db";

export const dynamic = "force-dynamic";

async function getInitialNotifications(): Promise<EventWithNotifications[]> {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return [];
    }

    const [events, notifications] = await Promise.all([
      db.query.events.findMany({
        columns: { id: true, name: true, startTimeDate: true, route: true, ticketingDate: true },
        orderBy: (t, { desc }) => [desc(t.startTimeDate)],
      }),
      db.query.notify.findMany({
        columns: { id: true, email: true, createdAt: true, speakerId: true },
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      }),
    ]);

    const eventsWithNotifications = events.map((event) => ({
      id: event.id,
      name: event.name,
      start_time_date: event.startTimeDate?.toISOString() ?? null,
      route: event.route,
      ticketing_date: event.ticketingDate?.toISOString() ?? null,
      notifications: notifications
        .filter((n) => n.speakerId === event.id)
        .map((n) => ({
          id: n.id,
          email: n.email,
          created_at: n.createdAt.toISOString(),
          speaker_id: n.speakerId,
        })),
    }));

    return eventsWithNotifications as EventWithNotifications[];
  } catch (error) {
    console.error("Failed to fetch initial notifications:", error);
    return [];
  }
}

export default async function AdminNotifyPage() {
  const initialEvents = await getInitialNotifications();
  return <AdminNotifyClient initialEvents={initialEvents} />;
}
