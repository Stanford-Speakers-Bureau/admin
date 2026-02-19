import { getAvailablePublicTickets } from "@/app/lib/supabase";
import { db, eq, inArray, tickets, waitlist } from "@ssb/db";
import { sendTicketEmail } from "@/app/lib/email";

export async function pullFromWaitlist(
  _adminClient: any, // kept for backward compatibility during migration
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
  const newTickets: Array<{
    id: string;
    email: string;
    name: string | null;
    type: string;
    eventId: string | null;
    event: {
      id: string;
      name: string | null;
      route: string | null;
      startTimeDate: Date | null;
      venue: string | null;
      venueLink: string | null;
      desc: string | null;
    } | null;
  }> = [];

  for (const entry of waitlistEntries) {
    try {
      const [inserted] = await db.insert(tickets).values({
        eventId,
        email: entry.email,
        name: entry.name ?? null,
        type: "STANDARD",
      }).returning();
      const ticket = await db.query.tickets.findFirst({
        where: eq(tickets.id, inserted.id),
        columns: { id: true, email: true, name: true, type: true, eventId: true },
        with: {
          event: {
            columns: { id: true, name: true, route: true, startTimeDate: true, venue: true, venueLink: true, desc: true },
          },
        },
      });
      if (ticket) newTickets.push(ticket);
    } catch (err) {
      console.error(
        "Failed to create ticket for waitlist person (non-fatal):",
        err,
      );
    }
  }

  if (!newTickets.length) return 0;

  // Remove converted entries from the waitlist
  const createdEmails = new Set(newTickets.map((t) => t.email));
  const waitlistIds = waitlistEntries
    .filter((e) => createdEmails.has(e.email))
    .map((e) => e.id);

  if (newTickets.length !== waitlistEntries.length) {
    console.error(
      "Waitlist conversion mismatch (non-fatal):",
      `requested=${waitlistEntries.length}`,
      `created=${newTickets.length}`,
    );
  }

  if (waitlistIds.length > 0) {
    try {
      await db.delete(waitlist).where(inArray(waitlist.id, waitlistIds));
    } catch (err) {
      console.error("Waitlist removal error (non-fatal):", err);
    }
  }

  for (const newTicket of newTickets) {
    try {
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

  return newTickets.length;
}
