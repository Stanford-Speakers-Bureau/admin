import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import {
  and,
  db,
  eq,
  emailCampaigns,
  events,
  inArray,
  sql,
  tickets,
} from "@ssb/db";
import {
  REMINDER_EMAIL_BATCH_SIZE,
  REMINDER_EMAIL_MIN_BATCH_DURATION_MS,
} from "@/app/lib/constants";
import { buildEventFeedbackLink } from "@/app/lib/feedback-links";
import {
  isValidEmail,
  isValidUUID,
  normalizeEmail,
} from "@/app/lib/validation";
import { sendCampaignEmail } from "@/app/lib/email";
import { logAuditEvent } from "@/app/lib/audit";
import { parseAudiences, resolveSegments } from "@/app/lib/campaignAudience";

const MAX_EMAILS_PER_REQUEST = REMINDER_EMAIL_BATCH_SIZE;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  try {
    const batchStartTime = Date.now();
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
          lastProcessedChunkIndex: -1,
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

    const expectedChunkIndex = (activeCampaign.lastProcessedChunkIndex ?? -1) + 1;
    if (chunkIndex !== expectedChunkIndex) {
      return NextResponse.json(
        {
          error:
            chunkIndex <= (activeCampaign.lastProcessedChunkIndex ?? -1)
              ? "This send chunk was already processed"
              : "Send chunks must be processed in order",
        },
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

    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || "https://stanfordspeakersbureau.com";
    const feedbackEvent = activeCampaign.includeFeedbackPrompt
      && activeCampaign.feedbackEventId
      ? await db.query.events.findFirst({
          where: eq(events.id, activeCampaign.feedbackEventId),
          columns: {
            id: true,
            name: true,
            route: true,
            startTimeDate: true,
            endTimeDate: true,
          },
        })
      : null;

    const feedbackTicketRows = feedbackEvent
      ? await db.query.tickets.findMany({
          where: and(
            eq(tickets.eventId, feedbackEvent.id),
            eq(tickets.scanned, true),
            inArray(tickets.email, emails),
          ),
          columns: {
            id: true,
            email: true,
          },
        })
      : [];
    const feedbackTicketByEmail = new Map(
      feedbackTicketRows.map((ticket) => [normalizeEmail(ticket.email), ticket]),
    );

    const results = await Promise.allSettled(
      emails.map(async (email) => {
        const feedbackTicket = feedbackEvent
          ? feedbackTicketByEmail.get(email)
          : null;
        const feedbackPrompt = feedbackEvent && feedbackTicket
          ? {
              eventName: feedbackEvent.name || "this event",
              formUrl: await buildEventFeedbackLink({
                baseUrl,
                eventRoute: feedbackEvent.route || feedbackEvent.id,
                email,
                ticketId: feedbackTicket.id,
                eventId: feedbackEvent.id,
                eventStartTime:
                  feedbackEvent.startTimeDate?.toISOString() ?? null,
                eventEndTime: feedbackEvent.endTimeDate?.toISOString() ?? null,
              }),
              scoreLinks: await Promise.all(
                Array.from({ length: 10 }, (_, index) =>
                  buildEventFeedbackLink({
                    baseUrl,
                    eventRoute: feedbackEvent.route || feedbackEvent.id,
                    email,
                    ticketId: feedbackTicket.id,
                    eventId: feedbackEvent.id,
                    score: index + 1,
                    eventStartTime:
                      feedbackEvent.startTimeDate?.toISOString() ?? null,
                    eventEndTime:
                      feedbackEvent.endTimeDate?.toISOString() ?? null,
                  }).then((url) => ({ score: index + 1, url })),
                ),
              ),
            }
          : null;

        return sendCampaignEmail({
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
          feedbackPrompt,
        });
      }),
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

    const isFinalChunk = chunkIndex === chunkCount - 1;

    const [updatedCampaign] = await db
      .update(emailCampaigns)
      .set({
        recipientCount: sql`coalesce(${emailCampaigns.recipientCount}, 0) + ${sent}`,
        failedCount: sql`coalesce(${emailCampaigns.failedCount}, 0) + ${failed}`,
        lastProcessedChunkIndex: chunkIndex,
        status: isFinalChunk
          ? sql`case when coalesce(${emailCampaigns.failedCount}, 0) + ${failed} > 0 then 'partial' else 'sent' end`
          : "sending",
        sentAt: isFinalChunk ? new Date() : sql`${emailCampaigns.sentAt}`,
        sendBatchId: isFinalChunk ? null : normalizedAuditBatchId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(emailCampaigns.id, id),
          eq(emailCampaigns.sendBatchId, normalizedAuditBatchId),
          eq(emailCampaigns.lastProcessedChunkIndex, chunkIndex - 1),
        ),
      )
      .returning({
        status: emailCampaigns.status,
        recipientCount: emailCampaigns.recipientCount,
        failedCount: emailCampaigns.failedCount,
        lastProcessedChunkIndex: emailCampaigns.lastProcessedChunkIndex,
      });

    if (!updatedCampaign) {
      return NextResponse.json(
        { error: "Campaign send state changed while processing this batch" },
        { status: 409 },
      );
    }

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

    const batchDuration = Date.now() - batchStartTime;
    if (
      batchDuration < REMINDER_EMAIL_MIN_BATCH_DURATION_MS &&
      !isFinalChunk
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, REMINDER_EMAIL_MIN_BATCH_DURATION_MS - batchDuration),
      );
    }

    return NextResponse.json({
      sent,
      failed,
      status: updatedCampaign.status,
      recipientCount: updatedCampaign.recipientCount,
      failedCount: updatedCampaign.failedCount,
    });
  } catch (err) {
    console.error("Campaign send error:", err);
    return NextResponse.json(
      { error: "Failed to send campaign emails" },
      { status: 500 },
    );
  }
}
