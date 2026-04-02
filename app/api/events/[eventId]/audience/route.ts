import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import { getSupabaseClient } from "@/app/lib/supabase";
import { isValidUUID } from "@/app/lib/validation";
import { db, eq, events, inArray, notify, tickets } from "@ssb/db";

type Affiliation =
  | "student"
  | "faculty"
  | "affiliate"
  | "staff"
  | "member"
  | "missing";

type LegacyAuthUser = {
  email?: string;
  created_at?: string;
  updated_at?: string;
  last_sign_in_at?: string;
  user_metadata?: Record<string, unknown>;
};

type AudienceUserAccumulator = {
  email: string;
  displayName: string | null;
  affiliation: Affiliation;
  lastLoginAt: string | null;
  notifyEventIds: Set<string>;
  ticketedEventIds: Set<string>;
  attendedEventIds: Set<string>;
};

const AFFILIATION_PRIORITY: Affiliation[] = [
  "student",
  "faculty",
  "affiliate",
  "staff",
  "member",
];
const EMAIL_QUERY_CHUNK_SIZE = 500;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeAffiliation(value: string): string {
  return value.trim().toLowerCase().split("@")[0];
}

function getStringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getLaterIsoDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function getLegacyDisplayName(user: LegacyAuthUser): string | null {
  const metadata = user.user_metadata ?? {};

  const direct =
    getStringValue(metadata.display_name) ||
    getStringValue(metadata.full_name) ||
    getStringValue(metadata.name);

  if (direct) return direct;

  const firstName = getStringValue(metadata.first_name);
  const lastName = getStringValue(metadata.last_name);

  if (firstName && lastName) return `${firstName} ${lastName}`;
  return firstName || lastName || null;
}

function createUserAccumulator(email: string): AudienceUserAccumulator {
  return {
    email,
    displayName: null,
    affiliation: "missing",
    lastLoginAt: null,
    notifyEventIds: new Set(),
    ticketedEventIds: new Set(),
    attendedEventIds: new Set(),
  };
}

function resolveAffiliation(values: string[]): Affiliation {
  const normalized = new Set(values.map(normalizeAffiliation).filter(Boolean));

  for (const affiliation of AFFILIATION_PRIORITY) {
    if (normalized.has(affiliation)) {
      return affiliation;
    }
  }

  return "missing";
}

function chunkArray<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

