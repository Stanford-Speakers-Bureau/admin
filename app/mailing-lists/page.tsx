import MailingListsClient from "./MailingListsClient";
import { verifyAdminRequest } from "@/app/lib/auth";
import {
  announceStats,
  listAnnounceMembers,
  listAnnounceOptOuts,
} from "@/app/lib/mailing-list";
import { db, desc, events } from "@ssb/db";

export const dynamic = "force-dynamic";

const INITIAL_LIMIT = 50;

async function getInitialData() {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return {
        rows: [],
        total: 0,
        optOuts: [],
        stats: { total: 0, optedOut: 0 },
        events: [],
      };
    }

    const [{ rows, total }, optOuts, stats, allEvents] = await Promise.all([
      listAnnounceMembers({ search: null, limit: INITIAL_LIMIT, offset: 0 }),
      listAnnounceOptOuts(),
      announceStats(),
      db.query.events.findMany({
        columns: { id: true, name: true, startTimeDate: true },
        orderBy: [desc(events.startTimeDate)],
      }),
    ]);

    return {
      rows,
      total,
      optOuts,
      stats,
      events: allEvents.map((e) => ({
        id: e.id,
        name: e.name ?? "Untitled event",
        startTime: e.startTimeDate?.toISOString() ?? null,
      })),
    };
  } catch (err) {
    console.error("[mailing-lists] initial load failed:", err);
    return {
      rows: [],
      total: 0,
      optOuts: [],
      stats: { total: 0, optedOut: 0 },
      events: [],
    };
  }
}

export default async function MailingListsPage() {
  const data = await getInitialData();
  return (
    <MailingListsClient
      initialRows={data.rows}
      initialTotal={data.total}
      initialOptOuts={data.optOuts}
      initialStats={data.stats}
      events={data.events}
      initialLimit={INITIAL_LIMIT}
    />
  );
}
