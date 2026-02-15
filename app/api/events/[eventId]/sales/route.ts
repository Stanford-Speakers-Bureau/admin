import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/supabase";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const { eventId } = await params;

    if (!eventId) {
      return NextResponse.json(
        { error: "Event ID is required" },
        { status: 400 },
      );
    }

    const adminClient = auth.adminClient!;

    // Get event details
    const { data: event, error: eventError } = await adminClient
      .from("events")
      .select("release_date, start_time_date, capacity")
      .eq("id", eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Fetch all tickets with created_at and type
    const allTickets: { created_at: string; type: string | null }[] = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: tickets, error: ticketsError } = await adminClient
        .from("tickets")
        .select("created_at, type")
        .eq("event_id", eventId)
        .order("created_at", { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (ticketsError) {
        console.error("Tickets fetch error:", ticketsError);
        return NextResponse.json(
          { error: "Failed to fetch ticket data" },
          { status: 500 },
        );
      }

      if (tickets && tickets.length > 0) {
        allTickets.push(...tickets);
        hasMore = tickets.length === pageSize;
        page++;
      } else {
        hasMore = false;
      }
    }

    const totalTickets = allTickets.length;
    const vipCount = allTickets.filter((t) => t.type === "VIP").length;
    const standardCount = totalTickets - vipCount;

    // Milestones
    const capacity = event.capacity || 0;
    const milestones = [25, 50, 75, 100].map((pct) => {
      const target = Math.ceil((capacity * pct) / 100);
      const reached = totalTickets >= target;
      return {
        percent: pct,
        reached,
        ticketNumber: target,
        reachedAt:
          reached && allTickets.length >= target
            ? allTickets[target - 1].created_at
            : null,
      };
    });

    // Send raw timestamps for client-side bucketing (just the ISO strings)
    const timestamps = allTickets.map((t) => t.created_at);

    return NextResponse.json({
      timestamps,
      totalTickets,
      capacity,
      vipCount,
      standardCount,
      milestones,
    });
  } catch (error) {
    console.error("Ticket sales fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
