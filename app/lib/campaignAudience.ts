import { db, eq, notify, tickets, waitlist, userProfiles } from "@ssb/db";

export type AudienceType =
  | "event_ticketholders"
  | "event_ticket_type"
  | "event_notify_no_ticket"
  | "event_notify"
  | "event_not_checked_in"
  | "event_waitlist"
  | "event_past_attendees"
  | "all_users"
  | "past_attendees";

export type AudienceSegment = {
  type: AudienceType;
  eventIds: string[];
  ticketType?: string;
};

export const AUDIENCE_TYPE_LABELS: Record<AudienceType, string> = {
  event_ticketholders: "All ticket holders",
  event_ticket_type: "Ticket holders by type",
  event_notify_no_ticket: "Notify list (no ticket)",
  event_notify: "Notify list (all)",
  event_not_checked_in: "Not checked in",
  event_waitlist: "On waitlist",
  event_past_attendees: "Checked-in attendees",
  all_users: "All registered users",
  past_attendees: "All past attendees",
};

export const TICKET_TYPES = ["STANDARD", "VIP", "EXTERNAL", "STANDBY"] as const;

const EVENT_SCOPED_TYPES: AudienceType[] = [
  "event_ticketholders",
  "event_ticket_type",
  "event_notify_no_ticket",
  "event_notify",
  "event_not_checked_in",
  "event_waitlist",
  "event_past_attendees",
];

export function isEventScoped(audienceType: string): boolean {
  return EVENT_SCOPED_TYPES.includes(audienceType as AudienceType);
}

export function needsTicketType(audienceType: string): boolean {
  return audienceType === "event_ticket_type";
}

export function isValidAudienceType(value: string): value is AudienceType {
  return value in AUDIENCE_TYPE_LABELS;
}

export function parseAudiences(json: string): AudienceSegment[] {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e: unknown): e is AudienceSegment =>
        typeof e === "object" &&
        e !== null &&
        "type" in e &&
        isValidAudienceType((e as { type: string }).type) &&
        "eventIds" in e &&
        Array.isArray((e as { eventIds: unknown }).eventIds),
    );
  } catch {
    return [];
  }
}

export function validateSegments(segments: unknown): segments is AudienceSegment[] {
  if (!Array.isArray(segments) || segments.length === 0) return false;
  return segments.every(
    (s) =>
      typeof s === "object" &&
      s !== null &&
      "type" in s &&
      isValidAudienceType(s.type) &&
      "eventIds" in s &&
      Array.isArray(s.eventIds) &&
      (!isEventScoped(s.type) || s.eventIds.length > 0) &&
      (!needsTicketType(s.type) || (typeof s.ticketType === "string" && s.ticketType.length > 0)),
  );
}

export async function resolveSegments(
  segments: AudienceSegment[],
): Promise<string[]> {
  const allEmails: string[] = [];
  for (const seg of segments) {
    if (isEventScoped(seg.type)) {
      for (const eventId of seg.eventIds) {
        const emails = await resolveAudience(seg.type, eventId, seg.ticketType);
        allEmails.push(...emails);
      }
    } else {
      const emails = await resolveAudience(seg.type, null);
      allEmails.push(...emails);
    }
  }
  return dedupe(allEmails);
}

async function resolveAudience(
  audienceType: AudienceType,
  eventId: string | null,
  ticketType?: string,
): Promise<string[]> {
  switch (audienceType) {
    case "event_ticketholders": {
      if (!eventId) return [];
      const rows = await db.query.tickets.findMany({
        where: eq(tickets.eventId, eventId),
        columns: { email: true },
      });
      return rows.map((r) => r.email);
    }

    case "event_ticket_type": {
      if (!eventId || !ticketType) return [];
      const rows = await db.query.tickets.findMany({
        where: (t, { and: a, eq: e }) => a(e(t.eventId, eventId), e(t.type, ticketType)),
        columns: { email: true },
      });
      return rows.map((r) => r.email);
    }

    case "event_notify_no_ticket": {
      if (!eventId) return [];
      const [notifyRows, ticketRows] = await Promise.all([
        db.query.notify.findMany({
          where: eq(notify.speakerId, eventId),
          columns: { email: true },
        }),
        db.query.tickets.findMany({
          where: eq(tickets.eventId, eventId),
          columns: { email: true },
        }),
      ]);
      const ticketEmails = new Set(ticketRows.map((r) => r.email.toLowerCase()));
      return notifyRows
        .map((r) => r.email)
        .filter((e) => !ticketEmails.has(e.toLowerCase()));
    }

    case "event_notify": {
      if (!eventId) return [];
      const rows = await db.query.notify.findMany({
        where: eq(notify.speakerId, eventId),
        columns: { email: true },
      });
      return rows.map((r) => r.email);
    }

    case "event_not_checked_in": {
      if (!eventId) return [];
      const rows = await db.query.tickets.findMany({
        where: (t, { and: a, eq: e }) => a(e(t.eventId, eventId), e(t.scanned, false)),
        columns: { email: true },
      });
      return rows.map((r) => r.email);
    }

    case "event_waitlist": {
      if (!eventId) return [];
      const rows = await db.query.waitlist.findMany({
        where: eq(waitlist.eventId, eventId),
        columns: { email: true },
      });
      return rows.map((r) => r.email);
    }

    case "event_past_attendees": {
      if (!eventId) return [];
      const rows = await db.query.tickets.findMany({
        where: (t, { and: a, eq: e }) => a(e(t.eventId, eventId), e(t.scanned, true)),
        columns: { email: true },
      });
      return rows.map((r) => r.email);
    }

    case "all_users": {
      const rows = await db.query.userProfiles.findMany({
        columns: { email: true },
      });
      return rows.map((r) => r.email);
    }

    case "past_attendees": {
      const rows = await db.query.tickets.findMany({
        where: eq(tickets.scanned, true),
        columns: { email: true },
      });
      return rows.map((r) => r.email);
    }

    default:
      return [];
  }
}

function dedupe(emails: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const email of emails) {
    const lower = email.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(lower);
    }
  }
  return result;
}
