import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import { db, eq, and, tickets } from "@ssb/db";

export async function GET(req: Request) {
  const auth = await verifyAdminRequest();
  if (!auth.authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email")?.trim().toLowerCase();
  const eventId = searchParams.get("eventId");

  if (!email || !eventId) {
    return NextResponse.json(
      { error: "email and eventId are required" },
      { status: 400 },
    );
  }

  const existing = await db.query.tickets.findFirst({
    where: and(eq(tickets.eventId, eventId), eq(tickets.email, email)),
    columns: { id: true, type: true, name: true },
  });

  return NextResponse.json({ ticket: existing ?? null });
}
