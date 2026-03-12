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

    // Get event capacity
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { capacity: true },
    });

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Get all tickets ordered by creation time
    const ticketResults = await db.query.tickets.findMany({
      where: eq(tickets.eventId, eventId),
      columns: { createdAt: true, type: true },
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    });

    const totalTickets = ticketResults.length;
    const vipCount = ticketResults.filter((t) => t.type === "VIP").length;
    const standardCount = totalTickets - vipCount;

    // Return individual timestamps — the client handles bucketing
    const timestamps = ticketResults.map((t) => t.createdAt.toISOString());

    // Compute milestones
    const milestonePercents = [25, 50, 75, 100];
    const milestones = milestonePercents.map((percent) => {
      const ticketNumber = Math.ceil((percent / 100) * event.capacity);
      const reached = totalTickets >= ticketNumber;
      const reachedAt =
        reached && ticketNumber > 0 && ticketNumber <= totalTickets
          ? ticketResults[ticketNumber - 1].createdAt.toISOString()
          : null;
      return { percent, reached, ticketNumber, reachedAt };
    });

    return NextResponse.json({
      timestamps,
      totalTickets,
      capacity: event.capacity,
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
