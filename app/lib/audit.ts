import { db, auditLogs } from "@ssb/db";

type AuditAction =
  | "ticket.create"
  | "ticket.delete"
  | "ticket.update_name"
  | "ticket.update_type"
  | "ticket.unscan"
  | "email.send"
  | "email.send_mass"
  | "event.create"
  | "event.edit"
  | "event.toggle_live"
  | "event.toggle_standby"
  | "event.delete"
  | "user.add_role"
  | "user.remove_role"
  | "suggestion.approve"
  | "suggestion.reject"
  | "suggestion.edit"
  | "suggestion.mark_duplicate"
  | "suggestion.merge"
  | "waitlist.pull"
  | "waitlist.issue_standby"
  | "referral.toggle";

type AuditLogParams = {
  action: AuditAction;
  actor: string;
  eventId?: string | null;
  eventName?: string | null;
  targetEmail?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logAuditEvent(params: AuditLogParams): Promise<void> {
  try {
    await db.insert(auditLogs)
      .values({
        action: params.action,
        actor: params.actor,
        source: "admin",
        eventId: params.eventId ?? null,
        eventName: params.eventName ?? null,
        targetEmail: params.targetEmail ?? null,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      });
  } catch (err) {
    console.error("[audit] Failed to log event:", err);
  }
}
