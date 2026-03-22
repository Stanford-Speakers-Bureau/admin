import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/supabase";
import { isValidUUID } from "@/app/lib/validation";
import { db, eq, events, tickets, waitlist, count } from "@ssb/db";

export async function GET(
  req: Request,
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

    const [event, ticketResults, waitlistResult] = await Promise.all([
      db.query.events.findFirst({
        where: eq(events.id, eventId),
        columns: {
          capacity: true,
          live: true,
          doorsOpen: true,
          startTimeDate: true,
          standbyEnabled: true,
          name: true,
        },
      }),
      db.query.tickets.findMany({
        where: eq(tickets.eventId, eventId),
        columns: {
          scanned: true,
          scanTime: true,
          type: true,
          name: true,
          createdAt: true,
          scanUser: true,
          scanEmail: true,
        },
      }),
      db
        .select({ value: count() })
        .from(waitlist)
        .where(eq(waitlist.eventId, eventId)),
    ]);

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const totalTickets = ticketResults.length;
    const scannedTickets = ticketResults.filter((t) => t.scanned);
    const scannedCount = scannedTickets.length;

    const scanEvents = scannedTickets
      .filter((t) => t.scanTime)
      .map((t) => ({
        name: t.name,
        type: t.type,
        scanTime: t.scanTime!.toISOString(),
        scannedBy: t.scanUser || null,
        scannerKey: t.scanEmail || t.scanUser || "unknown",
      }))
      .sort((a, b) => a.scanTime.localeCompare(b.scanTime));

    const scanTimestamps = scanEvents.map((scan) => scan.scanTime);

    type TypeKey = "STANDARD" | "VIP" | "EXTERNAL" | "STANDBY";
    const byType: Record<TypeKey, { total: number; scanned: number }> = {
      STANDARD: { total: 0, scanned: 0 },
      VIP: { total: 0, scanned: 0 },
      EXTERNAL: { total: 0, scanned: 0 },
      STANDBY: { total: 0, scanned: 0 },
    };

    for (const t of ticketResults) {
      const key = (t.type?.toUpperCase() ?? "STANDARD") as TypeKey;
      const bucket = byType[key] ?? byType.STANDARD;
      bucket.total++;
      if (t.scanned) bucket.scanned++;
    }

    // Scanner leaderboard
    const scannerCounts = new Map<string, { name: string; email: string; count: number }>();
    for (const t of scannedTickets) {
      const scannerName = t.scanUser || "Unknown";
      const scannerEmail = t.scanEmail || "";
      const key = scannerEmail || scannerName;
      const entry = scannerCounts.get(key);
      if (entry) {
        entry.count++;
      } else {
        scannerCounts.set(key, { name: scannerName, email: scannerEmail, count: 1 });
      }
    }
    const scannerLeaderboard = [...scannerCounts.values()].sort((a, b) => b.count - a.count);

    // Peak scans per minute
    let peakScansPerMin = 0;
    if (scanTimestamps.length > 0) {
      const minuteBuckets = new Map<number, number>();
      for (const ts of scanTimestamps) {
        const ms = new Date(ts).getTime();
        const key = Math.floor(ms / 60_000) * 60_000;
        minuteBuckets.set(key, (minuteBuckets.get(key) ?? 0) + 1);
      }
      for (const v of minuteBuckets.values()) {
        if (v > peakScansPerMin) peakScansPerMin = v;
      }
    }

    // Standby ticket creation timestamps for standby line growth chart
    const standbyTimestamps = ticketResults
      .filter((t) => (t.type?.toUpperCase() ?? "STANDARD") === "STANDBY")
      .map((t) => t.createdAt.toISOString())
      .sort();

    return NextResponse.json({
      scanEvents,
      scanTimestamps,
      totalTickets,
      scannedCount,
      isLive: event.live ?? false,
      capacity: event.capacity ?? 0,
      doorsOpen: event.doorsOpen?.toISOString() ?? null,
      startTime: event.startTimeDate?.toISOString() ?? null,
      standbyEnabled: event.standbyEnabled ?? false,
      waitlistCount: waitlistResult[0]?.value ?? 0,
      byType,
      standbyTimestamps,
      scannerLeaderboard,
      peakScansPerMin,
    });
  } catch (error) {
    console.error("Check-in data fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
