import {
  getAvailablePublicTickets,
  getSupabaseClient,
} from "@/app/lib/supabase";
import { sendTicketEmail } from "@/app/lib/email";

export async function pullFromWaitlist(
  adminClient: ReturnType<typeof getSupabaseClient>,
  eventId: string,
  limit?: number,
): Promise<number> {
  const ticketInfo = await getAvailablePublicTickets(eventId);
  const maxAvailable = ticketInfo.available;
  const maxToPull =
    typeof limit === "number" ? Math.min(limit, maxAvailable) : maxAvailable;

  if (maxToPull <= 0) return 0;

  // Get the first person on the waitlist for this event
  const { data: waitlistEntries, error: waitlistFetchError } = await adminClient
    .from("waitlist")
    .select("id, email, name")
    .eq("event_id", eventId)
    .order("position", { ascending: true })
    .limit(maxToPull);

  if (waitlistFetchError || !waitlistEntries?.length) return 0;

  // Create a STANDARD ticket for the waitlist person (transfer name from waitlist)
  const { data: newTickets, error: ticketCreateError } = await adminClient
    .from("tickets")
    .insert(
      waitlistEntries.map((entry) => ({
        event_id: eventId,
        email: entry.email,
        name: entry.name ?? null,
        type: "STANDARD",
      })),
    )
    .select(
      `
      id,
      email,
      name,
      type,
      event_id,
      events (
        id,
        name,
        route,
        start_time_date,
        venue,
        venue_link,
        desc
      )
    `,
    );

  if (ticketCreateError || !newTickets?.length) {
    console.error(
      "Failed to create ticket for waitlist person (non-fatal):",
      ticketCreateError,
    );
    return 0;
  }

  // Remove them from the waitlist
  const waitlistIds = waitlistEntries.map((entry) => entry.id);
  const createdEmails = new Set(newTickets.map((ticket) => ticket.email));

  if (newTickets.length !== waitlistEntries.length) {
    console.error(
      "Waitlist conversion mismatch (non-fatal):",
      `requested=${waitlistEntries.length}`,
      `created=${newTickets.length}`,
    );
  }

  const waitlistDeleteQuery = adminClient.from("waitlist").delete();
  if (newTickets.length === waitlistEntries.length) {
    waitlistDeleteQuery.in("id", waitlistIds);
  } else if (createdEmails.size > 0) {
    waitlistDeleteQuery
      .eq("event_id", eventId)
      .in("email", Array.from(createdEmails));
  } else {
    return 0;
  }

  const { error: waitlistDeleteError } = await waitlistDeleteQuery;

  if (waitlistDeleteError) {
    console.error("Waitlist removal error (non-fatal):", waitlistDeleteError);
  }

  for (const newTicket of newTickets) {
    try {
      const eventData = Array.isArray(newTicket.events)
        ? newTicket.events[0]
        : newTicket.events;
      await sendTicketEmail({
        email: newTicket.email,
        name: newTicket.name || null,
        eventName: eventData?.name || "Event",
        ticketType: newTicket.type || "STANDARD",
        eventStartTime: eventData?.start_time_date || null,
        eventRoute: eventData?.route || null,
        ticketId: newTicket.id,
        eventVenue: eventData?.venue || null,
        eventVenueLink: eventData?.venue_link || null,
        eventDescription: eventData?.desc || null,
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
