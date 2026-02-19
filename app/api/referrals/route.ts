import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/supabase";
import { db, eq, and, isNotNull, referrals, tickets } from "@ssb/db";

export async function GET(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get("eventId");

    // Build where conditions
    const referralConditions = eventId ? eq(referrals.eventId, eventId) : undefined;
    const ticketConditions = eventId
      ? and(eq(tickets.scanned, true), isNotNull(tickets.referral), eq(tickets.eventId, eventId))
      : and(eq(tickets.scanned, true), isNotNull(tickets.referral));

    // Fetch referrals and checked-in tickets in parallel
    const [referralResults, ticketResults] = await Promise.all([
      db.query.referrals.findMany({
        where: referralConditions,
        columns: { referralCode: true, count: true, eventId: true },
        with: {
          event: {
            columns: { id: true, name: true, route: true, startTimeDate: true },
          },
        },
        orderBy: (t, { desc }) => [desc(t.count)],
      }),
      db.query.tickets.findMany({
        where: ticketConditions,
        columns: { referral: true, eventId: true },
      }),
    ]);

    // Build a map of referral_code -> event_id -> checked_in_count
    const checkedInMap: Record<string, Record<string, number>> = {};
    ticketResults.forEach((ticket) => {
      if (!ticket.referral || !ticket.eventId) return;
      if (!checkedInMap[ticket.referral]) {
        checkedInMap[ticket.referral] = {};
      }
      if (!checkedInMap[ticket.referral][ticket.eventId]) {
        checkedInMap[ticket.referral][ticket.eventId] = 0;
      }
      checkedInMap[ticket.referral][ticket.eventId]++;
    });

    // Group by event if no eventId filter
    if (!eventId) {
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

      referralResults.forEach((ref) => {
        const evtId = ref.eventId;
        if (!evtId || !ref.event) return;

        if (!groupedByEvent[evtId]) {
          groupedByEvent[evtId] = {
            event: {
              id: ref.event.id,
              name: ref.event.name ?? null,
              route: ref.event.route ?? null,
            },
            referrals: [],
          };
        }

        const refCode = ref.referralCode ?? "";
        groupedByEvent[evtId].referrals.push({
          referral_code: refCode,
          count: ref.count || 0,
          checked_in_count: checkedInMap[refCode]?.[evtId] || 0,
        });
      });

      // Sort referrals within each event by count
      Object.values(groupedByEvent).forEach((group) => {
        group.referrals.sort((a, b) => b.count - a.count);
      });

      return NextResponse.json({
        leaderboard: Object.values(groupedByEvent),
        grouped: true,
      });
    }

    // Single event - return flat list
    const leaderboard = referralResults
      .map((ref) => ({
        referral_code: ref.referralCode ?? "",
        count: ref.count || 0,
        checked_in_count: checkedInMap[ref.referralCode ?? ""]?.[ref.eventId] || 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Get event data from first referral
    const eventData = referralResults[0]?.event
      ? {
          id: referralResults[0].event.id,
          name: referralResults[0].event.name ?? null,
          route: referralResults[0].event.route ?? null,
          start_time_date: referralResults[0].event.startTimeDate?.toISOString() ?? null,
        }
      : null;

    return NextResponse.json({
      leaderboard,
      event: eventData,
      grouped: false,
    });
  } catch (error) {
    console.error("Referral leaderboard fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
