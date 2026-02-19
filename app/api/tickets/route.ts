import { NextResponse } from "next/server";
import {
  verifyAdminRequest,
  getAvailablePublicTickets,
  isEventUnderCapacity,
} from "@/app/lib/supabase";
import {
  sendDayOfReminderEmail,
  sendEarlyReminderEmail,
  sendTicketEmail,
} from "@/app/lib/email";
import { pullFromWaitlist } from "@/app/lib/waitlist";
import { db, eq, and, ilike, count as dbCount, tickets, events, waitlist, referrals } from "@ssb/db";

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
  event: { columns: { id: true, name: true, route: true, startTimeDate: true } },
} as const;

/** Extended event relation (includes venue/desc for emails) */
const TICKET_WITH_EVENT_DETAILS = {
  event: { columns: { id: true, name: true, route: true, startTimeDate: true, venue: true, venueLink: true, desc: true } },
} as const;

/** Extended event relation with doors_open for reminders */
const TICKET_WITH_DOORS_OPEN = {
  event: { columns: { id: true, name: true, route: true, startTimeDate: true, venue: true, venueLink: true, desc: true, doorsOpen: true } },
} as const;

export async function GET(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get("eventId");
    const email = searchParams.get("email");
    const type = searchParams.get("type");
    const scanned = searchParams.get("scanned");
    const limit = parseInt(searchParams.get("limit") || "100");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Build where conditions for main query and filtered count
    const conditions: ReturnType<typeof eq>[] = [];
    if (eventId) conditions.push(eq(tickets.eventId, eventId));
    if (email) conditions.push(ilike(tickets.email, `%${email}%`));
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
    const [ticketResults, [totalResult], [scannedResult], [unscannedResult], [filteredResult], [standardResult], [vipResult]] =
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
      ]);

    return NextResponse.json({
      tickets: ticketResults.map(serializeTicket),
      total: totalResult?.count ?? 0,
      scannedCount: scannedResult?.count ?? 0,
      unscannedCount: unscannedResult?.count ?? 0,
      filteredCount: filteredResult?.count ?? 0,
      standardCount: standardResult?.count ?? 0,
      vipCount: vipResult?.count ?? 0,
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
      columns: { eventId: true, type: true },
    });

    if (!ticketToDelete) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Delete the ticket
    await db.delete(tickets).where(eq(tickets.id, id));

    // Sync referral counts
    try {
      const allReferrals = await db.query.referrals.findMany({
        columns: { id: true, eventId: true, referralCode: true, count: true },
      });

      for (const referral of allReferrals) {
        const conditions = [eq(tickets.eventId, referral.eventId)];
        if (referral.referralCode) conditions.push(eq(tickets.referral, referral.referralCode));
        const [result] = await db.select({ count: dbCount() })
          .from(tickets)
          .where(and(...conditions));
        const actualCount = result?.count ?? 0;

        if (referral.count !== actualCount) {
          await db.update(referrals)
            .set({ count: actualCount })
            .where(eq(referrals.id, referral.id));
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
  const allEvents = await db.query.events.findMany({
    columns: { id: true, scanned: true },
  });

  for (const event of allEvents) {
    const [result] = await db.select({ count: dbCount() })
      .from(tickets)
      .where(and(eq(tickets.eventId, event.id), eq(tickets.scanned, true)));
    const actualScanned = result?.count ?? 0;

    if (event.scanned !== actualScanned) {
      await db.update(events)
        .set({ scanned: actualScanned })
        .where(eq(events.id, event.id));
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
    const { id, action, type, scanned, promo, name } = body;

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
      const newName = typeof name === "string" ? name.trim() || null : null;

      await db.update(tickets).set({ name: newName }).where(eq(tickets.id, id));
      const ticket = await db.query.tickets.findFirst({
        where: eq(tickets.id, id),
        columns: TICKET_COLUMNS,
        with: TICKET_WITH_EVENT,
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

      return NextResponse.json({ success: true, ticket: serializeTicket(ticket!) });
    } else if (action === "updateType" || type) {
      // Update ticket type
      if (type !== "VIP" && type !== "STANDARD") {
        return NextResponse.json(
          { error: "Invalid ticket type. Must be 'VIP' or 'STANDARD'." },
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
          await sendTicketEmail({
            email: ticket.email,
            name: ticket.name || null,
            eventName: ticket.event?.name || "Event",
            ticketType: ticket.type || "STANDARD",
            eventStartTime: ticket.event?.startTimeDate?.toISOString() || null,
            eventRoute: ticket.event?.route || null,
            ticketId: ticket.id,
            eventVenue: ticket.event?.venue || null,
            eventVenueLink: ticket.event?.venueLink || null,
            eventDescription: ticket.event?.desc || null,
          });
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
                  eventRoute: newTicket.event?.route || null,
                  ticketId: newTicket.id,
                  eventVenue: newTicket.event?.venue || null,
                  eventVenueLink: newTicket.event?.venueLink || null,
                  eventDescription: newTicket.event?.desc || null,
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
          eventRoute: ticket.event?.route || null,
          ticketId: ticket.id,
          eventVenue: ticket.event?.venue || null,
          eventVenueLink: ticket.event?.venueLink || null,
          eventDescription: ticket.event?.desc || null,
        });
      } catch (emailError) {
        console.error("Email sending error:", emailError);
        return NextResponse.json(
          { error: "Failed to send email" },
          { status: 500 },
        );
      }

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

      // Fetch event details including doors_open time
      const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: {
          id: true,
          name: true,
          route: true,
          startTimeDate: true,
          doorsOpen: true,
          venue: true,
          venueLink: true,
          desc: true,
        },
      });

      if (!event) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }

      // Fetch all tickets for this event (both VIP and STANDARD)
      const eventTickets = await db.query.tickets.findMany({
        where: eq(tickets.eventId, eventId),
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

      // Send reminder emails to all ticket holders in batches
      const BATCH_SIZE = 14;
      const MIN_BATCH_DURATION_MS = 1000;
      const results: PromiseSettledResult<{
        success: boolean;
        email: string;
        error?: unknown;
      }>[] = [];

      for (let i = 0; i < eventTickets.length; i += BATCH_SIZE) {
        const batchStartTime = Date.now();
        const batch = eventTickets.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map((ticket) =>
          sendDayOfReminderEmail({
            email: ticket.email,
            name: ticket.name || null,
            eventName: event.name || "Event",
            ticketType: ticket.type || "STANDARD",
            eventStartTime: event.startTimeDate?.toISOString() || null,
            eventRoute: event.route || null,
            ticketId: ticket.id,
            eventVenue: event.venue || null,
            eventVenueLink: event.venueLink || null,
            eventDescription: event.desc || null,
            doorsOpenTime: event.doorsOpen?.toISOString() || null,
          }).then(
            () => ({ success: true, email: ticket.email }),
            (error) => ({
              success: false,
              email: ticket.email,
              error,
            }),
          ),
        );
        const batchResults = await Promise.allSettled(batchPromises);
        results.push(...batchResults);

        const batchDuration = Date.now() - batchStartTime;
        if (batchDuration < MIN_BATCH_DURATION_MS && i + BATCH_SIZE < eventTickets.length) {
          await new Promise((resolve) =>
            setTimeout(resolve, MIN_BATCH_DURATION_MS - batchDuration),
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
            const errorMessage =
              "error" in emailResult && emailResult.error instanceof Error
                ? emailResult.error.message
                : "Unknown error";
            errors.push(`${emailResult.email}: ${errorMessage}`);
            console.error(
              `Failed to send reminder to ${emailResult.email}:`,
              "error" in emailResult ? emailResult.error : "Unknown error",
            );
          }
        } else {
          failed++;
          errors.push(`Promise rejected: ${result.reason}`);
          console.error("Email promise rejected:", result.reason);
        }
      }

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
          eventRoute: ticket.event?.route || null,
          ticketId: ticket.id,
          eventVenue: ticket.event?.venue || null,
          eventVenueLink: ticket.event?.venueLink || null,
          eventDescription: ticket.event?.desc || null,
          doorsOpenTime: ticket.event?.doorsOpen?.toISOString() || null,
        });
      } catch (emailError) {
        console.error("Email sending error:", emailError);
        return NextResponse.json(
          { error: "Failed to send reminder email" },
          { status: 500 },
        );
      }

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

      const event = await db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: {
          id: true,
          name: true,
          route: true,
          startTimeDate: true,
          doorsOpen: true,
          venue: true,
          venueLink: true,
          desc: true,
        },
      });

      if (!event) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }

      const eventTickets = await db.query.tickets.findMany({
        where: eq(tickets.eventId, eventId),
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

      const BATCH_SIZE = 14;
      const MIN_BATCH_DURATION_MS = 1000;
      const results: PromiseSettledResult<{
        success: boolean;
        email: string;
        error?: unknown;
      }>[] = [];

      for (let i = 0; i < eventTickets.length; i += BATCH_SIZE) {
        const batchStartTime = Date.now();
        const batch = eventTickets.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map((ticket) =>
          sendEarlyReminderEmail({
            email: ticket.email,
            name: ticket.name || null,
            eventName: event.name || "Event",
            ticketType: ticket.type || "STANDARD",
            eventStartTime: event.startTimeDate?.toISOString() || null,
            eventRoute: event.route || null,
            ticketId: ticket.id,
            eventVenue: event.venue || null,
            eventVenueLink: event.venueLink || null,
            eventDescription: event.desc || null,
            doorsOpenTime: event.doorsOpen?.toISOString() || null,
            promo: promo || null,
          }).then(
            () => ({ success: true, email: ticket.email }),
            (error) => ({
              success: false,
              email: ticket.email,
              error,
            }),
          ),
        );
        const batchResults = await Promise.allSettled(batchPromises);
        results.push(...batchResults);

        const batchDuration = Date.now() - batchStartTime;
        if (batchDuration < MIN_BATCH_DURATION_MS && i + BATCH_SIZE < eventTickets.length) {
          await new Promise((resolve) =>
            setTimeout(resolve, MIN_BATCH_DURATION_MS - batchDuration),
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
            const errorMessage =
              "error" in emailResult && emailResult.error instanceof Error
                ? emailResult.error.message
                : "Unknown error";
            errors.push(`${emailResult.email}: ${errorMessage}`);
            console.error(
              `Failed to send early reminder to ${emailResult.email}:`,
              "error" in emailResult ? emailResult.error : "Unknown error",
            );
          }
        } else {
          failed++;
          errors.push(`Promise rejected: ${result.reason}`);
          console.error("Email promise rejected:", result.reason);
        }
      }

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
          eventRoute: ticket.event?.route || null,
          ticketId: ticket.id,
          eventVenue: ticket.event?.venue || null,
          eventVenueLink: ticket.event?.venueLink || null,
          eventDescription: ticket.event?.desc || null,
          doorsOpenTime: ticket.event?.doorsOpen?.toISOString() || null,
          promo: promo || null,
        });
      } catch (emailError) {
        console.error("Email sending error:", emailError);
        return NextResponse.json(
          { error: "Failed to send early reminder email" },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        message: "Early reminder sent successfully",
      });
    } else {
      return NextResponse.json(
        {
          error:
            "Invalid action. Use 'updateName', 'unscan', 'updateType', 'updateScanned', 'resendEmail', 'sendDayOfReminders', 'sendDayOfReminder', 'sendEarlyReminders', or 'sendEarlyReminder'.",
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
      columns: { id: true, name: true, capacity: true, reserved: true },
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
          await sendTicketEmail({
            email: updatedTicket.email,
            name: updatedTicket.name || null,
            eventName: updatedTicket.event?.name || "Event",
            ticketType: updatedTicket.type || "VIP",
            eventStartTime: updatedTicket.event?.startTimeDate?.toISOString() || null,
            eventRoute: updatedTicket.event?.route || null,
            ticketId: updatedTicket.id,
            eventVenue: updatedTicket.event?.venue || null,
            eventVenueLink: updatedTicket.event?.venueLink || null,
            eventDescription: updatedTicket.event?.desc || null,
          });
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
      await sendTicketEmail({
        email: ticket!.email,
        name: ticket!.name || null,
        eventName: ticket!.event?.name || "Event",
        ticketType: ticket!.type || "VIP",
        eventStartTime: ticket!.event?.startTimeDate?.toISOString() || null,
        eventRoute: ticket!.event?.route || null,
        ticketId: ticket!.id,
        eventVenue: ticket!.event?.venue || null,
        eventVenueLink: ticket!.event?.venueLink || null,
        eventDescription: ticket!.event?.desc || null,
      });
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

    return NextResponse.json({ success: true, ticket: serializeTicket(ticket!) });
  } catch (error) {
    console.error("Ticket creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
