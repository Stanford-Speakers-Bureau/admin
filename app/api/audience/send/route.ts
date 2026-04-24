import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import { isValidUUID } from "@/app/lib/validation";
import { sendEventAnnouncedEmail } from "@/app/lib/email";
import { db, eq, events } from "@ssb/db";

export async function POST(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    let body: { eventId?: string; emails?: string[] };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { eventId, emails } = body;

    if (!eventId || typeof eventId !== "string" || !isValidUUID(eventId)) {
      return NextResponse.json(
        { error: "eventId is required and must be a valid UUID" },
        { status: 400 },
      );
    }

    if (!Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json(
        { error: "emails must be a non-empty array" },
        { status: 400 },
      );
    }

    if (emails.length > 50) {
      return NextResponse.json(
        { error: "Maximum 50 emails per request" },
        { status: 400 },
      );
    }

    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: {
        id: true,
        name: true,
        route: true,
        startTimeDate: true,
        ticketingDate: true,
        tagline: true,
        imgVersion: true,
        desc: true,
        venue: true,
        venueLink: true,
        doorsOpen: true,
      },
    });

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const eventName = event.name || "Event";
    const eventRoute = event.route ?? null;
    const eventStartTime = event.startTimeDate?.toISOString() ?? null;
    const ticketingOpen = event.ticketingDate
      ? new Date() >= new Date(event.ticketingDate)
      : false;

    // Send all emails in the chunk concurrently.
    // This is safe because announcement emails are lightweight (no QR code, no ICS).
    // Each chunk is max 50 emails, well within SES quota of 100/s and worker memory.
    const results = await Promise.allSettled(
      emails.map((email) =>
        sendEventAnnouncedEmail({
          email,
          eventName,
          eventRoute,
          eventStartTime,
          eventId: event.id,
          imgVersion: event.imgVersion,
          eventTagline: event.tagline || null,
          eventDescription: event.desc || null,
          eventVenue: event.venue || null,
          eventVenueLink: event.venueLink || null,
          doorsOpenTime: event.doorsOpen?.toISOString() || null,
          ticketingOpen,
        }).then(
          () => ({ success: true, email }),
          (error) => ({ success: false, email, error }),
        ),
      ),
    );

    let sent = 0;
    let failed = 0;
    for (const result of results) {
      if (result.status === "fulfilled" && result.value.success) {
        sent++;
      } else {
        failed++;
        if (result.status === "fulfilled") {
          const val = result.value as { success: boolean; email: string; error?: unknown };
          console.error(
            `Failed to send announcement to ${val.email}:`,
            val.error,
          );
        }
      }
    }

    return NextResponse.json({ sent, failed });
  } catch (err) {
    console.error("Audience send error:", err);
    return NextResponse.json(
      { error: "Failed to send announcement emails" },
      { status: 500 },
    );
  }
}
