import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import {
  db,
  auditLogs,
  desc,
  and,
  eq,
  gte,
  lte,
  ilike,
  inArray,
} from "@ssb/db";

type AuditLogEntry = {
  kind: "log";
  id: string;
  created_at: string;
  action: string;
  actor: string;
  source: string;
  event_id: string | null;
  event_name: string | null;
  target_email: string | null;
  metadata: Record<string, unknown> | null;
};

type AuditLogGroup = {
  kind: "group";
  id: string;
  created_at: string;
  action: string;
  actor: string;
  source: string;
  event_id: string | null;
  event_name: string | null;
  target_email: null;
  metadata: Record<string, unknown> | null;
  entries: AuditLogEntry[];
  group_count: number;
  failures: AuditLogEntry[];
};

type AuditLogItem = AuditLogEntry | AuditLogGroup;
type AuditLogRow = {
  id: string;
  createdAt: Date;
  action: string;
  actor: string;
  source: string;
  eventId: string | null;
  eventName: string | null;
  targetEmail: string | null;
  metadata: string | null;
};

function parsePaginationParam(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function parseAuditMetadata(metadata: string | null): Record<string, unknown> | null {
  if (!metadata) {
    return null;
  }

  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }

    return { value: parsed };
  } catch (error) {
    console.error("[audit] Failed to parse metadata:", error);
    return { raw: metadata };
  }
}

function toAuditLogEntry(log: AuditLogRow): AuditLogEntry {
  return {
    kind: "log",
    id: log.id,
    created_at: log.createdAt.toISOString(),
    action: log.action,
    actor: log.actor,
    source: log.source,
    event_id: log.eventId,
    event_name: log.eventName,
    target_email: log.targetEmail,
    metadata: parseAuditMetadata(log.metadata),
  };
}

function getMassEmailBatchId(
  action: string,
  metadata: Record<string, unknown> | null,
): string | null {
  if (action !== "email.send_mass") {
    return null;
  }

  const batchId = metadata?.batchId;
  return typeof batchId === "string" && batchId.trim().length > 0
    ? batchId.trim()
    : null;
}

function getFailureBatchId(
  action: string,
  metadata: Record<string, unknown> | null,
): string | null {
  if (action !== "email.send_failed") {
    return null;
  }
  const batchId = metadata?.batchId;
  return typeof batchId === "string" && batchId.trim().length > 0
    ? batchId.trim()
    : null;
}

