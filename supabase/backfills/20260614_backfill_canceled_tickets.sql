-- One-time backfill: reconstruct canceled tickets from the audit log.
--
-- NOT a migration — do NOT move this into supabase/migrations (it would auto-run
-- on every deploy). Run it by hand, once, AFTER the
-- 20260614000000_track_canceled_tickets migration has created the table.
-- Re-running is safe (deduped on natural key + ON CONFLICT).
--
-- Why this works: both cancel handlers already log the canceled ticket's
-- ORIGINAL purchase time as metadata.gotTicketAt — exactly the x-axis the
-- purchase-timing graph buckets by:
--   * web self-cancel  -> action = 'ticket.cancel'
--   * admin cancel      -> action = 'ticket.delete' AND event_id IS NOT NULL
--                          (the event_id IS NULL branch is an orphan-ticket
--                           hard-delete, not a cancellation — excluded)
--
-- Limits worth knowing before trusting the numbers:
--   * Only reaches as far back as audit-log retention.
--   * Rows logged before gotTicketAt was added have no purchase time and are
--     skipped (counted as `missing_purchase_time` in STEP 1).
--   * name/referral were never logged at cancel time, so backfilled rows leave
--     them null; `type` is recovered from either the admin (`type`) or web
--     (`ticket_type`) metadata key.

-- ── STEP 1 — run this FIRST to see how much is recoverable ───────────────────
SELECT
  count(*) FILTER (WHERE action = 'ticket.cancel')                          AS web_self_cancels,
  count(*) FILTER (WHERE action = 'ticket.delete' AND event_id IS NOT NULL) AS admin_cancels,
  count(*) FILTER (
    WHERE (action = 'ticket.cancel'
           OR (action = 'ticket.delete' AND event_id IS NOT NULL))
      AND (metadata::jsonb ->> 'gotTicketAt') IS NOT NULL
  )                                                                         AS recoverable,
  count(*) FILTER (
    WHERE (action = 'ticket.cancel'
           OR (action = 'ticket.delete' AND event_id IS NOT NULL))
      AND (metadata::jsonb ->> 'gotTicketAt') IS NULL
  )                                                                         AS missing_purchase_time,
  min(created_at) AS earliest_audit_row,
  max(created_at) AS latest_audit_row
FROM audit_logs
WHERE action IN ('ticket.cancel', 'ticket.delete');

-- ── STEP 2 — once the numbers look right, run the insert ─────────────────────
INSERT INTO canceled_tickets (
  original_ticket_id, event_id, email, name, type, referral,
  created_at, canceled_at, source
)
SELECT
  NULLIF(a.metadata::jsonb ->> 'ticketId', '')::uuid,
  a.event_id,
  a.target_email,
  NULL,                                                       -- name not logged at cancel time
  COALESCE(a.metadata::jsonb ->> 'type',
           a.metadata::jsonb ->> 'ticket_type'),              -- admin vs web metadata key
  NULL,                                                       -- referral not logged at cancel time
  (a.metadata::jsonb ->> 'gotTicketAt')::timestamptz,         -- original purchase time
  a.created_at,                                               -- cancel time = audit row time
  'backfill'
FROM audit_logs a
WHERE (
        a.action = 'ticket.cancel'
        OR (a.action = 'ticket.delete' AND a.event_id IS NOT NULL)
      )
  AND a.event_id IS NOT NULL
  AND a.target_email IS NOT NULL
  AND (a.metadata::jsonb ->> 'gotTicketAt') IS NOT NULL
  AND EXISTS (SELECT 1 FROM events e WHERE e.id = a.event_id)
  -- skip anything already present (live rows, or a previous backfill run),
  -- matched on natural key so it holds even when original_ticket_id is null
  AND NOT EXISTS (
    SELECT 1 FROM canceled_tickets c
    WHERE c.event_id = a.event_id
      AND lower(c.email) = lower(a.target_email)
      AND c.created_at = (a.metadata::jsonb ->> 'gotTicketAt')::timestamptz
  )
ON CONFLICT (original_ticket_id) DO NOTHING;

-- ── STEP 3 — sanity-check what landed ────────────────────────────────────────
-- SELECT source, count(*), min(created_at), max(created_at)
-- FROM canceled_tickets GROUP BY source ORDER BY source;
