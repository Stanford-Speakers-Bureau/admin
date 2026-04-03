import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import { db, auditLogs, desc, and, eq, gte, lte, ilike, count as dbCount } from "@ssb/db";

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

export async function GET(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const actor = searchParams.get("actor");
    const source = searchParams.get("source");
    const targetEmail = searchParams.get("targetEmail");
    const eventName = searchParams.get("eventName");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const limit = parsePaginationParam(searchParams.get("limit"), 50, 0, 200);
    const offset = parsePaginationParam(searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);

    const conditions: ReturnType<typeof eq>[] = [];

    if (action) conditions.push(eq(auditLogs.action, action));
    if (actor) conditions.push(ilike(auditLogs.actor, `%${actor}%`));
    if (source) conditions.push(eq(auditLogs.source, source));
    if (targetEmail) conditions.push(ilike(auditLogs.targetEmail, `%${targetEmail}%`));
    if (eventName) conditions.push(ilike(auditLogs.eventName, `%${eventName}%`));
    if (startDate) conditions.push(gte(auditLogs.createdAt, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(auditLogs.createdAt, end));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [logs, [totalResult]] = await Promise.all([
      db.select().from(auditLogs)
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: dbCount() }).from(auditLogs).where(whereClause),
    ]);

    return NextResponse.json({
      logs: logs.map((log) => ({
        id: log.id,
        created_at: log.createdAt.toISOString(),
        action: log.action,
        actor: log.actor,
        source: log.source,
        event_id: log.eventId,
        event_name: log.eventName,
        target_email: log.targetEmail,
        metadata: parseAuditMetadata(log.metadata),
      })),
      total: totalResult?.count ?? 0,
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
