import { NextResponse } from "next/server";
import {
  getAvailablePublicTickets,
  isEventUnderCapacity,
} from "@/app/lib/supabase";
import { verifyAdminRequest } from "@/app/lib/auth";
import {
  sendDayOfReminderEmail,
  sendEarlyReminderEmail,
  sendTicketEmail,
  sendStandbyLineEmail,
} from "@/app/lib/email";
import { PACIFIC_TIMEZONE } from "@/app/lib/constants";
import { pullFromWaitlist } from "@/app/lib/waitlist";
import { db, eq, and, or, ilike, inArray, isNotNull, count as dbCount, tickets, events, waitlist, referrals } from "@ssb/db";
import { isValidUUID } from "@/app/lib/validation";
import { logAuditEvent } from "@/app/lib/audit";

/** Helper to serialize a ticket (with optional event relation) to snake_case for API response */
function serializeTicket(ticket: {
  id: string;
  email: string;
  name: string | null;
  type: string;
  createdAt: Date;
  scanned: boolean;
  scanTime: Date | null;
  referral: string | null;
  eventId: string | null;
  event?: {
    id: string;
    name: string | null;
    route: string | null;
    startTimeDate: Date | null;
    endTimeDate?: Date | null;
    venue?: string | null;
    venueLink?: string | null;
    desc?: string | null;
    doorsOpen?: Date | null;
  } | null;
}) {
  return {
    id: ticket.id,
    email: ticket.email,
    name: ticket.name,
    type: ticket.type,
    created_at: ticket.createdAt.toISOString(),
    scanned: ticket.scanned,
    scan_time: ticket.scanTime?.toISOString() ?? null,
    referral: ticket.referral,
    event_id: ticket.eventId,
    events: ticket.event
      ? {
        id: ticket.event.id,
        name: ticket.event.name,
        route: ticket.event.route,
        start_time_date: ticket.event.startTimeDate?.toISOString() ?? null,
        ...(ticket.event.endTimeDate !== undefined ? { end_time_date: ticket.event.endTimeDate?.toISOString() ?? null } : {}),
        ...(ticket.event.venue !== undefined ? { venue: ticket.event.venue } : {}),
        ...(ticket.event.venueLink !== undefined ? { venue_link: ticket.event.venueLink } : {}),
        ...(ticket.event.desc !== undefined ? { desc: ticket.event.desc } : {}),
        ...(ticket.event.doorsOpen !== undefined ? { doors_open: ticket.event.doorsOpen?.toISOString() ?? null } : {}),
      }
      : null,
  };
}

/** Standard ticket columns */
const TICKET_COLUMNS = {
  id: true, email: true, name: true, type: true, createdAt: true,
  scanned: true, scanTime: true, referral: true, eventId: true,
} as const;

/** Standard event relation (basic fields) */
const TICKET_WITH_EVENT = {
  event: { columns: { id: true, name: true, route: true, startTimeDate: true, endTimeDate: true } },
} as const;

/** Extended event relation (includes venue/desc/doorsOpen for emails) */
const TICKET_WITH_EVENT_DETAILS = {
  event: { columns: { id: true, name: true, route: true, startTimeDate: true, endTimeDate: true, venue: true, venueLink: true, desc: true, doorsOpen: true, tagline: true, imgVersion: true } },
} as const;

function formatDoorsOpenTime(doorsOpen: Date | null | undefined): string | undefined {
  if (!doorsOpen) return undefined;
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: PACIFIC_TIMEZONE,
  }).format(new Date(doorsOpen));
}

/** Extended event relation with doors_open for reminders */
const TICKET_WITH_DOORS_OPEN = {
  event: { columns: { id: true, name: true, route: true, startTimeDate: true, endTimeDate: true, venue: true, venueLink: true, desc: true, doorsOpen: true, tagline: true, imgVersion: true } },
} as const;

type ReminderRecipient = {
  id: string;
  email: string;
  name: string | null;
  type: string | null;
};

async function sendReminderBatch(options: {
  recipients: ReminderRecipient[];
  batchSize: number;
  minBatchDurationMs: number;
  sendEmail: (recipient: ReminderRecipient) => Promise<void>;
  logPrefix: string;
}) {
  const {
    recipients,
    batchSize,
    minBatchDurationMs,
    sendEmail,
    logPrefix,
  } = options;

  const results: PromiseSettledResult<{
    success: boolean;
    email: string;
    error?: unknown;
  }>[] = [];

  for (let index = 0; index < recipients.length; index += batchSize) {
    const batchStartTime = Date.now();
    const batch = recipients.slice(index, index + batchSize);
    const batchPromises = batch.map((recipient) =>
      sendEmail(recipient).then(
        () => ({ success: true, email: recipient.email }),
        (error) => ({ success: false, email: recipient.email, error }),
      ),
    );
    const batchResults = await Promise.allSettled(batchPromises);
    results.push(...batchResults);

    const batchDuration = Date.now() - batchStartTime;
    if (
      minBatchDurationMs > 0 &&
      batchDuration < minBatchDurationMs &&
      index + batchSize < recipients.length
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, minBatchDurationMs - batchDuration),
      );
    }
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      const emailResult = result.value;
      if (emailResult.success) {
        sent++;
      } else {
        failed++;
        const errorMessage = emailResult.error instanceof Error
          ? emailResult.error.message
          : "Unknown error";
        errors.push(`${emailResult.email}: ${errorMessage}`);
        console.error(
          `${logPrefix} ${emailResult.email}:`,
          emailResult.error ?? "Unknown error",
        );
      }
    } else {
      failed++;
      errors.push(`Promise rejected: ${result.reason}`);
      console.error(`${logPrefix} promise rejected:`, result.reason);
    }
  }

  return { sent, failed, errors };
}

