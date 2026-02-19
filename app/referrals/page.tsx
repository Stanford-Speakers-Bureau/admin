import ReferralLeaderboardClient from "./ReferralLeaderboardClient";
import { verifyAdminRequest } from "@/app/lib/supabase";
import { db, eq, and, isNotNull, tickets } from "@ssb/db";

export const dynamic = "force-dynamic";

async function getInitialLeaderboard() {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return { leaderboard: [], isGrouped: true };
    }

    // Fetch referrals and checked-in tickets in parallel
    const [referrals, scannedTickets] = await Promise.all([
      db.query.referrals.findMany({
        columns: { referralCode: true, count: true, eventId: true },
        with: {
          event: {
            columns: { id: true, name: true, route: true, startTimeDate: true },
          },
        },
        orderBy: (t, { desc }) => [desc(t.count)],
      }),
      db.query.tickets.findMany({
        where: and(eq(tickets.scanned, true), isNotNull(tickets.referral)),
        columns: { referral: true, eventId: true, scanned: true },
      }),
    ]);

    // Build a map of referral_code -> event_id -> checked_in_count
    const checkedInMap: Record<string, Record<string, number>> = {};
    scannedTickets.forEach((ticket) => {
      if (!ticket.referral || !ticket.eventId) return;
      if (!checkedInMap[ticket.referral]) {
        checkedInMap[ticket.referral] = {};
      }
      if (!checkedInMap[ticket.referral][ticket.eventId]) {
        checkedInMap[ticket.referral][ticket.eventId] = 0;
      }
      checkedInMap[ticket.referral][ticket.eventId]++;
    });

    // Group by event
    const groupedByEvent: Record<
      string,
      {
        event: { id: string; name: string | null; route: string | null };
        referrals: Array<{
          referral_code: string;
          count: number;
          checked_in_count: number;
        }>;
      }
    > = {};

    referrals.forEach((ref) => {
      const eventId = ref.eventId;
      if (!eventId || !ref.event) return;

      if (!groupedByEvent[eventId]) {
        groupedByEvent[eventId] = {
          event: {
            id: ref.event.id,
            name: ref.event.name ?? null,
            route: ref.event.route ?? null,
          },
          referrals: [],
        };
      }

      const refCode = ref.referralCode ?? "";
      groupedByEvent[eventId].referrals.push({
        referral_code: refCode,
        count: ref.count || 0,
        checked_in_count: checkedInMap[refCode]?.[eventId] || 0,
      });
    });

    // Sort referrals within each event by count
    Object.values(groupedByEvent).forEach((group) => {
      group.referrals.sort((a, b) => b.count - a.count);
    });

    return {
      leaderboard: Object.values(groupedByEvent),
      isGrouped: true,
    };
  } catch (error) {
    console.error("Failed to fetch initial leaderboard:", error);
    return { leaderboard: [], isGrouped: true };
  }
}

async function getEvents() {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return [];
    }

    const events = await db.query.events.findMany({
      columns: { id: true, name: true, startTimeDate: true },
      orderBy: (t, { desc }) => [desc(t.startTimeDate)],
    });

    return events.map((e) => ({
      id: e.id,
      name: e.name,
    }));
  } catch (error) {
    console.error("Failed to fetch events:", error);
    return [];
  }
}

export default async function AdminReferralsPage() {
  const [{ leaderboard, isGrouped }, events] = await Promise.all([
    getInitialLeaderboard(),
    getEvents(),
  ]);

  return (
    <ReferralLeaderboardClient
      initialLeaderboard={leaderboard}
      initialEvents={events}
      isGrouped={isGrouped}
    />
  );
}
