import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import { db, eq, emailCampaigns, events } from "@ssb/db";
import { isValidUUID } from "@/app/lib/validation";
import { sendCampaignEmail } from "@/app/lib/email";
import { logAuditEvent } from "@/app/lib/audit";

const MAX_EMAILS_PER_REQUEST = 50;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const { id } = await params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    let body: { emails?: string[]; auditBatchId?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { emails: rawEmails, auditBatchId } = body;

    if (!Array.isArray(rawEmails) || rawEmails.length === 0) {
      return NextResponse.json(
        { error: "emails must be a non-empty array" },
        { status: 400 },
      );
    }

    const emails = [
      ...new Set(
        rawEmails
          .filter((e): e is string => typeof e === "string")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];

    if (emails.length > MAX_EMAILS_PER_REQUEST) {
      return NextResponse.json(
        { error: `Maximum ${MAX_EMAILS_PER_REQUEST} emails per request` },
        { status: 400 },
      );
    }

    const campaign = await db.query.emailCampaigns.findFirst({
      where: eq(emailCampaigns.id, id),
      with: {
        event: {
          columns: {
            name: true,
            route: true,
            startTimeDate: true,
            tagline: true,
            imgVersion: true,
            venue: true,
            venueLink: true,
            doorsOpen: true,
          },
        },
      },
    });

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    if (campaign.status === "sent") {
      return NextResponse.json(
        { error: "Campaign has already been sent" },
        { status: 400 },
      );
    }

    // Move to sending state if still draft
    if (campaign.status === "draft") {
      await db
        .update(emailCampaigns)
        .set({ status: "sending", updatedAt: new Date() })
        .where(eq(emailCampaigns.id, id));
    }

    const results = await Promise.allSettled(
      emails.map((email) =>
        sendCampaignEmail({
          email,
          subject: campaign.subject,
          bodyMarkdown: campaign.body,
          includeHeroCard: campaign.includeHeroCard,
          eventName: campaign.event?.name ?? null,
          eventTagline: campaign.event?.tagline ?? null,
          eventStartTime: campaign.event?.startTimeDate?.toISOString() ?? null,
          doorsOpenTime: campaign.event?.doorsOpen?.toISOString() ?? null,
          eventVenue: campaign.event?.venue ?? null,
          eventVenueLink: campaign.event?.venueLink ?? null,
          eventId: campaign.eventId ?? null,
          imgVersion: campaign.event?.imgVersion ?? null,
        }),
      ),
    );

    let sent = 0;
    let failed = 0;
    for (const result of results) {
      if (result.status === "fulfilled") {
        sent++;
      } else {
        failed++;
        console.error("Campaign email send failed:", result.reason);
      }
    }

    await logAuditEvent({
      action: "campaign.send",
      actor: auth.email!,
      metadata: {
        campaignId: id,
        subject: campaign.subject,
        sent,
        failed,
        ...(auditBatchId ? { batchId: auditBatchId } : {}),
      },
    });

    return NextResponse.json({ sent, failed });
  } catch (err) {
    console.error("Campaign send error:", err);
    return NextResponse.json(
      { error: "Failed to send campaign emails" },
      { status: 500 },
    );
  }
}