export async function GET(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get("eventId");
    const search = searchParams.get("search");
    const type = searchParams.get("type");
    const scanned = searchParams.get("scanned");
    const limit = parseInt(searchParams.get("limit") || "100");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Build where conditions for main query and filtered count
    const conditions: ReturnType<typeof eq>[] = [];
    if (eventId) conditions.push(eq(tickets.eventId, eventId));
    if (search) conditions.push(or(ilike(tickets.email, `%${search}%`), ilike(tickets.name, `%${search}%`))!);
    if (type) conditions.push(eq(tickets.type, type));
    if (scanned !== null && scanned !== undefined && scanned !== "") {
      conditions.push(eq(tickets.scanned, scanned === "true"));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Build where conditions for unfiltered counts (only eventId filter)
    const baseConditions: ReturnType<typeof eq>[] = [];
    if (eventId) baseConditions.push(eq(tickets.eventId, eventId));
    const baseWhereClause = baseConditions.length > 0 ? and(...baseConditions) : undefined;

    // Run all queries in parallel
    const [ticketResults, [totalResult], [scannedResult], [unscannedResult], [filteredResult], [standardResult], [vipResult], [externalResult], [waitlistResult]] =
      await Promise.all([
        db.query.tickets.findMany({
          where: whereClause,
          columns: TICKET_COLUMNS,
          with: TICKET_WITH_EVENT,
          orderBy: (t, { desc }) => [desc(t.createdAt)],
          offset,
          limit,
        }),
        db.select({ count: dbCount() }).from(tickets).where(baseWhereClause),
        db.select({ count: dbCount() }).from(tickets).where(baseWhereClause ? and(baseWhereClause, eq(tickets.scanned, true)) : eq(tickets.scanned, true)),
        db.select({ count: dbCount() }).from(tickets).where(baseWhereClause ? and(baseWhereClause, eq(tickets.scanned, false)) : eq(tickets.scanned, false)),
        db.select({ count: dbCount() }).from(tickets).where(whereClause),
        db.select({ count: dbCount() }).from(tickets).where(baseWhereClause ? and(baseWhereClause, eq(tickets.type, "STANDARD")) : eq(tickets.type, "STANDARD")),
        db.select({ count: dbCount() }).from(tickets).where(baseWhereClause ? and(baseWhereClause, eq(tickets.type, "VIP")) : eq(tickets.type, "VIP")),
        db.select({ count: dbCount() }).from(tickets).where(baseWhereClause ? and(baseWhereClause, eq(tickets.type, "EXTERNAL")) : eq(tickets.type, "EXTERNAL")),
        db.select({ count: dbCount() }).from(tickets).where(baseWhereClause ? and(baseWhereClause, eq(tickets.type, "STANDBY")) : eq(tickets.type, "STANDBY")),
      ]);

    return NextResponse.json({
      tickets: ticketResults.map(serializeTicket),
      total: totalResult?.count ?? 0,
      scannedCount: scannedResult?.count ?? 0,
      unscannedCount: unscannedResult?.count ?? 0,
      filteredCount: filteredResult?.count ?? 0,
      standardCount: standardResult?.count ?? 0,
      vipCount: vipResult?.count ?? 0,
      externalCount: externalResult?.count ?? 0,
      standbyCount: waitlistResult?.count ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Tickets fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const body = await req.json();
    const { id } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { error: "Ticket ID is required" },
        { status: 400 },
      );
    }

    // Fetch the ticket before deleting to get event_id and type
    const ticketToDelete = await db.query.tickets.findFirst({
      where: eq(tickets.id, id),
      columns: { email: true, eventId: true, type: true },
      with: { event: { columns: { name: true } } },
    });

    if (!ticketToDelete) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Delete the ticket
    await db.delete(tickets).where(eq(tickets.id, id));

    await logAuditEvent({
      action: "ticket.delete",
      actor: auth.email!,
      eventId: ticketToDelete.eventId,
      eventName: ticketToDelete.event?.name ?? null,
      targetEmail: ticketToDelete.email,
      metadata: { ticketId: id, type: ticketToDelete.type },
    });

    // Sync referral counts
    try {
      const [allReferrals, ticketCounts] = await Promise.all([
        db.query.referrals.findMany({ columns: { id: true, eventId: true, referralCode: true, count: true } }),
        db.select({ eventId: tickets.eventId, referral: tickets.referral, count: dbCount() })
          .from(tickets).where(isNotNull(tickets.referral)).groupBy(tickets.eventId, tickets.referral),
      ]);
      const countMap = new Map(ticketCounts.map((r) => [`${r.eventId}:${r.referral}`, r.count]));
      for (const referral of allReferrals) {
        const actual = countMap.get(`${referral.eventId}:${referral.referralCode}`) ?? 0;
        if (referral.count !== actual) {
          await db.update(referrals).set({ count: actual }).where(eq(referrals.id, referral.id));
        }
      }
    } catch (syncError) {
      console.error("Sync referral counts error:", syncError);
      return NextResponse.json(
        { error: "Failed to sync referrals" },
        { status: 500 },
      );
    }

    // Sync event scanned counts
    try {
      await syncEventScannedCounts();
    } catch (syncError) {
      console.error("Sync scanned counts error:", syncError);
      return NextResponse.json(
        { error: "Failed to sync scanned" },
        { status: 500 },
      );
    }

    // If the deleted ticket was non-VIP and we have capacity, pull from waitlist
    if (ticketToDelete.type !== "VIP" && ticketToDelete.eventId) {
      try {
        await pullFromWaitlist(null, ticketToDelete.eventId, 1);
      } catch (waitlistError) {
        console.error("Waitlist conversion error (non-fatal):", waitlistError);
        // Don't fail the delete if waitlist conversion fails
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Ticket delete error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/** Helper to sync event scanned counts */
async function syncEventScannedCounts() {
  const [allEvents, scannedCounts] = await Promise.all([
    db.query.events.findMany({ columns: { id: true, scanned: true } }),
    db.select({ eventId: tickets.eventId, count: dbCount() })
      .from(tickets).where(eq(tickets.scanned, true)).groupBy(tickets.eventId),
  ]);
  const countMap = new Map(scannedCounts.map((r) => [r.eventId, r.count]));
  for (const event of allEvents) {
    const actual = countMap.get(event.id) ?? 0;
    if (event.scanned !== actual) {
      await db.update(events).set({ scanned: actual }).where(eq(events.id, event.id));
    }
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const body = await req.json();
    const { id, action, type, scanned, promo, name, ticketIds } = body;

    // Batch reminder actions don't require a ticket ID - they use eventId from query params
    const batchActions = ["sendDayOfReminders", "sendEarlyReminders"];
    if (!batchActions.includes(action) && (!id || typeof id !== "string")) {
      return NextResponse.json(
        { error: "Ticket ID is required" },
        { status: 400 },
      );
    }

    // Handle different actions
    if (action === "updateName") {
      // Update ticket name
      const trimmed = typeof name === "string" ? name.trim() : "";
      if (trimmed.length > 200) {
        return NextResponse.json(
          { error: "Name must be 200 characters or less" },
          { status: 400 },
        );
      }
      const newName = trimmed || null;

      await db.update(tickets).set({ name: newName }).where(eq(tickets.id, id));
      const ticket = await db.query.tickets.findFirst({
        where: eq(tickets.id, id),
        columns: TICKET_COLUMNS,
        with: TICKET_WITH_EVENT,
      });

      await logAuditEvent({
        action: "ticket.update_name",
        actor: auth.email!,
        eventId: ticket!.eventId,
        eventName: ticket!.event?.name ?? null,
        targetEmail: ticket!.email,
        metadata: { ticketId: id, newName },
      });

      return NextResponse.json({ success: true, ticket: serializeTicket(ticket!) });
    } else if (action === "unscan") {
      // Unscan the ticket: set scanned to false and clear scan-related fields
      await db.update(tickets).set({
        scanned: false,
        scanTime: null,
        scanUser: null,
        scanEmail: null,
      }).where(eq(tickets.id, id));
      const ticket = await db.query.tickets.findFirst({
        where: eq(tickets.id, id),
        columns: TICKET_COLUMNS,
        with: TICKET_WITH_EVENT,
      });

      try {
        await syncEventScannedCounts();
      } catch (syncError) {
        console.error("Sync scanned RPC error:", syncError);
        return NextResponse.json(
          { error: "Failed to sync scanned" },
          { status: 500 },
        );
      }

      await logAuditEvent({
        action: "ticket.unscan",
        actor: auth.email!,
        eventId: ticket!.eventId,
        eventName: ticket!.event?.name ?? null,
        targetEmail: ticket!.email,
        metadata: { ticketId: id },
      });

      return NextResponse.json({ success: true, ticket: serializeTicket(ticket!) });
    } else if (action === "updateType" || type) {
      // Update ticket type
      if (type !== "VIP" && type !== "STANDARD" && type !== "EXTERNAL" && type !== "STANDBY") {
        return NextResponse.json(
          { error: "Invalid ticket type. Must be 'VIP', 'STANDARD', 'EXTERNAL', or 'STANDBY'." },
          { status: 400 },
        );
      }

      // First, fetch the current ticket to check if type is changing
      const currentTicket = await db.query.tickets.findFirst({
        where: eq(tickets.id, id),
        columns: { type: true, eventId: true },
      });

      if (!currentTicket) {
        return NextResponse.json(
          { error: "Ticket not found" },
          { status: 404 },
        );
      }

      const typeChanged = currentTicket.type !== type;

      // Block STANDARD→VIP upgrade if VIP capacity is full
      if (typeChanged && type === "VIP" && currentTicket.eventId) {
        const ticketInfo = await getAvailablePublicTickets(
          currentTicket.eventId,
        );
        // CRITICAL: Block upgrade if it would exceed reserved allocation
        if (ticketInfo.vipCount + 1 > ticketInfo.reserved) {
          return NextResponse.json(
            {
              error: `Cannot upgrade to VIP: would exceed reserved allocation (${ticketInfo.vipCount + 1} > ${ticketInfo.reserved})`,
            },
            { status: 400 },
          );
        }
      }

      await db.update(tickets).set({ type }).where(eq(tickets.id, id));
      const ticket = await db.query.tickets.findFirst({
        where: eq(tickets.id, id),
        columns: TICKET_COLUMNS,
        with: TICKET_WITH_EVENT_DETAILS,
      });

      // If the type changed, send updated ticket email
      if (typeChanged && ticket) {
        try {
          if (ticket.type === "STANDBY") {
            await sendStandbyLineEmail({
              email: ticket.email,
              name: ticket.name || null,
              eventName: ticket.event?.name || "Event",
              eventStartTime: ticket.event?.startTimeDate?.toISOString() ?? null,
              eventVenue: ticket.event?.venue,
              eventVenueLink: ticket.event?.venueLink,
              standbyOpenTime: formatDoorsOpenTime(ticket.event?.doorsOpen),
              ticketId: ticket.id,
              eventId: ticket.event?.id || null,
              imgVersion: ticket.event?.imgVersion ?? null,
              eventTagline: ticket.event?.tagline || null,
            });
          } else {
            await sendTicketEmail({
              email: ticket.email,
              name: ticket.name || null,
              eventName: ticket.event?.name || "Event",
              ticketType: ticket.type || "STANDARD",
              eventStartTime: ticket.event?.startTimeDate?.toISOString() || null,
              eventEndTime: ticket.event?.endTimeDate?.toISOString() || null,
              eventRoute: ticket.event?.route || null,
              ticketId: ticket.id,
              eventVenue: ticket.event?.venue || null,
              eventVenueLink: ticket.event?.venueLink || null,
              eventDescription: ticket.event?.desc || null,
              doorsOpenTime: ticket.event?.doorsOpen?.toISOString() || null,
              eventId: ticket.event?.id || null,
              imgVersion: ticket.event?.imgVersion ?? null,
              eventTagline: ticket.event?.tagline || null,
            });
          }
        } catch (emailError) {
          console.error("Email sending error:", emailError);
          // Don't fail the update if email fails, just log it
        }
      }

      // If type changed, pull someone off the waitlist if there's available public capacity
      if (typeChanged && ticket?.eventId) {
        try {
          const hasCapacity = await isEventUnderCapacity(ticket.eventId);

          if (hasCapacity) {
            // Get the first person on the waitlist for this event
            const waitlistEntry = await db.query.waitlist.findFirst({
              where: eq(waitlist.eventId, ticket.eventId),
              orderBy: (t, { asc }) => [asc(t.position)],
              columns: { id: true, email: true, name: true },
            });

            if (waitlistEntry) {
              // Create a STANDARD ticket for the waitlist person
              const [inserted] = await db.insert(tickets).values({
                eventId: ticket.eventId,
                email: waitlistEntry.email,
                name: waitlistEntry.name ?? null,
                type: "STANDARD",
              }).returning();
              const newTicket = await db.query.tickets.findFirst({
                where: eq(tickets.id, inserted.id),
                columns: TICKET_COLUMNS,
                with: TICKET_WITH_EVENT_DETAILS,
              });

              // Remove them from the waitlist
              try {
                await db.delete(waitlist).where(eq(waitlist.id, waitlistEntry.id));
              } catch (waitlistDeleteError) {
                console.error(
                  "Waitlist removal error (non-fatal):",
                  waitlistDeleteError,
                );
              }

              // Send ticket email to the person who was on the waitlist
              if (newTicket) try {
                await sendTicketEmail({
                  email: newTicket.email,
                  name: newTicket.name || null,
                  eventName: newTicket.event?.name || "Event",
                  ticketType: newTicket.type || "STANDARD",
                  eventStartTime: newTicket.event?.startTimeDate?.toISOString() || null,
                  eventEndTime: newTicket.event?.endTimeDate?.toISOString() || null,
                  eventRoute: newTicket.event?.route || null,
                  ticketId: newTicket.id,
                  eventVenue: newTicket.event?.venue || null,
                  eventVenueLink: newTicket.event?.venueLink || null,
                  eventDescription: newTicket.event?.desc || null,
                  doorsOpenTime: newTicket.event?.doorsOpen?.toISOString() || null,
                  eventId: newTicket.event?.id || null,
                  imgVersion: newTicket.event?.imgVersion ?? null,
                  eventTagline: newTicket.event?.tagline || null,
                });
              } catch (emailError) {
                console.error(
                  "Email sending error for waitlist conversion (non-fatal):",
                  emailError,
                );
              }
            }
          }
        } catch (waitlistError) {
          console.error(
            "Waitlist conversion error (non-fatal):",
            waitlistError,
          );
        }
      }

      await logAuditEvent({
        action: "ticket.update_type",
        actor: auth.email!,
        eventId: ticket!.eventId,
        eventName: ticket!.event?.name ?? null,
        targetEmail: ticket!.email,
        metadata: { ticketId: id, oldType: currentTicket.type, newType: type },
      });

      return NextResponse.json({ success: true, ticket: serializeTicket(ticket!) });
    } else if (action === "updateScanned" || typeof scanned === "boolean") {
      // Update scanned status
      const updateData: {
        scanned: boolean;
        scanTime?: Date | null;
        scanUser?: string | null;
        scanEmail?: string | null;
      } = {
        scanned,
      };

      // If unscanning, clear scan-related fields
      if (!scanned) {
        updateData.scanTime = null;
        updateData.scanUser = null;
        updateData.scanEmail = null;
      } else {
        // If scanning, set scan_time to now
        updateData.scanTime = new Date();
      }

      await db.update(tickets).set(updateData).where(eq(tickets.id, id));
      const ticket = await db.query.tickets.findFirst({
        where: eq(tickets.id, id),
        columns: TICKET_COLUMNS,
        with: TICKET_WITH_EVENT,
      });

      try {
        await syncEventScannedCounts();
      } catch (syncError) {
        console.error("Sync scanned RPC error:", syncError);
        return NextResponse.json(
          { error: "Failed to sync scanned" },
          { status: 500 },
        );
      }

      return NextResponse.json({ success: true, ticket: serializeTicket(ticket!) });
    } else if (action === "resendEmail") {
      // Resend ticket confirmation email
      const ticket = await db.query.tickets.findFirst({
        where: eq(tickets.id, id),
        columns: TICKET_COLUMNS,
        with: TICKET_WITH_EVENT_DETAILS,
      });

      if (!ticket) {
        return NextResponse.json(
          { error: "Ticket not found" },
          { status: 404 },
        );
      }

      // Send ticket confirmation email
      try {
        await sendTicketEmail({
          email: ticket.email,
          name: ticket.name || null,
          eventName: ticket.event?.name || "Event",
          ticketType: ticket.type || "STANDARD",
          eventStartTime: ticket.event?.startTimeDate?.toISOString() || null,
          eventEndTime: ticket.event?.endTimeDate?.toISOString() || null,
          eventRoute: ticket.event?.route || null,
          ticketId: ticket.id,
          eventVenue: ticket.event?.venue || null,
          eventVenueLink: ticket.event?.venueLink || null,
          eventDescription: ticket.event?.desc || null,
          doorsOpenTime: ticket.event?.doorsOpen?.toISOString() || null,
          eventId: ticket.event?.id || null,
          imgVersion: ticket.event?.imgVersion ?? null,
          eventTagline: ticket.event?.tagline || null,
        });
      } catch (emailError) {
        console.error("Email sending error:", emailError);
        return NextResponse.json(
          { error: "Failed to send email" },
          { status: 500 },
        );
      }

      await logAuditEvent({
        action: "email.send",
        actor: auth.email!,
        eventId: ticket.eventId,
        eventName: ticket.event?.name ?? null,
        targetEmail: ticket.email,
        metadata: { type: "resendEmail", ticketId: id },
      });

      return NextResponse.json({
        success: true,
        message: "Email sent successfully",
      });
    } else if (action === "sendDayOfReminders") {
      // Send day-of reminder emails to all ticket holders for an event
      const { searchParams } = new URL(req.url);
      const eventId = searchParams.get("eventId");

      if (!eventId) {
        return NextResponse.json(
          { error: "Event ID is required" },
          { status: 400 },
        );
      }

      if (!isValidUUID(eventId)) {
        return NextResponse.json(
          { error: "Invalid event ID format" },
          { status: 400 },
        );
      }

      // Fetch event details including doors_open time
      const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: {
          id: true,
          name: true,
          route: true,
          startTimeDate: true,
          endTimeDate: true,
          doorsOpen: true,
          venue: true,
          venueLink: true,
          desc: true,
          tagline: true,
          imgVersion: true,
        },
      });

      if (!event) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }

      const hasTicketIdFilter = Array.isArray(ticketIds);
      const normalizedTicketIds = hasTicketIdFilter
        ? [...new Set(
          ticketIds.filter(
            (ticketId): ticketId is string =>
              typeof ticketId === "string" && ticketId.trim().length > 0,
          ),
        )]
        : [];

      if (hasTicketIdFilter && normalizedTicketIds.length === 0) {
        return NextResponse.json(
          { error: "ticketIds must be a non-empty array of strings" },
          { status: 400 },
        );
      }

      if (normalizedTicketIds.length > 14) {
        return NextResponse.json(
          { error: "Maximum 14 ticketIds per reminder request" },
          { status: 400 },
        );
      }

      // Fetch all tickets for this event (or the requested ticket chunk)
      const eventTickets = await db.query.tickets.findMany({
        where: hasTicketIdFilter
          ? and(eq(tickets.eventId, eventId), inArray(tickets.id, normalizedTicketIds))
          : eq(tickets.eventId, eventId),
        columns: { id: true, email: true, name: true, type: true },
      });

      if (!eventTickets || eventTickets.length === 0) {
        return NextResponse.json({
          success: true,
          sent: 0,
          failed: 0,
          message: "No tickets found for this event",
        });
      }

      const { sent, failed, errors } = await sendReminderBatch({
        recipients: eventTickets,
        batchSize: hasTicketIdFilter ? normalizedTicketIds.length : 14,
        minBatchDurationMs: hasTicketIdFilter ? 0 : 1000,
        sendEmail: (ticket) =>
          sendDayOfReminderEmail({
            email: ticket.email,
            name: ticket.name || null,
            eventName: event.name || "Event",
            ticketType: ticket.type || "STANDARD",
            eventStartTime: event.startTimeDate?.toISOString() || null,
            eventEndTime: event.endTimeDate?.toISOString() || null,
            eventRoute: event.route || null,
            ticketId: ticket.id,
            eventVenue: event.venue || null,
            eventVenueLink: event.venueLink || null,
            eventDescription: event.desc || null,
            doorsOpenTime: event.doorsOpen?.toISOString() || null,
            eventId: event.id,
            imgVersion: event.imgVersion,
            eventTagline: event.tagline || null,
          }),
        logPrefix: "Failed to send reminder to",
      });

      await logAuditEvent({
        action: "email.send_mass",
        actor: auth.email!,
        eventId: eventId,
        eventName: event.name ?? null,
        metadata: { type: "dayOfReminders", sent, failed, total: eventTickets.length },
      });

      return NextResponse.json({
        success: true,
        sent,
        failed,
        total: eventTickets.length,
        message: `Sent ${sent} reminder(s), ${failed} failed`,
        errors: errors.length > 0 ? errors : undefined,
      });
    } else if (action === "sendDayOfReminder") {
      // Send day-of reminder email to a single ticket holder
      if (!id) {
        return NextResponse.json(
          { error: "Ticket ID is required" },
          { status: 400 },
        );
      }

      const ticket = await db.query.tickets.findFirst({
        where: eq(tickets.id, id),
        columns: TICKET_COLUMNS,
        with: TICKET_WITH_DOORS_OPEN,
      });

      if (!ticket) {
        return NextResponse.json(
          { error: "Ticket not found" },
          { status: 404 },
        );
      }

      try {
        await sendDayOfReminderEmail({
          email: ticket.email,
          name: ticket.name || null,
          eventName: ticket.event?.name || "Event",
          ticketType: ticket.type || "STANDARD",
          eventStartTime: ticket.event?.startTimeDate?.toISOString() || null,
          eventEndTime: ticket.event?.endTimeDate?.toISOString() || null,
          eventRoute: ticket.event?.route || null,
          ticketId: ticket.id,
          eventVenue: ticket.event?.venue || null,
          eventVenueLink: ticket.event?.venueLink || null,
          eventDescription: ticket.event?.desc || null,
          doorsOpenTime: ticket.event?.doorsOpen?.toISOString() || null,
          eventId: ticket.event?.id || null,
          imgVersion: ticket.event?.imgVersion ?? null,
          eventTagline: ticket.event?.tagline || null,
        });
      } catch (emailError) {
        console.error("Email sending error:", emailError);
        return NextResponse.json(
          { error: "Failed to send reminder email" },
          { status: 500 },
        );
      }

      await logAuditEvent({
        action: "email.send",
        actor: auth.email!,
        eventId: ticket.eventId,
        eventName: ticket.event?.name ?? null,
        targetEmail: ticket.email,
        metadata: { type: "dayOfReminder", ticketId: id },
      });

      return NextResponse.json({
        success: true,
        message: "Day-of reminder sent successfully",
      });
    } else if (action === "sendEarlyReminders") {
      // Send early reminder emails to all ticket holders for an event
      const { searchParams } = new URL(req.url);
      const eventId = searchParams.get("eventId");

      if (!eventId) {
        return NextResponse.json(
          { error: "Event ID is required" },
          { status: 400 },
        );
      }

      if (!isValidUUID(eventId)) {
        return NextResponse.json(
          { error: "Invalid event ID format" },
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
          endTimeDate: true,
          doorsOpen: true,
          venue: true,
          venueLink: true,
          desc: true,
          tagline: true,
          imgVersion: true,
        },
      });

      if (!event) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }

      const hasTicketIdFilter = Array.isArray(ticketIds);
      const normalizedTicketIds = hasTicketIdFilter
        ? [...new Set(
          ticketIds.filter(
            (ticketId): ticketId is string =>
              typeof ticketId === "string" && ticketId.trim().length > 0,
          ),
        )]
        : [];

      if (hasTicketIdFilter && normalizedTicketIds.length === 0) {
        return NextResponse.json(
          { error: "ticketIds must be a non-empty array of strings" },
          { status: 400 },
        );
      }

      if (normalizedTicketIds.length > 14) {
        return NextResponse.json(
          { error: "Maximum 14 ticketIds per reminder request" },
          { status: 400 },
        );
      }

      const eventTickets = await db.query.tickets.findMany({
        where: hasTicketIdFilter
          ? and(eq(tickets.eventId, eventId), inArray(tickets.id, normalizedTicketIds))
          : eq(tickets.eventId, eventId),
        columns: { id: true, email: true, name: true, type: true },
      });

      if (!eventTickets || eventTickets.length === 0) {
        return NextResponse.json({
          success: true,
          sent: 0,
          failed: 0,
          message: "No tickets found for this event",
        });
      }

      const { sent, failed, errors } = await sendReminderBatch({
        recipients: eventTickets,
        batchSize: hasTicketIdFilter ? normalizedTicketIds.length : 14,
        minBatchDurationMs: hasTicketIdFilter ? 0 : 1000,
        sendEmail: (ticket) =>
          sendEarlyReminderEmail({
            email: ticket.email,
            name: ticket.name || null,
            eventName: event.name || "Event",
            ticketType: ticket.type || "STANDARD",
            eventStartTime: event.startTimeDate?.toISOString() || null,
            eventEndTime: event.endTimeDate?.toISOString() || null,
            eventRoute: event.route || null,
            ticketId: ticket.id,
            eventVenue: event.venue || null,
            eventVenueLink: event.venueLink || null,
            eventDescription: event.desc || null,
            doorsOpenTime: event.doorsOpen?.toISOString() || null,
            promo: promo || null,
            eventId: event.id,
            imgVersion: event.imgVersion,
            eventTagline: event.tagline || null,
          }),
        logPrefix: "Failed to send early reminder to",
      });

      await logAuditEvent({
        action: "email.send_mass",
        actor: auth.email!,
        eventId: eventId,
        eventName: event.name ?? null,
        metadata: { type: "earlyReminders", sent, failed, total: eventTickets.length },
      });

      return NextResponse.json({
        success: true,
        sent,
        failed,
        total: eventTickets.length,
        message: `Sent ${sent} early reminder(s), ${failed} failed`,
        errors: errors.length > 0 ? errors : undefined,
      });
    } else if (action === "sendEarlyReminder") {
      // Send early reminder email to a single ticket holder
      if (!id) {
        return NextResponse.json(
          { error: "Ticket ID is required" },
          { status: 400 },
        );
      }

      const ticket = await db.query.tickets.findFirst({
        where: eq(tickets.id, id),
        columns: TICKET_COLUMNS,
        with: TICKET_WITH_DOORS_OPEN,
      });

      if (!ticket) {
        return NextResponse.json(
          { error: "Ticket not found" },
          { status: 404 },
        );
      }

      try {
        await sendEarlyReminderEmail({
          email: ticket.email,
          name: ticket.name || null,
          eventName: ticket.event?.name || "Event",
          ticketType: ticket.type || "STANDARD",
          eventStartTime: ticket.event?.startTimeDate?.toISOString() || null,
          eventEndTime: ticket.event?.endTimeDate?.toISOString() || null,
          eventRoute: ticket.event?.route || null,
          ticketId: ticket.id,
          eventVenue: ticket.event?.venue || null,
          eventVenueLink: ticket.event?.venueLink || null,
          eventDescription: ticket.event?.desc || null,
          doorsOpenTime: ticket.event?.doorsOpen?.toISOString() || null,
          promo: promo || null,
          eventId: ticket.event?.id || null,
          imgVersion: ticket.event?.imgVersion ?? null,
          eventTagline: ticket.event?.tagline || null,
        });
      } catch (emailError) {
        console.error("Email sending error:", emailError);
        return NextResponse.json(
          { error: "Failed to send early reminder email" },
          { status: 500 },
        );
      }

      await logAuditEvent({
        action: "email.send",
        actor: auth.email!,
        eventId: ticket.eventId,
        eventName: ticket.event?.name ?? null,
        targetEmail: ticket.email,
        metadata: { type: "earlyReminder", ticketId: id },
      });

      return NextResponse.json({
        success: true,
        message: "Early reminder sent successfully",
      });
    } else {
      return NextResponse.json(
        {
          error:
            "Invalid action. Use 'updateName', 'unscan', 'updateType', 'updateScanned', 'resendEmail', 'sendDayOfReminders', 'sendDayOfReminder', 'sendEarlyReminders', 'sendEarlyReminder'.",
        },
        { status: 400 },
      );
    }
  } catch (error) {
    console.error("Ticket update error:", error);
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
    const { email, eventId, type, name } = body;

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    if (!eventId || typeof eventId !== "string") {
      return NextResponse.json(
        { error: "Event ID is required" },
        { status: 400 },
      );
    }

    // Check if event exists
    const event = await db.query.events.findFirst({
      where: eq(events.id, eventId),
      columns: { id: true, name: true, capacity: true, reserved: true, doorsOpen: true },
    });

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Check capacity constraints for new tickets (only if event has capacity set)
    const ticketType = type || "VIP"; // Admin-created tickets default to VIP
    if (event.capacity) {
      const ticketInfo = await getAvailablePublicTickets(eventId);

      if (ticketType === "VIP") {
        // CRITICAL: Block VIP creation if it would exceed reserved allocation
        if (ticketInfo.vipCount + 1 > ticketInfo.reserved) {
          return NextResponse.json(
            {
              error: `Cannot add VIP ticket: would exceed reserved allocation (${ticketInfo.vipCount + 1} > ${ticketInfo.reserved})`,
            },
            { status: 400 },
          );
        }
      }
    }

    // Check if user already has a ticket for this event
    const existingTicket = await db.query.tickets.findFirst({
      where: and(eq(tickets.eventId, eventId), eq(tickets.email, email)),
      columns: { id: true, type: true },
    });

    if (existingTicket) {
      const newType = type || "VIP";
      const typeChanged = existingTicket.type !== newType;

      // If upgrading to VIP from non-VIP, check VIP capacity
      if (
        newType === "VIP" &&
        existingTicket.type !== "VIP" &&
        event.capacity
      ) {
        const ticketInfo = await getAvailablePublicTickets(eventId);
        if (ticketInfo.vipCount + 1 > ticketInfo.reserved) {
          return NextResponse.json(
            {
              error: `Cannot upgrade to VIP: would exceed reserved allocation (${ticketInfo.vipCount + 1} > ${ticketInfo.reserved})`,
            },
            { status: 400 },
          );
        }
      }

      // Update the existing ticket's type (and name if provided)
      await db.update(tickets)
        .set({ type: newType, ...(name ? { name } : {}) })
        .where(eq(tickets.id, existingTicket.id));
      const updatedTicket = await db.query.tickets.findFirst({
        where: eq(tickets.id, existingTicket.id),
        columns: TICKET_COLUMNS,
        with: TICKET_WITH_EVENT_DETAILS,
      });

      // Remove user from waitlist if they were on it
      try {
        await db.delete(waitlist).where(and(eq(waitlist.eventId, eventId), eq(waitlist.email, email)));
      } catch (waitlistError) {
        console.error("Waitlist removal error (non-fatal):", waitlistError);
      }

      // Only send email if the type actually changed
      if (typeChanged && updatedTicket) {
        try {
          if (updatedTicket.type === "STANDBY") {
            await sendStandbyLineEmail({
              email: updatedTicket.email,
              name: updatedTicket.name || null,
              eventName: updatedTicket.event?.name || "Event",
              eventStartTime: updatedTicket.event?.startTimeDate?.toISOString() ?? null,
              eventVenue: updatedTicket.event?.venue,
              eventVenueLink: updatedTicket.event?.venueLink,
              standbyOpenTime: formatDoorsOpenTime(updatedTicket.event?.doorsOpen),
              ticketId: updatedTicket.id,
              eventId: updatedTicket.event?.id || null,
              imgVersion: updatedTicket.event?.imgVersion ?? null,
              eventTagline: updatedTicket.event?.tagline || null,
            });
          } else {
            await sendTicketEmail({
              email: updatedTicket.email,
              name: updatedTicket.name || null,
              eventName: updatedTicket.event?.name || "Event",
              ticketType: updatedTicket.type || "VIP",
              eventStartTime: updatedTicket.event?.startTimeDate?.toISOString() || null,
              eventEndTime: updatedTicket.event?.endTimeDate?.toISOString() || null,
              eventRoute: updatedTicket.event?.route || null,
              ticketId: updatedTicket.id,
              eventVenue: updatedTicket.event?.venue || null,
              eventVenueLink: updatedTicket.event?.venueLink || null,
              eventDescription: updatedTicket.event?.desc || null,
              doorsOpenTime: updatedTicket.event?.doorsOpen?.toISOString() || null,
              eventId: updatedTicket.event?.id || null,
              imgVersion: updatedTicket.event?.imgVersion ?? null,
              eventTagline: updatedTicket.event?.tagline || null,
            });
          }
        } catch (emailError) {
          console.error("Email sending error (non-fatal):", emailError);
        }
      }

      // If upgraded to VIP (from STANDARD), pull someone off the waitlist if there's capacity
      if (typeChanged && newType === "VIP" && updatedTicket?.eventId) {
        try {
          await pullFromWaitlist(null, updatedTicket.eventId, 1);
        } catch (waitlistError) {
          console.error(
            "Waitlist conversion error (non-fatal):",
            waitlistError,
          );
        }
      }

      await logAuditEvent({
        action: "ticket.create",
        actor: auth.email!,
        eventId: eventId,
        eventName: updatedTicket!.event?.name ?? null,
        targetEmail: email,
        metadata: { ticketId: updatedTicket!.id, type: updatedTicket!.type, updated: true },
      });

      return NextResponse.json({
        success: true,
        ticket: serializeTicket(updatedTicket!),
        updated: true,
      });
    }

    // Create the VIP ticket
    const [inserted] = await db.insert(tickets).values({
      eventId: eventId,
      email: email,
      name: name || null,
      type: type || "VIP",
    }).returning();
    const ticket = await db.query.tickets.findFirst({
      where: eq(tickets.id, inserted.id),
      columns: TICKET_COLUMNS,
      with: TICKET_WITH_EVENT_DETAILS,
    });

    // Remove user from waitlist if they were on it
    try {
      await db.delete(waitlist).where(and(eq(waitlist.eventId, eventId), eq(waitlist.email, email)));
    } catch (waitlistError) {
      console.error("Waitlist removal error (non-fatal):", waitlistError);
    }

    // Send ticket confirmation email
    try {
      if (ticket!.type === "STANDBY") {
        await sendStandbyLineEmail({
          email: ticket!.email,
          name: ticket!.name || null,
          eventName: ticket!.event?.name || "Event",
          eventStartTime: ticket!.event?.startTimeDate?.toISOString() ?? null,
          eventVenue: ticket!.event?.venue,
          eventVenueLink: ticket!.event?.venueLink,
          standbyOpenTime: formatDoorsOpenTime(event.doorsOpen),
          ticketId: ticket!.id,
          eventId: ticket!.event?.id || null,
          imgVersion: ticket!.event?.imgVersion ?? null,
          eventTagline: ticket!.event?.tagline || null,
        });
      } else {
        await sendTicketEmail({
          email: ticket!.email,
          name: ticket!.name || null,
          eventName: ticket!.event?.name || "Event",
          ticketType: ticket!.type || "VIP",
          eventStartTime: ticket!.event?.startTimeDate?.toISOString() || null,
          eventEndTime: ticket!.event?.endTimeDate?.toISOString() || null,
          eventRoute: ticket!.event?.route || null,
          ticketId: ticket!.id,
          eventVenue: ticket!.event?.venue || null,
          eventVenueLink: ticket!.event?.venueLink || null,
          eventDescription: ticket!.event?.desc || null,
          doorsOpenTime: ticket!.event?.doorsOpen?.toISOString() || null,
          eventId: ticket!.event?.id || null,
          imgVersion: ticket!.event?.imgVersion ?? null,
          eventTagline: ticket!.event?.tagline || null,
        });
      }
    } catch (emailError) {
      console.error("Email sending error:", emailError);
      // Ticket was created but email failed - return error
      return NextResponse.json(
        {
          error:
            "Ticket was created but failed to send confirmation email. Please contact support.",
        },
        { status: 500 },
      );
    }

    await logAuditEvent({
      action: "ticket.create",
      actor: auth.email!,
      eventId: eventId,
      eventName: ticket!.event?.name ?? null,
      targetEmail: email,
      metadata: { ticketId: ticket!.id, type: ticket!.type },
    });

    return NextResponse.json({ success: true, ticket: serializeTicket(ticket!) });
  } catch (error) {
    console.error("Ticket creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
