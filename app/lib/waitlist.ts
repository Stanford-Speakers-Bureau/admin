import { getAvailablePublicTickets } from "@/app/lib/supabase";
import { db, eq, inArray, roles, tickets, waitlist } from "@ssb/db";
import { sendTicketEmail } from "@/app/lib/email";
import { hasRoleName } from "@/app/lib/auth";

const WAITLIST_BATCH_MULTIPLIER = 5;
const MIN_WAITLIST_BATCH_SIZE = 50;

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

async function getFeeWaiverEmailSet(emails: string[]): Promise<Set<string>> {
  const normalizedEmails = [...new Set(
    emails.map((email) => normalizeEmail(email)).filter(Boolean),
  )];

  if (normalizedEmails.length === 0) {
    return new Set();
  }

  const roleRows = await db.query.roles.findMany({
    where: inArray(roles.email, normalizedEmails),
    columns: {
      email: true,
      roles: true,
    },
  });

  return new Set(
    roleRows
      .filter((row) => hasRoleName(row.roles, "fee_waiver"))
      .map((row) => normalizeEmail(row.email))
      .filter((email): email is string => !!email),
  );
}

async function getEligibleWaitlistEntries(
  eventId: string,
  maxToPull: number,
): Promise<Array<{ id: string; email: string; name: string | null }>> {
  const eligibleEntries: Array<{ id: string; email: string; name: string | null }> = [];
  const batchSize = Math.max(maxToPull * WAITLIST_BATCH_MULTIPLIER, MIN_WAITLIST_BATCH_SIZE);
  let offset = 0;

  while (eligibleEntries.length < maxToPull) {
    const waitlistBatch = await db.query.waitlist.findMany({
      where: eq(waitlist.eventId, eventId),
      orderBy: (t, { asc }) => [asc(t.position)],
      offset,
      limit: batchSize,
      columns: { id: true, email: true, name: true },
    });

    if (!waitlistBatch.length) {
      break;
    }

    const feeWaiverEmails = await getFeeWaiverEmailSet(
      waitlistBatch.map((entry) => entry.email),
    );

    for (const entry of waitlistBatch) {
      if (!feeWaiverEmails.has(normalizeEmail(entry.email))) {
        eligibleEntries.push(entry);
      }

      if (eligibleEntries.length >= maxToPull) {
        break;
      }
    }

    offset += waitlistBatch.length;
    if (waitlistBatch.length < batchSize) {
      break;
    }
  }

  return eligibleEntries;
}

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

  const eligibleWaitlistEntries = await getEligibleWaitlistEntries(
    eventId,
    maxToPull,
  );

  if (!eligibleWaitlistEntries.length) return 0;

  // Create STANDARD tickets for each waitlist person
  const insertedIds: string[] = [];
  for (const entry of eligibleWaitlistEntries) {
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
            columns: { id: true, name: true, route: true, startTimeDate: true, endTimeDate: true, venue: true, venueLink: true, desc: true, doorsOpen: true, tagline: true, imgVersion: true },
          },
        },
      })
    : [];

  if (!newTickets.length) return 0;

  if (newTickets.length !== eligibleWaitlistEntries.length) {
    console.error(
      "Waitlist conversion mismatch (non-fatal):",
      `requested=${eligibleWaitlistEntries.length}`,
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
          doorsOpenTime: newTicket.event?.doorsOpen?.toISOString() || null,
          eventId: newTicket.event?.id || null,
          imgVersion: newTicket.event?.imgVersion ?? null,
          eventTagline: newTicket.event?.tagline || null,
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
  const confirmedWaitlistIds = eligibleWaitlistEntries
    .filter((entry) => confirmedEmails.has(entry.email))
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
