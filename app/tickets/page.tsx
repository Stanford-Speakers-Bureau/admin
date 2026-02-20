import TicketManagementClient, { Ticket } from "./TicketManagementClient";
import { verifyAdminRequest } from "@/app/lib/supabase";
import { db } from "@ssb/db";

export const dynamic = "force-dynamic";

async function getInitialTickets(): Promise<{
  tickets: Ticket[];
  total: number;
  scannedCount: number;
  unscannedCount: number;
  filteredCount: number;
  standardCount: number;
  vipCount: number;
  externalCount: number;
  waitlistCount: number;
}> {
  // Don't load any tickets initially - require event selection
  return {
    tickets: [],
    total: 0,
    scannedCount: 0,
    unscannedCount: 0,
    filteredCount: 0,
    standardCount: 0,
    vipCount: 0,
    externalCount: 0,
    waitlistCount: 0,
  };
}

async function getEvents() {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return [];
    }

    const events = await db.query.events.findMany({
      columns: { id: true, name: true, startTimeDate: true, waitlistMode: true },
      orderBy: (t, { desc }) => [desc(t.startTimeDate)],
    });

    return events.map((e) => ({
      id: e.id,
      name: e.name,
      start_time_date: e.startTimeDate?.toISOString() ?? null,
      waitlist: e.waitlistMode ?? false,
    }));
  } catch (error) {
    console.error("Failed to fetch events:", error);
    return [];
  }
}

export default async function AdminTicketsPage() {
  const [
    {
      tickets,
      total,
      scannedCount,
      unscannedCount,
      filteredCount,
      standardCount,
      vipCount,
      externalCount,
      waitlistCount,
    },
    events,
  ] = await Promise.all([getInitialTickets(), getEvents()]);

  return (
    <TicketManagementClient
      initialTickets={tickets}
      initialTotal={total}
      initialScannedCount={scannedCount}
      initialUnscannedCount={unscannedCount}
      initialFilteredCount={filteredCount}
      initialStandardCount={standardCount}
      initialVipCount={vipCount}
      initialExternalCount={externalCount}
      initialWaitlistCount={waitlistCount}
      initialEvents={events}
    />
  );
}