async function listLegacyAuthUsers(): Promise<{
  users: LegacyAuthUser[];
  warning: string | null;
}> {
  const supabase = getSupabaseClient();
  const users: LegacyAuthUser[] = [];
  const perPage = 1000;

  try {
    for (let page = 1; page <= 100; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({
        page,
        perPage,
      });

      if (error) {
        throw error;
      }

      if (!data.users.length) {
        break;
      }

      users.push(...data.users);

      if (data.users.length < perPage) {
        break;
      }
    }

    return { users, warning: null };
  } catch (error) {
    console.error("Audience legacy auth fetch error:", error);
    return {
      users: [],
      warning:
        "Older auth records could not be loaded, so some accounts may be missing from this view.",
    };
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const { eventId } = await params;

    if (!eventId || !isValidUUID(eventId)) {
      return NextResponse.json(
        { error: "Valid event ID is required" },
        { status: 400 },
      );
    }

    const [selectedEvent, profileRows, legacyAuthResult] = await Promise.all([
      db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: {
          id: true,
          name: true,
          route: true,
          startTimeDate: true,
        },
      }),
      db.query.userProfiles.findMany({
        columns: {
          email: true,
          displayName: true,
          lastSignInAt: true,
          eduPersonAffiliation: true,
          eduPersonScopedAffiliation: true,
        },
      }),
      listLegacyAuthUsers(),
    ]);

    if (!selectedEvent) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const usersByEmail = new Map<string, AudienceUserAccumulator>();

    for (const profile of profileRows) {
      const email = normalizeEmail(profile.email);
      const user = usersByEmail.get(email) ?? createUserAccumulator(email);
      user.displayName = user.displayName || profile.displayName || null;
      user.affiliation =
        user.affiliation === "missing"
          ? resolveAffiliation([
              ...profile.eduPersonAffiliation,
              ...profile.eduPersonScopedAffiliation,
            ])
          : user.affiliation;
      user.lastLoginAt = getLaterIsoDate(
        user.lastLoginAt,
        profile.lastSignInAt?.toISOString() ?? null,
      );
      usersByEmail.set(email, user);
    }

    for (const legacyUser of legacyAuthResult.users) {
      if (!legacyUser.email || !legacyUser.last_sign_in_at) {
        continue;
      }

      const email = normalizeEmail(legacyUser.email);
      const user = usersByEmail.get(email) ?? createUserAccumulator(email);
      user.displayName = user.displayName || getLegacyDisplayName(legacyUser);
      user.lastLoginAt = getLaterIsoDate(
        user.lastLoginAt,
        legacyUser.last_sign_in_at ?? null,
      );
      usersByEmail.set(email, user);
    }

    if (usersByEmail.size === 0) {
      return NextResponse.json({
        event: {
          id: selectedEvent.id,
          name: selectedEvent.name,
          route: selectedEvent.route,
          date: selectedEvent.startTimeDate?.toISOString() ?? null,
        },
        users: [],
        stats: {
          totalUsers: 0,
          currentEventNotifyUsers: 0,
          currentEventEngagedUsers: 0,
          usersWithAnyEventActivity: 0,
          affiliationCounts: {
            student: 0,
            faculty: 0,
            affiliate: 0,
            staff: 0,
            member: 0,
            missing: 0,
          },
        },
        warnings: legacyAuthResult.warning ? [legacyAuthResult.warning] : [],
      });
    }

    const loggedInEmails = Array.from(usersByEmail.keys());
    const emailChunks = chunkArray(loggedInEmails, EMAIL_QUERY_CHUNK_SIZE);

    const [notifyRowChunks, ticketRowChunks] = await Promise.all([
      Promise.all(
        emailChunks.map((chunk) =>
          db.query.notify.findMany({
            where: inArray(notify.email, chunk),
            columns: {
              email: true,
              speakerId: true,
            },
          }),
        ),
      ),
      Promise.all(
        emailChunks.map((chunk) =>
          db.query.tickets.findMany({
            where: inArray(tickets.email, chunk),
            columns: {
              email: true,
              eventId: true,
              scanned: true,
              name: true,
            },
          }),
        ),
      ),
    ]);

    const notifyRows = notifyRowChunks.flat();
    const ticketRows = ticketRowChunks.flat();

    for (const row of notifyRows) {
      const email = normalizeEmail(row.email);
      const user = usersByEmail.get(email);

      if (!user) continue;

      user.notifyEventIds.add(row.speakerId);
    }

    for (const row of ticketRows) {
      const email = normalizeEmail(row.email);
      const user = usersByEmail.get(email);

      if (!user) continue;

      user.displayName = user.displayName || row.name || null;

      if (!row.eventId) continue;

      user.ticketedEventIds.add(row.eventId);
      if (row.scanned) {
        user.attendedEventIds.add(row.eventId);
      }
    }

    const users = Array.from(usersByEmail.values())
      .map((user) => {
        const historyEventIds = new Set([
          ...user.notifyEventIds,
          ...user.ticketedEventIds,
          ...user.attendedEventIds,
        ]);

        return {
          email: user.email,
          displayName: user.displayName,
          affiliation: user.affiliation,
          lastLoginAt: user.lastLoginAt,
          currentEventStatus: {
            onNotifyList: user.notifyEventIds.has(eventId),
            ticketed: user.ticketedEventIds.has(eventId),
            attended: user.attendedEventIds.has(eventId),
          },
          counts: {
            notified: user.notifyEventIds.size,
            ticketed: user.ticketedEventIds.size,
            attended: user.attendedEventIds.size,
            totalHistoryEvents: historyEventIds.size,
          },
        };
      })
      .sort((a, b) => {
        const aCurrentScore =
          Number(a.currentEventStatus.attended) * 4 +
          Number(a.currentEventStatus.ticketed) * 2 +
          Number(a.currentEventStatus.onNotifyList);
        const bCurrentScore =
          Number(b.currentEventStatus.attended) * 4 +
          Number(b.currentEventStatus.ticketed) * 2 +
          Number(b.currentEventStatus.onNotifyList);

        if (bCurrentScore !== aCurrentScore) {
          return bCurrentScore - aCurrentScore;
        }

        if (b.counts.totalHistoryEvents !== a.counts.totalHistoryEvents) {
          return b.counts.totalHistoryEvents - a.counts.totalHistoryEvents;
        }

        const aLastLogin = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
        const bLastLogin = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;

        if (bLastLogin !== aLastLogin) {
          return bLastLogin - aLastLogin;
        }

        return (a.displayName || a.email).localeCompare(b.displayName || b.email);
      });

    const stats = users.reduce(
      (acc, user) => {
        const engagedWithCurrentEvent =
          user.currentEventStatus.onNotifyList ||
          user.currentEventStatus.ticketed ||
          user.currentEventStatus.attended;

        acc.totalUsers++;
        if (user.currentEventStatus.onNotifyList) acc.currentEventNotifyUsers++;
        if (user.counts.totalHistoryEvents > 0) acc.usersWithAnyEventActivity++;
        if (engagedWithCurrentEvent) acc.currentEventEngagedUsers++;
        acc.affiliationCounts[user.affiliation]++;

        return acc;
      },
      {
        totalUsers: 0,
        currentEventNotifyUsers: 0,
        currentEventEngagedUsers: 0,
        usersWithAnyEventActivity: 0,
        affiliationCounts: {
          student: 0,
          faculty: 0,
          affiliate: 0,
          staff: 0,
          member: 0,
          missing: 0,
        },
      },
    );

    const warnings = legacyAuthResult.warning ? [legacyAuthResult.warning] : [];

    return NextResponse.json({
      event: {
        id: selectedEvent.id,
        name: selectedEvent.name,
        route: selectedEvent.route,
        date: selectedEvent.startTimeDate?.toISOString() ?? null,
      },
      users,
      stats,
      warnings,
    });
  } catch (error) {
    console.error("Audience data fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
