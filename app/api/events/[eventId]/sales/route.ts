import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/supabase";
import { db, eq, events, tickets } from "@ssb/db";

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

    // Get event details to determine time range
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { releaseDate: true, startTimeDate: true },
    });

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Determine time range
    const startDate = event.releaseDate ?? new Date();
    const endDate = event.startTimeDate ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Get all tickets for this event with created_at timestamps
    const ticketResults = await db.query.tickets.findMany({
      where: eq(tickets.eventId, eventId),
      columns: { createdAt: true },
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    });

    // Always use 1-hour intervals
    const intervalHours = 1;

    // Create intervals
    const intervals: { time: string; count: number; cumulative: number }[] = [];
    let currentTime = new Date(startDate);
    let cumulativeCount = 0;

    while (currentTime < endDate) {
      const intervalEnd = new Date(
        currentTime.getTime() + intervalHours * 60 * 60 * 1000,
      );
      const intervalEndTime = intervalEnd > endDate ? endDate : intervalEnd;

      // Count tickets in this interval
      const intervalCount = ticketResults.filter((ticket) => {
        return ticket.createdAt >= currentTime && ticket.createdAt < intervalEndTime;
      }).length;

      cumulativeCount += intervalCount;

      intervals.push({
        time: currentTime.toISOString(),
        count: intervalCount,
        cumulative: cumulativeCount,
      });

      currentTime = intervalEnd;
    }

    // Ensure we have at least one data point
    if (intervals.length === 0) {
      intervals.push({
        time: new Date(startDate).toISOString(),
        count: 0,
        cumulative: 0,
      });
    }

    return NextResponse.json({
      data: intervals,
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
      totalTickets: ticketResults.length,
    });
  } catch (error) {
    console.error("Ticket sales fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