function getMetadataNumber(
  metadata: Record<string, unknown> | null,
  key: string,
): number {
  const value = metadata?.[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function summarizeMassEmailMetadata(
  batchId: string,
  entries: AuditLogEntry[],
): Record<string, unknown> | null {
  const primaryMetadata = entries.find((entry) => entry.metadata)?.metadata ?? null;
  if (!primaryMetadata) {
    return {
      batchId,
      chunkCount: entries.length,
    };
  }

  const sent = entries.reduce(
    (sum, entry) => sum + getMetadataNumber(entry.metadata, "sent"),
    0,
  );
  const failed = entries.reduce(
    (sum, entry) => sum + getMetadataNumber(entry.metadata, "failed"),
    0,
  );
  const skipped = entries.reduce(
    (sum, entry) => sum + getMetadataNumber(entry.metadata, "skipped"),
    0,
  );
  const skippedHasTicket = entries.reduce(
    (sum, entry) => sum + getMetadataNumber(entry.metadata, "skippedHasTicket"),
    0,
  );
  const skippedOptedOut = entries.reduce(
    (sum, entry) => sum + getMetadataNumber(entry.metadata, "skippedOptedOut"),
    0,
  );
  const suppressed = entries.reduce(
    (sum, entry) => sum + getMetadataNumber(entry.metadata, "suppressed"),
    0,
  );
  const explicitTotal = entries.reduce(
    (sum, entry) => sum + getMetadataNumber(entry.metadata, "total"),
    0,
  );

  return {
    ...primaryMetadata,
    batchId,
    sent,
    failed,
    skipped,
    skippedHasTicket,
    skippedOptedOut,
    suppressed,
    total: explicitTotal > 0 ? explicitTotal : sent + failed + skipped + suppressed,
    chunkCount: entries.length,
  };
}

function buildMassEmailGroup(
  batchId: string,
  entries: AuditLogEntry[],
  failures: AuditLogEntry[],
): AuditLogItem {
  if (entries.length === 1 && failures.length === 0) {
    return entries[0];
  }

  const firstEntry = entries[0];

  return {
    kind: "group",
    id: `mass-email:${batchId}`,
    created_at: firstEntry.created_at,
    action: firstEntry.action,
    actor: firstEntry.actor,
    source: firstEntry.source,
    event_id: firstEntry.event_id,
    event_name: firstEntry.event_name,
    target_email: null,
    metadata: summarizeMassEmailMetadata(batchId, entries),
    entries,
    group_count: entries.length,
    failures,
  };
}

function groupAuditLogs(logs: AuditLogRow[]): AuditLogItem[] {
  const groupedEntries = new Map<string, AuditLogEntry[]>();
  const failuresByBatch = new Map<string, AuditLogEntry[]>();
  const orderedItems: Array<
    | { kind: "log"; entry: AuditLogEntry }
    | { kind: "batch"; batchId: string }
  > = [];

  // First pass: collect failures by batchId so we can attach them to their
  // mass-email parent rather than render them as individual rows.
  const allEntries: AuditLogEntry[] = [];
  for (const log of logs) {
    const entry = toAuditLogEntry(log);
    allEntries.push(entry);
    const failureBatchId = getFailureBatchId(entry.action, entry.metadata);
    if (failureBatchId) {
      const existing = failuresByBatch.get(failureBatchId);
      if (existing) {
        existing.push(entry);
      } else {
        failuresByBatch.set(failureBatchId, [entry]);
      }
    }
  }

  for (const entry of allEntries) {
    const massBatchId = getMassEmailBatchId(entry.action, entry.metadata);
    if (massBatchId) {
      const existingEntries = groupedEntries.get(massBatchId);
      if (existingEntries) {
        existingEntries.push(entry);
        continue;
      }
      groupedEntries.set(massBatchId, [entry]);
      orderedItems.push({ kind: "batch", batchId: massBatchId });
      continue;
    }

    // Skip per-recipient send_failed rows that belong to a mass-email batch
    // visible on this page — they're folded into the group's expanded view.
    const failureBatchId = getFailureBatchId(entry.action, entry.metadata);
    if (failureBatchId && failuresByBatch.has(failureBatchId)) {
      continue;
    }

    orderedItems.push({ kind: "log", entry });
  }

  return orderedItems.map((item) =>
    item.kind === "log"
      ? item.entry
      : buildMassEmailGroup(
        item.batchId,
        groupedEntries.get(item.batchId) ?? [],
        failuresByBatch.get(item.batchId) ?? [],
      )
  );
}

export async function GET(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const actions = [...new Set(searchParams.getAll("action").filter(Boolean))];
    const actor = searchParams.get("actor");
    const sources = [...new Set(searchParams.getAll("source").filter(Boolean))];
    const targetEmail = searchParams.get("targetEmail");
    const eventName = searchParams.get("eventName");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const limit = parsePaginationParam(searchParams.get("limit"), 50, 0, 200);
    const offset = parsePaginationParam(searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);

    const conditions: ReturnType<typeof eq>[] = [];

    // When the filter includes mass emails, always also include the
    // per-recipient failure rows so they can be folded into the group view.
    const effectiveActions = actions.length > 0 && actions.includes("email.send_mass")
      ? Array.from(new Set([...actions, "email.send_failed"]))
      : actions;

    if (effectiveActions.length === 1) {
      conditions.push(eq(auditLogs.action, effectiveActions[0]));
    } else if (effectiveActions.length > 1) {
      conditions.push(inArray(auditLogs.action, effectiveActions));
    }
    if (actor) conditions.push(ilike(auditLogs.actor, `%${actor}%`));
    if (sources.length === 1) {
      conditions.push(eq(auditLogs.source, sources[0]));
    } else if (sources.length > 1) {
      conditions.push(inArray(auditLogs.source, sources));
    }
    if (targetEmail) conditions.push(ilike(auditLogs.targetEmail, `%${targetEmail}%`));
    if (eventName) conditions.push(ilike(auditLogs.eventName, `%${eventName}%`));
    if (startDate) conditions.push(gte(auditLogs.createdAt, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(auditLogs.createdAt, end));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const logs = await db.select().from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt));
    const groupedLogs = groupAuditLogs(logs);
    const paginatedLogs = groupedLogs.slice(offset, offset + limit);

    return NextResponse.json({
      logs: paginatedLogs,
      total: groupedLogs.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Audit log fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
