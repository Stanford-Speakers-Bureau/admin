import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import { and, db, eq, emailCampaigns } from "@ssb/db";
import {
  isValidEmail,
  isValidUUID,
  normalizeEmail,
} from "@/app/lib/validation";
import { sendCampaignEmail } from "@/app/lib/email";
import { logAuditEvent } from "@/app/lib/audit";
import { parseAudiences, resolveSegments } from "@/app/lib/campaignAudience";

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

    let body: {
      emails?: string[];
      auditBatchId?: string;
      chunkIndex?: number;
      chunkCount?: number;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { emails: rawEmails, auditBatchId, chunkIndex, chunkCount } = body;

    if (!Array.isArray(rawEmails) || rawEmails.length === 0) {
      return NextResponse.json(
        { error: "emails must be a non-empty array" },
        { status: 400 },
      );
    }

    const normalizedAuditBatchId =
      typeof auditBatchId === "string" && auditBatchId.trim().length > 0
        ? auditBatchId.trim()
        : null;
    if (!normalizedAuditBatchId) {
      return NextResponse.json(
        { error: "auditBatchId is required" },
        { status: 400 },
      );
    }

    if (
      typeof chunkIndex !== "number" ||
      !Number.isInteger(chunkIndex) ||
      chunkIndex < 0 ||
      typeof chunkCount !== "number" ||
      !Number.isInteger(chunkCount) ||
      chunkCount <= 0 ||
      chunkIndex >= chunkCount
    ) {
      return NextResponse.json(
        { error: "chunkIndex and chunkCount must be valid integers" },
        { status: 400 },
      );
    }

    const emails = [...new Set(
      rawEmails
        .filter((email): email is string => typeof email === "string")
        .map((email) => normalizeEmail(email))
        .filter((email) => email.length > 0),
    )];

    if (emails.length === 0) {
      return NextResponse.json(
        { error: "emails must contain at least one valid address" },
        { status: 400 },
      );
    }

    const invalidEmails = emails.filter((email) => !isValidEmail(email));
    if (invalidEmails.length > 0) {
      return NextResponse.json(
        { error: "emails must all be valid email addresses" },
        { status: 400 },
      );
    }

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

    if (campaign.status === "partial") {
      return NextResponse.json(
        { error: "Campaign completed with failures and cannot be resent safely" },
        { status: 400 },
      );
    }

    let activeCampaign = campaign;

    if (campaign.status === "draft") {
      const [claimedCampaign] = await db
        .update(emailCampaigns)
        .set({
          status: "sending",
          sendBatchId: normalizedAuditBatchId,
          sentBy: auth.email!,
          sentAt: null,
          recipientCount: 0,
          failedCount: 0,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(emailCampaigns.id, id),
            eq(emailCampaigns.status, "draft"),
          ),
        )
        .returning();

      if (!claimedCampaign) {
        const latestCampaign = await db.query.emailCampaigns.findFirst({
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

        if (!latestCampaign) {
          return NextResponse.json(
            { error: "Campaign not found" },
            { status: 404 },
          );
        }

        activeCampaign = latestCampaign;
      } else {
        activeCampaign = {
          ...campaign,
          status: claimedCampaign.status,
          sendBatchId: claimedCampaign.sendBatchId,
          sentBy: claimedCampaign.sentBy,
          sentAt: claimedCampaign.sentAt,
          recipientCount: claimedCampaign.recipientCount,
          failedCount: claimedCampaign.failedCount,
        };
      }
    }

    if (activeCampaign.status !== "sending") {
      return NextResponse.json(
        { error: `Cannot send campaign while status is ${activeCampaign.status}` },
        { status: 400 },
      );
    }

    if (activeCampaign.sendBatchId !== normalizedAuditBatchId) {
      return NextResponse.json(
        { error: "Campaign is already being sent from another session" },
        { status: 409 },
      );
    }

    const allowedEmails = await resolveSegments(
      parseAudiences(activeCampaign.audiences),
    );
    const allowedEmailSet = new Set(allowedEmails);
    const unauthorizedEmails = emails.filter((email) => !allowedEmailSet.has(email));
    if (unauthorizedEmails.length > 0) {
      return NextResponse.json(
        { error: "One or more emails are not part of the campaign audience" },
        { status: 400 },
      );
    }

    const results = await Promise.allSettled(
      emails.map((email) =>
        sendCampaignEmail({
          email,
          subject: activeCampaign.subject,
          bodyMarkdown: activeCampaign.body,
          includeHeroCard: activeCampaign.includeHeroCard,
          eventName: activeCampaign.event?.name ?? null,
          eventTagline: activeCampaign.event?.tagline ?? null,
          eventStartTime: activeCampaign.event?.startTimeDate?.toISOString() ?? null,
          doorsOpenTime: activeCampaign.event?.doorsOpen?.toISOString() ?? null,
          eventVenue: activeCampaign.event?.venue ?? null,
          eventVenueLink: activeCampaign.event?.venueLink ?? null,
          eventId: activeCampaign.eventId ?? null,
          imgVersion: activeCampaign.event?.imgVersion ?? null,
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

    const previousSentCount = activeCampaign.recipientCount ?? 0;
    const previousFailedCount = activeCampaign.failedCount ?? 0;
    const nextSentCount = previousSentCount + sent;
    const nextFailedCount = previousFailedCount + failed;
    const isFinalChunk = chunkIndex === chunkCount - 1;

    await db
      .update(emailCampaigns)
      .set({
        recipientCount: nextSentCount,
        failedCount: nextFailedCount,
        status: isFinalChunk
          ? nextFailedCount > 0
            ? "partial"
            : "sent"
          : "sending",
        sentAt: isFinalChunk ? new Date() : activeCampaign.sentAt,
        sendBatchId: isFinalChunk ? null : normalizedAuditBatchId,
        updatedAt: new Date(),
      })
      .where(eq(emailCampaigns.id, id));

    await logAuditEvent({
      action: "campaign.send",
      actor: auth.email!,
      metadata: {
        campaignId: id,
        subject: activeCampaign.subject,
        sent,
        failed,
        batchId: normalizedAuditBatchId,
        chunkIndex,
        chunkCount,
      },
    });

    return NextResponse.json({
      sent,
      failed,
      status: isFinalChunk
        ? nextFailedCount > 0
          ? "partial"
          : "sent"
        : "sending",
      recipientCount: nextSentCount,
      failedCount: nextFailedCount,
    });
  } catch (err) {
    console.error("Campaign send error:", err);
    return NextResponse.json(
      { error: "Failed to send campaign emails" },
      { status: 500 },
    );
  }
}
