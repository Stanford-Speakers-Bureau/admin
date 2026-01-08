import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/supabase";
import { isValidUUID } from "@/app/lib/validation";

export async function GET(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get("eventId");

    const adminClient = auth.adminClient;

    // If eventId is provided, validate and return single event waitlist
    if (eventId) {
      if (!isValidUUID(eventId)) {
        return NextResponse.json(
          { error: "Invalid event ID format" },
          { status: 400 },
        );
      }

      // Get event details
      const { data: event, error: eventError } = await adminClient
        .from("events")
        .select("id, name, capacity, reserved, start_time_date, venue")
        .eq("id", eventId)
        .single();

      if (eventError || !event) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }

      // Get waitlist for this event
      const { data: waitlist, error: waitlistError } = await adminClient
        .from("waitlist")
        .select("id, email, referral, position, created_at")
        .eq("event_id", eventId)
        .order("position", { ascending: true });

      if (waitlistError) {
        console.error("Waitlist fetch error:", waitlistError);
        return NextResponse.json(
          { error: "Failed to fetch waitlist" },
          { status: 500 },
        );
      }

      return NextResponse.json(
        {
          event,
          waitlist: waitlist || [],
          totalCount: waitlist?.length || 0,
          grouped: false,
        },
        { status: 200 },
      );
    }

    // No eventId - return all waitlist entries grouped by event
    const { data: waitlistEntries, error: waitlistError } = await adminClient
      .from("waitlist")
      .select(
        `
        id,
        email,
        referral,
        position,
        created_at,
        event_id,
        events (
          id,
          name,
          capacity,
          reserved,
          start_time_date,
          venue
        )
      `,
      )
      .order("event_id", { ascending: false })
      .order("position", { ascending: true });

    if (waitlistError) {
      console.error("Waitlist fetch error:", waitlistError);
      return NextResponse.json(
        { error: "Failed to fetch waitlist" },
        { status: 500 },
      );
    }

    // Group by event
    const groupedByEvent: Record<
      string,
      {
        event: {
          id: string;
          name: string | null;
          capacity: number;
          reserved: number | null;
          start_time_date: string | null;
          venue: string | null;
        };
        waitlist: Array<{
          id: string;
          email: string;
          referral: string | null;
          position: number;
          created_at: string;
        }>;
        totalCount: number;
      }
    > = {};

    waitlistEntries?.forEach((entry) => {
      const eventId = entry.event_id;
      if (!eventId) return;

      // Handle events relation - Supabase may return it as array or object
      let eventData: {
        id: string;
        name: string | null;
        capacity: number;
        reserved: number | null;
        start_time_date: string | null;
        venue: string | null;
      } | null = null;

      if (Array.isArray(entry.events)) {
        eventData = entry.events[0] || null;
      } else if (entry.events) {
        eventData = entry.events as typeof eventData;
      }

      if (!eventData || !eventData.id) return;

      if (!groupedByEvent[eventId]) {
        groupedByEvent[eventId] = {
          event: {
            id: eventData.id,
            name: eventData.name,
            capacity: eventData.capacity,
            reserved: eventData.reserved,
            start_time_date: eventData.start_time_date,
            venue: eventData.venue,
          },
          waitlist: [],
          totalCount: 0,
        };
      }

      groupedByEvent[eventId].waitlist.push({
        id: entry.id,
        email: entry.email,
        referral: entry.referral,
        position: entry.position,
        created_at: entry.created_at,
      });
      groupedByEvent[eventId].totalCount++;
    });

    return NextResponse.json(
      {
        leaderboard: Object.values(groupedByEvent),
        grouped: true,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Admin waitlist fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
