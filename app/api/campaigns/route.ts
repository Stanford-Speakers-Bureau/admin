import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import { db, desc, emailCampaigns } from "@ssb/db";
import { logAuditEvent } from "@/app/lib/audit";
import { isValidUUID } from "@/app/lib/validation";
import {
  validateSegments,
  type AudienceSegment,
} from "@/app/lib/campaignAudience";

export async function GET() {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const campaigns = await db.query.emailCampaigns.findMany({
      orderBy: desc(emailCampaigns.createdAt),
      with: {
        event: { columns: { name: true } },
      },
    });

    return NextResponse.json({
      campaigns: campaigns.map((c) => ({
        id: c.id,
        subject: c.subject,
        status: c.status,
        audiences: c.audiences,
        eventId: c.eventId,
        eventName: c.event?.name ?? null,
        includeHeroCard: c.includeHeroCard,
        sentAt: c.sentAt?.toISOString() ?? null,
        sentBy: c.sentBy,
        recipientCount: c.recipientCount,
        createdBy: c.createdBy,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("Campaign list error:", err);
    return NextResponse.json(
      { error: "Failed to fetch campaigns" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    let body: {
      subject?: string;
      body?: string;
      audiences?: AudienceSegment[];
      eventId?: string | null;
      includeHeroCard?: boolean;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { subject, body: emailBody, audiences, eventId, includeHeroCard } = body;

    if (!subject || typeof subject !== "string" || !subject.trim()) {
      return NextResponse.json(
        { error: "subject is required" },
        { status: 400 },
      );
    }
    if (subject.length > 200) {
      return NextResponse.json(
        { error: "subject must be 200 characters or less" },
        { status: 400 },
      );
    }
    if (!validateSegments(audiences)) {
      return NextResponse.json(
        { error: "audiences must be a non-empty array of valid {type, eventIds} segments" },
        { status: 400 },
      );
    }

    const [campaign] = await db
      .insert(emailCampaigns)
      .values({
        subject: subject.trim(),
        body: typeof emailBody === "string" ? emailBody : "",
        audiences: JSON.stringify(audiences),
        eventId: eventId && isValidUUID(eventId) ? eventId : null,
        includeHeroCard: includeHeroCard ?? false,
        createdBy: auth.email!,
      })
      .returning();

    await logAuditEvent({
      action: "campaign.create",
      actor: auth.email!,
      metadata: { campaignId: campaign.id, subject: subject.trim() },
    });

    return NextResponse.json({ campaign }, { status: 201 });
  } catch (err) {
    console.error("Campaign create error:", err);
    return NextResponse.json(
      { error: "Failed to create campaign" },
      { status: 500 },
    );
  }
}
