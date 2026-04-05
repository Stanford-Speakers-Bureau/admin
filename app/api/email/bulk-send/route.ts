import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import {
  sendClaimTicketEmail,
  sendEventAnnouncedEmail,
  sendTicketsAvailableInEmail,
  sendTicketsAvailableNowEmail,
} from "@/app/lib/email";
import { isValidUUID } from "@/app/lib/validation";
import { db, eq, events, notify, tickets } from "@ssb/db";
import { logAuditEvent } from "@/app/lib/audit";

const MAX_EMAILS_PER_REQUEST = 50;

type BulkEmailKind =
  | "announcement"
  | "ticketsAvailableNow"
  | "ticketsAvailableIn"
  | "claimTicket";

type BulkSendRequest = {
  eventId?: string;
  emails?: string[];
  kind?: BulkEmailKind;
  approxTimeUntilAvailable?: string;
};

function normalizeEmails(emails: string[]): string[] {
  return [...new Set(
    emails
      .filter((email): email is string => typeof email === "string")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )];
}

export async function POST(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    let body: BulkSendRequest;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const {
      eventId,
      emails: rawEmails,
      kind,
      approxTimeUntilAvailable,
    } = body;

    if (!eventId || typeof eventId !== "string" || !isValidUUID(eventId)) {
      return NextResponse.json(
        { error: "eventId is required and must be a valid UUID" },
        { status: 400 },
      );
    }

    if (!Array.isArray(rawEmails) || rawEmails.length === 0) {
      return NextResponse.json(
        { error: "emails must be a non-empty array" },
        { status: 400 },
      );
    }

    const emails = normalizeEmails(rawEmails);
    if (emails.length === 0) {
      return NextResponse.json(
        { error: "emails must contain at least one valid address" },
        { status: 400 },
      );
    }

    if (emails.length > MAX_EMAILS_PER_REQUEST) {
      return NextResponse.json(
        { error: `Maximum ${MAX_EMAILS_PER_REQUEST} emails per request` },
        { status: 400 },
      );
    }

    if (
      kind !== "announcement" &&
      kind !== "ticketsAvailableNow" &&
      kind !== "ticketsAvailableIn" &&
      kind !== "claimTicket"
    ) {
      return NextResponse.json(
        {
          error:
            'kind must be "announcement", "ticketsAvailableNow", "ticketsAvailableIn", or "claimTicket"',
        },
        { status: 400 },
      );
    }

    const approxTime = typeof approxTimeUntilAvailable === "string"
      ? approxTimeUntilAvailable.trim()
      : "";
    if (kind === "ticketsAvailableIn" && !approxTime) {
      return NextResponse.json(
        {
          error:
            "approxTimeUntilAvailable is required when kind is 'ticketsAvailableIn'",
        },
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
        releaseDate: true,
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

    let recipients = emails;
    let skipped = 0;

    if (kind !== "announcement") {
      const notifications = await db.query.notify.findMany({
        where: eq(notify.speakerId, eventId),
        columns: { email: true },
      });
      const notifyEmails = new Set(
        notifications.map((entry) => entry.email.trim().toLowerCase()),
      );
      const invalidEmails = recipients.filter((email) => !notifyEmails.has(email));

      if (invalidEmails.length > 0) {
        return NextResponse.json(
          { error: "One or more emails are not on the notification list" },
          { status: 400 },
        );
      }

      if (kind === "claimTicket") {
        const ticketResults = await db.query.tickets.findMany({
          where: eq(tickets.eventId, eventId),
          columns: { email: true },
        });
        const ticketEmailSet = new Set(
          ticketResults.map((ticket) => ticket.email.trim().toLowerCase()),
        );
        const originalCount = recipients.length;
        recipients = recipients.filter((email) => !ticketEmailSet.has(email));
        skipped = originalCount - recipients.length;
      }
    }

    if (recipients.length === 0) {
      return NextResponse.json({ sent: 0, failed: 0, skipped });
    }

    const eventName = event.name || "Event";
    const eventRoute = event.route ?? null;
    const eventStartTime = event.startTimeDate?.toISOString() ?? null;

    const results = await Promise.allSettled(
      recipients.map((email) => {
        if (kind === "announcement") {
          return sendEventAnnouncedEmail({
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
          });
        }

        if (kind === "ticketsAvailableNow") {
          return sendTicketsAvailableNowEmail({
            email,
            eventName,
            eventRoute,
            eventStartTime,
            eventId: event.id,
            imgVersion: event.imgVersion,
            eventTagline: event.tagline || null,
            eventVenue: event.venue || null,
            eventVenueLink: event.venueLink || null,
            doorsOpenTime: event.doorsOpen?.toISOString() || null,
          });
        }

        if (kind === "claimTicket") {
          return sendClaimTicketEmail({
            email,
            eventName,
            eventRoute,
            eventStartTime,
            eventId: event.id,
            imgVersion: event.imgVersion,
            eventTagline: event.tagline || null,
            doorsOpenTime: event.doorsOpen?.toISOString() || null,
          });
        }

        return sendTicketsAvailableInEmail({
          email,
          eventName,
          eventRoute,
          eventStartTime,
          approxTimeUntilAvailable: approxTime,
          eventId: event.id,
          imgVersion: event.imgVersion,
          eventTagline: event.tagline || null,
          eventVenue: event.venue || null,
          eventVenueLink: event.venueLink || null,
          doorsOpenTime: event.doorsOpen?.toISOString() || null,
          ticketDropTime: event.ticketingDate?.toISOString() || event.releaseDate?.toISOString() || null,
        });
      }),
    );

    let sent = 0;
    let failed = 0;

    for (const result of results) {
      if (result.status === "fulfilled") {
        sent++;
      } else {
        failed++;
        console.error("Bulk email send failed:", result.reason);
      }
    }

    await logAuditEvent({
      action: "email.send_mass",
      actor: auth.email!,
      eventId: eventId,
      eventName: event.name ?? null,
      metadata: { type: "bulkSend", kind, sent, failed, skipped },
    });

    return NextResponse.json({ sent, failed, skipped });
  } catch (err) {
    console.error("Bulk email send error:", err);
    return NextResponse.json(
      { error: "Failed to send bulk emails" },
      { status: 500 },
    );
  }
}
