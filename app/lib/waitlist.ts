import { getAvailablePublicTickets } from "@/app/lib/supabase";
import { db, eq, inArray, tickets, waitlist } from "@ssb/db";
import { sendTicketEmail } from "@/app/lib/email";

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

export async function pullFromWaitlist(
  _adminClient: unknown, // kept for backward compatibility during migration
  eventId: string,
  limit?: number,
): Promise<number> {
  const ticketInfo = await getAvailablePublicTickets(eventId);
  const maxAvailable = ticketInfo.available;
  const maxToPull =
    typeof limit === "number" ? Math.min(limit, maxAvailable) : maxAvailable;

  if (maxToPull <= 0) return 0;

  // Get the first people on the waitlist for this event
  const waitlistEntries = await db.query.waitlist.findMany({
    where: eq(waitlist.eventId, eventId),
    orderBy: (t, { asc }) => [asc(t.position)],
    limit: maxToPull,
    columns: { id: true, email: true, name: true },
  });

  if (!waitlistEntries.length) return 0;

  // Create STANDARD tickets for each waitlist person
  const insertedIds: string[] = [];
  for (const entry of waitlistEntries) {
    try {
      const [inserted] = await db.insert(tickets).values({
        eventId,
        email: entry.email,
        name: entry.name ?? null,
        type: "STANDARD",
      }).returning();
      insertedIds.push(inserted.id);
    } catch (err) {
      console.error(
        "Failed to create ticket for waitlist person (non-fatal):",
        err,
      );
    }
  }
  const newTickets = insertedIds.length > 0
    ? await db.query.tickets.findMany({
        where: inArray(tickets.id, insertedIds),
        columns: { id: true, email: true, name: true, type: true, eventId: true },
        with: {
          event: {
            columns: { id: true, name: true, route: true, startTimeDate: true, endTimeDate: true, venue: true, venueLink: true, desc: true },
          },
        },
      })
    : [];

  if (!newTickets.length) return 0;

  if (newTickets.length !== waitlistEntries.length) {
    console.error(
      "Waitlist conversion mismatch (non-fatal):",
      `requested=${waitlistEntries.length}`,
      `created=${newTickets.length}`,
    );
  }

  // Send emails first — only remove from waitlist after a successful send.
  // This way, a failed email leaves the waitlist entry intact so it can be
  // retried without the user losing their spot.
  const confirmedEmails = new Set<string>();
  for (const newTicket of newTickets) {
    try {
      await sendWithRetry(() =>
        sendTicketEmail({
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
        })
      );
      confirmedEmails.add(newTicket.email);
    } catch (emailError) {
      console.error(
        "Email sending error for waitlist conversion (non-fatal):",
        emailError,
      );
    }
  }

  // Only remove waitlist entries whose email was successfully sent.
  const confirmedWaitlistIds = waitlistEntries
    .filter((e) => confirmedEmails.has(e.email))
    .map((e) => e.id);

  if (confirmedWaitlistIds.length > 0) {
    try {
      await db.delete(waitlist).where(inArray(waitlist.id, confirmedWaitlistIds));
    } catch (err) {
      console.error("Waitlist removal error (non-fatal):", err);
    }
  }

  return newTickets.length;
}
