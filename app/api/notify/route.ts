import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/supabase";
import { isValidUUID } from "@/app/lib/validation";
import { db, eq, events, notify, tickets } from "@ssb/db";

export async function GET(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get("eventId");

    if (!eventId) {
      return NextResponse.json(
        { error: "eventId is required" },
        { status: 400 },
      );
    }

    if (!isValidUUID(eventId)) {
      return NextResponse.json(
        { error: "Invalid event ID format" },
        { status: 400 },
      );
    }

    // Fetch event, notifications, and ticket emails in parallel
    const [event, notifications, ticketResults] = await Promise.all([
      db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: {
          name: true,
          route: true,
          startTimeDate: true,
          ticketingDate: true,
        },
      }),
      db.query.notify.findMany({
        where: eq(notify.speakerId, eventId),
        columns: {
          id: true,
          email: true,
          createdAt: true,
        },
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      }),
      db.query.tickets.findMany({
        where: eq(tickets.eventId, eventId),
        columns: { email: true },
      }),
    ]);

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const ticketEmailSet = new Set(
      ticketResults.map((t) => t.email.toLowerCase()),
    );

    const now = new Date();
    const ticketingOpen = event.ticketingDate
      ? now >= new Date(event.ticketingDate)
      : false;

    return NextResponse.json({
      notifications: notifications.map((n) => ({
        id: n.id,
        email: n.email,
        created_at: n.createdAt.toISOString(),
        hasTicket: ticketEmailSet.has(n.email.toLowerCase()),
      })),
      eventData: {
        name: event.name,
        route: event.route,
        start_time_date: event.startTimeDate?.toISOString() ?? null,
        ticketing_date: event.ticketingDate?.toISOString() ?? null,
        ticketingOpen,
      },
    });
  } catch (error) {
    console.error("Admin notify fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
