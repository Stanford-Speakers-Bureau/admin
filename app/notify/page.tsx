import AdminNotifyClient, { EventWithNotifications } from "./AdminNotifyClient";
import { verifyAdminRequest } from "@/app/lib/supabase";

export const dynamic = "force-dynamic";

async function getInitialNotifications(): Promise<EventWithNotifications[]> {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return [];
    }

    const client = auth.adminClient!;

    const [
      { data: events, error: eventsError },
      { data: notifications, error: notifyError },
    ] = await Promise.all([
      client
        .from("events")
        .select("id, name, start_time_date, route, ticketing_date")
        .order("start_time_date", { ascending: false }),
      client
        .from("notify")
        .select("id, email, created_at, speaker_id")
        .order("created_at", { ascending: false }),
    ]);

    if (eventsError) {
      console.error("Events fetch error:", eventsError);
    }
    if (notifyError) {
      console.error("Notifications fetch error:", notifyError);
    }

    // Fetch ALL ticket rows (Supabase caps at 1000 per query)
    const allTickets: { email: string; event_id: string }[] = [];
    const PAGE_SIZE = 1000;
    let ticketOffset = 0;
    let hasMore = true;
    while (hasMore) {
      const { data: page, error: ticketsError } = await client
        .from("tickets")
        .select("email, event_id")
        .range(ticketOffset, ticketOffset + PAGE_SIZE - 1);

      if (ticketsError) {
        console.error("Tickets fetch error:", ticketsError);
        break;
      }
      if (page && page.length > 0) {
        allTickets.push(...page);
        ticketOffset += page.length;
        hasMore = page.length === PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    // Build a set of "email|event_id" for quick lookup
    const ticketSet = new Set(
      allTickets.map((t) => `${t.email.toLowerCase()}|${t.event_id}`),
    );

    const now = new Date().toISOString();

    const eventsWithNotifications =
      events?.map((event: any) => {
        const ticketingOpen = event.ticketing_date && event.ticketing_date <= now;
        return {
          ...event,
          ticketingOpen: !!ticketingOpen,
          notifications:
            (notifications?.filter((n: any) => n.speaker_id === event.id) || []).map(
              (n: any) => ({
                ...n,
                hasTicket: ticketingOpen
                  ? ticketSet.has(`${n.email.toLowerCase()}|${event.id}`)
                  : false,
              }),
            ),
        };
      }) || [];

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
