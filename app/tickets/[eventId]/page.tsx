import { EventSync } from "@/app/EventSync";
import TicketManagementClient from "../TicketManagementClient";

export const dynamic = "force-dynamic";

export default async function TicketsEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return (
    <>
      <EventSync eventId={eventId} />
      <TicketManagementClient
        initialTickets={[]}
        initialTotal={0}
        initialScannedCount={0}
        initialUnscannedCount={0}
        initialFilteredCount={0}
        initialStandardCount={0}
        initialVipCount={0}
        initialExternalCount={0}
        initialStandbyCount={0}
      />
    </>
  );
}
