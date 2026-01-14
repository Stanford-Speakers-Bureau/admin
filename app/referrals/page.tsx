import ReferralLeaderboardClient from "./ReferralLeaderboardClient";
import { verifyAdminRequest } from "@/app/lib/supabase";

export const dynamic = "force-dynamic";

async function getInitialLeaderboard() {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return { leaderboard: [], isGrouped: true };
    }

    const client = auth.adminClient!;

    // Fetch referrals and checked-in tickets in parallel
    const [{ data: referrals, error }, { data: tickets, error: ticketsError }] =
      await Promise.all([
        client
          .from("referrals")
          .select(
            `
        referral_code,
        count,
        event_id,
        events (
          id,
          name,
          route,
          start_time_date
        )
      `,
          )
          .order("count", { ascending: false }),
        client
          .from("tickets")
          .select("referral, event_id, scanned")
          .eq("scanned", true)
          .not("referral", "is", null),
      ]);

    if (error) {
      console.error("Referrals fetch error:", error);
      return { leaderboard: [], isGrouped: true };
    }

    if (ticketsError) {
      console.error("Tickets fetch error:", ticketsError);
    }

    // Build a map of referral_code -> event_id -> checked_in_count
    const checkedInMap: Record<string, Record<string, number>> = {};
    tickets?.forEach((ticket) => {
      if (!ticket.referral) return;
      if (!checkedInMap[ticket.referral]) {
        checkedInMap[ticket.referral] = {};
      }
      if (!checkedInMap[ticket.referral][ticket.event_id]) {
        checkedInMap[ticket.referral][ticket.event_id] = 0;
      }
      checkedInMap[ticket.referral][ticket.event_id]++;
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

    referrals?.forEach((ref) => {
      const eventId = ref.event_id;
      if (!eventId) return;

      // Handle events relation - Supabase may return it as array or object
      let eventData: {
        id: string;
        name: string | null;
        route: string | null;
        start_time_date: string | null;
      } | null = null;

      if (Array.isArray(ref.events)) {
        eventData = ref.events[0] || null;
      } else if (ref.events) {
        eventData = ref.events as typeof eventData;
      }

      if (!eventData || !eventData.id) return;

      if (!groupedByEvent[eventId]) {
        groupedByEvent[eventId] = {
          event: {
            id: eventData.id,
            name: eventData.name ?? null,
            route: eventData.route ?? null,
          },
          referrals: [],
        };
      }
      groupedByEvent[eventId].referrals.push({
        referral_code: ref.referral_code,
        count: ref.count || 0,
        checked_in_count: checkedInMap[ref.referral_code]?.[eventId] || 0,
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
