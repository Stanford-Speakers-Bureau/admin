import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import { isValidUUID } from "@/app/lib/validation";
import { db, eq, ne, and, events, inArray, notify, tickets, userProfiles } from "@ssb/db";

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

    // Phase 1: Parallel queries for event, signups, and tickets
    const [event, notifications, ticketResults] = await Promise.all([
      db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: {
          name: true,
          releaseDate: true,
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
        orderBy: (t, { asc }) => [asc(t.createdAt)],
      }),
      db.query.tickets.findMany({
        where: eq(tickets.eventId, eventId),
        columns: { email: true },
      }),
    ]);

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const uniqueEmails = [
      ...new Set(notifications.map((n) => n.email.trim().toLowerCase())),
    ];

    const ticketEmailSet = new Set(
      ticketResults.map((t) => t.email.trim().toLowerCase()),
    );

    // Phase 2: Dependent queries for profiles and cross-pollination
    const [profiles, crossPollinationRows] = await Promise.all([
      uniqueEmails.length > 0
        ? db.query.userProfiles.findMany({
            where: inArray(userProfiles.email, uniqueEmails),
            columns: {
              email: true,
              eduPersonAffiliation: true,
            },
          })
        : [],
      uniqueEmails.length > 0
        ? db.query.notify.findMany({
            where: and(
              inArray(notify.email, uniqueEmails),
              ne(notify.speakerId, eventId),
            ),
            columns: {
              email: true,
              speakerId: true,
            },
          })
        : [],
    ]);

    // Build profile lookup
    const profileByEmail = new Map(
      profiles.map((p) => [p.email.toLowerCase(), p]),
    );

    // Build affiliations parallel array
    const affiliations = notifications.map((n) => {
      const profile = profileByEmail.get(n.email.trim().toLowerCase());
      return profile?.eduPersonAffiliation ?? [];
    });

    // Conversion rate
    const ticketHolders = uniqueEmails.filter((e) =>
      ticketEmailSet.has(e),
    ).length;

    // Cross-pollination: group by other event, count unique emails
    const crossPollinationMap = new Map<string, Set<string>>();
    for (const row of crossPollinationRows) {
      const email = row.email.trim().toLowerCase();
      if (!crossPollinationMap.has(row.speakerId)) {
        crossPollinationMap.set(row.speakerId, new Set());
      }
      crossPollinationMap.get(row.speakerId)!.add(email);
    }

    // Fetch event names for cross-pollination
    const otherEventIds = [...crossPollinationMap.keys()];
    const otherEvents =
      otherEventIds.length > 0
        ? await db.query.events.findMany({
            where: inArray(events.id, otherEventIds),
            columns: { id: true, name: true },
          })
        : [];
    const eventNameMap = new Map(otherEvents.map((e) => [e.id, e.name]));

    const crossPollination = otherEventIds
      .map((eid) => ({
        eventId: eid,
        eventName: eventNameMap.get(eid) ?? null,
        sharedCount: crossPollinationMap.get(eid)!.size,
      }))
      .sort((a, b) => b.sharedCount - a.sharedCount);

    return NextResponse.json({
      eventName: event.name,
      releaseDate: event.releaseDate?.toISOString() ?? null,
      ticketingDate: event.ticketingDate?.toISOString() ?? null,
      totalSignups: notifications.length,
      uniqueSignups: uniqueEmails.length,
      ticketHolders,
      conversionRate:
        uniqueEmails.length > 0
          ? (ticketHolders / uniqueEmails.length) * 100
          : 0,
      timestamps: notifications.map((n) => n.createdAt.toISOString()),
      affiliations,
      crossPollination,
    });
  } catch (error) {
    console.error("Notify analytics error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
