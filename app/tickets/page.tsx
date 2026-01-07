import TicketManagementClient, { Ticket } from "./TicketManagementClient";
import { verifyAdminRequest } from "@/app/lib/supabase";

export const dynamic = "force-dynamic";

async function getInitialTickets(): Promise<{
  tickets: Ticket[];
  total: number;
  scannedCount: number;
  unscannedCount: number;
  filteredCount: number;
}> {
  // Don't load any tickets initially - require event selection
  return {
    tickets: [],
    total: 0,
    scannedCount: 0,
    unscannedCount: 0,
    filteredCount: 0,
  };
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

export default async function AdminTicketsPage() {
  const [
    { tickets, total, scannedCount, unscannedCount, filteredCount },
    events,
  ] = await Promise.all([getInitialTickets(), getEvents()]);

  return (
    <TicketManagementClient
      initialTickets={tickets}
      initialTotal={total}
      initialScannedCount={scannedCount}
      initialUnscannedCount={unscannedCount}
      initialFilteredCount={filteredCount}
      initialEvents={events}
    />
  );
}
