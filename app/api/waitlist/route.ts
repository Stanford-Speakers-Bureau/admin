import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import { isValidUUID } from "@/app/lib/validation";
import { sendStandbyLineEmail } from "@/app/lib/email";
import { PACIFIC_TIMEZONE } from "@/app/lib/constants";
import { db, eq, and, inArray, waitlist, events, tickets } from "@ssb/db";
import { logAuditEvent } from "@/app/lib/audit";

async function sendWithRetry(
  fn: () => Promise<void>,
  maxAttempts = 4,
): Promise<void> {
  let delay = 500;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await new Promise((res) => setTimeout(res, delay));
      delay *= 2;
    }
  }
}

export async function GET(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get("eventId");

    // If eventId is provided, validate and return single event waitlist
    if (eventId) {
      if (!isValidUUID(eventId)) {
        return NextResponse.json(
          { error: "Invalid event ID format" },
          { status: 400 },
        );
      }

      // Get event details
      const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: {
          id: true,
          name: true,
          capacity: true,
          reserved: true,
          startTimeDate: true,
          venue: true,
          standbyEnabled: true,
        },
      });

      if (!event) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }

      // Get waitlist for this event
      const waitlistEntries = await db.query.waitlist.findMany({
        where: eq(waitlist.eventId, eventId),
        columns: {
          id: true,
          email: true,
          name: true,
          referral: true,
          position: true,
          createdAt: true,
        },
        orderBy: (t, { asc }) => [asc(t.position)],
      });

      return NextResponse.json(
        {
          event: {
            id: event.id,
            name: event.name,
            capacity: event.capacity,
            reserved: event.reserved ?? null,
            start_time_date: event.startTimeDate?.toISOString() ?? null,
            venue: event.venue,
            standbyMode: event.standbyEnabled,
          },
          waitlist: waitlistEntries.map((e) => ({
            id: e.id,
            email: e.email,
            name: e.name,
            referral: e.referral,
            position: e.position,
            created_at: e.createdAt.toISOString(),
          })),
          totalCount: waitlistEntries.length,
          grouped: false,
        },
        { status: 200 },
      );
    }

    // No eventId - return all waitlist entries grouped by event
    const allWaitlistEntries = await db.query.waitlist.findMany({
      columns: {
        id: true,
        email: true,
        name: true,
        referral: true,
        position: true,
        createdAt: true,
        eventId: true,
      },
      with: {
        event: {
          columns: {
            id: true,
            name: true,
            capacity: true,
            reserved: true,
            startTimeDate: true,
            venue: true,
          },
        },
      },
      orderBy: (t, { desc, asc }) => [desc(t.eventId), asc(t.position)],
    });

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
          name: string | null;
          referral: string | null;
          position: number;
          created_at: string;
        }>;
        totalCount: number;
      }
    > = {};

    allWaitlistEntries.forEach((entry) => {
      const evtId = entry.eventId;
      if (!evtId || !entry.event) return;

      if (!groupedByEvent[evtId]) {
        groupedByEvent[evtId] = {
          event: {
            id: entry.event.id,
            name: entry.event.name,
            capacity: entry.event.capacity,
            reserved: entry.event.reserved ?? null,
            start_time_date: entry.event.startTimeDate?.toISOString() ?? null,
            venue: entry.event.venue,
          },
          waitlist: [],
          totalCount: 0,
        };
      }

      groupedByEvent[evtId].waitlist.push({
        id: entry.id,
        email: entry.email,
        name: entry.name,
        referral: entry.referral,
        position: entry.position,
        created_at: entry.createdAt.toISOString(),
      });
      groupedByEvent[evtId].totalCount++;
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

export async function POST(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const body = await req.json();
    const { eventId, waitlistOpenTime, expectedCapacity } = body;

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

    // Fetch event details
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: {
        id: true,
        name: true,
        startTimeDate: true,
        doorsOpen: true,
        venue: true,
        venueLink: true,
      },
    });

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Fetch all waitlist entries for this event
    const waitlistEntries = await db.query.waitlist.findMany({
      where: eq(waitlist.eventId, eventId),
      columns: { id: true, email: true, name: true },
    });

    if (!waitlistEntries || waitlistEntries.length === 0) {
      return NextResponse.json(
        { error: "No waitlist entries found for this event" },
        { status: 404 },
      );
    }

    // Format doors open time from event, falling back to request body or default
    const doorsOpenFormatted = event.doorsOpen
      ? new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZone: PACIFIC_TIMEZONE,
        }).format(new Date(event.doorsOpen))
      : (waitlistOpenTime ?? "7:30 PM");

    // Issue a STANDBY ticket to each person and send the email
    let successCount = 0;
    let errorCount = 0;
    let skippedExistingCount = 0;
    const errors: string[] = [];
    const issuedStandbyIds: string[] = [];

    for (const entry of waitlistEntries) {
      try {
        const existingTicket = await db.query.tickets.findFirst({
          where: and(
            eq(tickets.eventId, eventId),
            eq(tickets.email, entry.email),
          ),
          columns: { id: true },
        });

        if (existingTicket) {
          issuedStandbyIds.push(entry.id);
          skippedExistingCount++;
          continue;
        }

        // Create STANDBY ticket
        const [inserted] = await db.insert(tickets).values({
          eventId,
          email: entry.email,
          name: entry.name ?? null,
          type: "STANDBY",
        }).returning({ id: tickets.id });

        await sendWithRetry(() =>
          sendStandbyLineEmail({
            email: entry.email,
            name: entry.name,
            eventName: event.name || "Event",
            eventStartTime: event.startTimeDate?.toISOString() ?? null,
            eventVenue: event.venue,
            eventVenueLink: event.venueLink,
            standbyOpenTime: doorsOpenFormatted,
            expectedCapacity: expectedCapacity || "100-200",
            ticketId: inserted.id,
          })
        );

        issuedStandbyIds.push(entry.id);
        successCount++;
      } catch (error) {
        errorCount++;
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        errors.push(`${entry.email}: ${errorMessage}`);
        console.error(`Failed to issue standby ticket for ${entry.email}:`, error);
      }
    }

    // Remove successfully processed entries from the online waitlist
    if (issuedStandbyIds.length > 0) {
      await db.delete(waitlist).where(inArray(waitlist.id, issuedStandbyIds));
    }

    await logAuditEvent({
      action: "waitlist.issue_standby",
      actor: auth.email!,
      eventId: eventId,
      eventName: event.name ?? null,
      metadata: { totalEntries: waitlistEntries.length, emailsSent: successCount, errors: errorCount, skipped: skippedExistingCount },
    });

    return NextResponse.json(
      {
        success: true,
        totalEntries: waitlistEntries.length,
        emailsSent: successCount,
        errors: errorCount,
        skippedExistingTickets: skippedExistingCount,
        errorDetails: errors.length > 0 ? errors : undefined,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Admin waitlist closed email error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
