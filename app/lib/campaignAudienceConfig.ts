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

export const TICKET_TYPES = [
  "STANDARD",
  "VIP",
  "EXTERNAL",
  "STANDBY",
] as const;

export type AudienceOption = {
  value: AudienceType;
  label: string;
  needsEvent: boolean;
  needsTicketType?: boolean;
};

export const AUDIENCE_OPTIONS: AudienceOption[] = [
  {
    value: "event_ticketholders",
    label: AUDIENCE_TYPE_LABELS.event_ticketholders,
    needsEvent: true,
  },
  {
    value: "event_ticket_type",
    label: AUDIENCE_TYPE_LABELS.event_ticket_type,
    needsEvent: true,
    needsTicketType: true,
  },
  {
    value: "event_notify_no_ticket",
    label: AUDIENCE_TYPE_LABELS.event_notify_no_ticket,
    needsEvent: true,
  },
  {
    value: "event_notify",
    label: AUDIENCE_TYPE_LABELS.event_notify,
    needsEvent: true,
  },
  {
    value: "event_not_checked_in",
    label: AUDIENCE_TYPE_LABELS.event_not_checked_in,
    needsEvent: true,
  },
  {
    value: "event_waitlist",
    label: AUDIENCE_TYPE_LABELS.event_waitlist,
    needsEvent: true,
  },
  {
    value: "event_past_attendees",
    label: AUDIENCE_TYPE_LABELS.event_past_attendees,
    needsEvent: true,
  },
  {
    value: "all_users",
    label: AUDIENCE_TYPE_LABELS.all_users,
    needsEvent: false,
  },
  {
    value: "past_attendees",
    label: AUDIENCE_TYPE_LABELS.past_attendees,
    needsEvent: false,
  },
];

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
  return Object.prototype.hasOwnProperty.call(AUDIENCE_TYPE_LABELS, value);
}
