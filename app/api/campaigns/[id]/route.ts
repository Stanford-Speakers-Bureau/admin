import { NextResponse } from "next/server";
import { requirePermission } from "@/app/lib/permissions";
import { db, eq, emailCampaigns, events } from "@ssb/db";
import {
  hasUnsafeHeaderChars,
  isValidUUID,
} from "@/app/lib/validation";
import {
  validateSegments,
  parseAudiences,
  resolveSegments,
  type AudienceSegment,
} from "@/app/lib/campaignAudience";

type Params = { params: Promise<{ id: string }> };

function validateCampaignSubject(subject: unknown): string | null {
  if (typeof subject !== "string") return null;
  const trimmedSubject = subject.trim();
  if (!trimmedSubject) return null;
  if (trimmedSubject.length > 200) return null;
  if (hasUnsafeHeaderChars(trimmedSubject)) return null;
  return trimmedSubject;
}

const VALID_FOOTER_TYPES = [
  "event_unsubscribe",
  "announce_unsubscribe",
  "newsletter_unsubscribe",
  "essential",
  "none",
] as const;
type FooterType = (typeof VALID_FOOTER_TYPES)[number];

function isValidFooterType(value: unknown): value is FooterType {
  return typeof value === "string"
    && (VALID_FOOTER_TYPES as readonly string[]).includes(value);
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const campaign = await db.query.emailCampaigns.findFirst({
      where: eq(emailCampaigns.id, id),
      with: { event: { columns: { name: true, route: true, startTimeDate: true, tagline: true, imgVersion: true, venue: true, venueLink: true, doorsOpen: true } } },
    });

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const auth = await requirePermission("campaigns.send", campaign.eventId);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const feedbackEvent = campaign?.feedbackEventId
      ? await db.query.events.findFirst({
          where: eq(events.id, campaign.feedbackEventId),
          columns: {
            id: true,
            name: true,
            route: true,
            startTimeDate: true,
            endTimeDate: true,
          },
        })
      : null;

    let audienceCount = 0;
    let audienceEmails: string[] | undefined;
    const includeAudience = new URL(_req.url).searchParams.get("includeAudience") === "true";

    if (includeAudience) {
      const entries = parseAudiences(campaign.audiences);
      try {
        audienceEmails = await resolveSegments(entries);
        audienceCount = audienceEmails.length;
      } catch {
        // non-fatal
      }
    }

    return NextResponse.json({
      campaign: {
        id: campaign.id,
        subject: campaign.subject,
        body: campaign.body,
        status: campaign.status,
        audiences: campaign.audiences,
        eventId: campaign.eventId,
        feedbackEventId: campaign.feedbackEventId,
        eventName: campaign.event?.name ?? null,
        eventRoute: campaign.event?.route ?? null,
        eventStartTime: campaign.event?.startTimeDate?.toISOString() ?? null,
        eventTagline: campaign.event?.tagline ?? null,
        eventImgVersion: campaign.event?.imgVersion ?? null,
        eventVenue: campaign.event?.venue ?? null,
        eventVenueLink: campaign.event?.venueLink ?? null,
        eventDoorsOpen: campaign.event?.doorsOpen?.toISOString() ?? null,
        includeHeroCard: campaign.includeHeroCard,
        includeFeedbackPrompt: campaign.includeFeedbackPrompt,
        footerType: campaign.footerType,
        feedbackEventName: feedbackEvent?.name ?? null,
        feedbackEventRoute: feedbackEvent?.route ?? null,
        feedbackEventStartTime: feedbackEvent?.startTimeDate?.toISOString() ?? null,
        feedbackEventEndTime: feedbackEvent?.endTimeDate?.toISOString() ?? null,
        sentAt: campaign.sentAt?.toISOString() ?? null,
        sentBy: campaign.sentBy,
        recipientCount: campaign.recipientCount,
        failedCount: campaign.failedCount,
        createdBy: campaign.createdBy,
        createdAt: campaign.createdAt.toISOString(),
        updatedAt: campaign.updatedAt.toISOString(),
      },
      ...(includeAudience ? { audienceCount, audienceEmails: audienceEmails ?? [] } : {}),
    });
  } catch (err) {
    console.error("Campaign get error:", err);
    return NextResponse.json(
      { error: "Failed to fetch campaign" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const campaign = await db.query.emailCampaigns.findFirst({
      where: eq(emailCampaigns.id, id),
      columns: {
        id: true,
        status: true,
        eventId: true,
        includeHeroCard: true,
        feedbackEventId: true,
        includeFeedbackPrompt: true,
      },
    });

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const auth = await requirePermission("campaigns.send", campaign.eventId);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    let body: {
      subject?: string;
      body?: string;
      audiences?: AudienceSegment[];
      eventId?: string | null;
      includeHeroCard?: boolean;
      feedbackEventId?: string | null;
      includeFeedbackPrompt?: boolean;
      footerType?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (campaign.status !== "draft") {
      return NextResponse.json(
        { error: "Can only edit draft campaigns" },
        { status: 400 },
      );
    }

    const unexpectedFields = [
      "status",
      "sentAt",
      "sentBy",
      "recipientCount",
      "failedCount",
      "sendBatchId",
    ].filter((field) =>
      Object.prototype.hasOwnProperty.call(
        body as Record<string, unknown>,
        field,
      )
    );

    if (unexpectedFields.length > 0) {
      return NextResponse.json(
        { error: `Cannot update server-managed fields: ${unexpectedFields.join(", ")}` },
        { status: 400 },
      );
    }

    if (body.audiences !== undefined && !validateSegments(body.audiences)) {
      return NextResponse.json(
        { error: "audiences must be a non-empty array of valid {type, eventIds} segments" },
        { status: 400 },
      );
    }

    if (body.subject !== undefined && !validateCampaignSubject(body.subject)) {
      return NextResponse.json(
        {
          error:
            "subject must be non-empty, 200 characters or less, and cannot contain line breaks",
        },
        { status: 400 },
      );
    }

    if (body.body !== undefined && typeof body.body !== "string") {
      return NextResponse.json(
        { error: "body must be a string when provided" },
        { status: 400 },
      );
    }

    if (
      body.includeHeroCard !== undefined &&
      typeof body.includeHeroCard !== "boolean"
    ) {
      return NextResponse.json(
        { error: "includeHeroCard must be a boolean when provided" },
        { status: 400 },
      );
    }
    if (
      body.includeFeedbackPrompt !== undefined &&
      typeof body.includeFeedbackPrompt !== "boolean"
    ) {
      return NextResponse.json(
        { error: "includeFeedbackPrompt must be a boolean when provided" },
        { status: 400 },
      );
    }

    if (
      body.eventId !== undefined &&
      body.eventId !== null &&
      typeof body.eventId !== "string"
    ) {
      return NextResponse.json(
        { error: "eventId must be a string or null when provided" },
        { status: 400 },
      );
    }
    if (
      body.feedbackEventId !== undefined &&
      body.feedbackEventId !== null &&
      typeof body.feedbackEventId !== "string"
    ) {
      return NextResponse.json(
        { error: "feedbackEventId must be a string or null when provided" },
        { status: 400 },
      );
    }
    const effectiveHeroEventId =
      body.eventId !== undefined ? body.eventId : campaign.eventId;
    const effectiveIncludeHeroCard =
      body.includeHeroCard !== undefined
        ? body.includeHeroCard
        : campaign.includeHeroCard;
    const effectiveFeedbackEventId =
      body.feedbackEventId !== undefined
        ? body.feedbackEventId
        : campaign.feedbackEventId;
    const effectiveIncludeFeedbackPrompt =
      body.includeFeedbackPrompt !== undefined
        ? body.includeFeedbackPrompt
        : campaign.includeFeedbackPrompt;

    if (
      effectiveIncludeHeroCard &&
      (!effectiveHeroEventId || !isValidUUID(effectiveHeroEventId))
    ) {
      return NextResponse.json(
        { error: "A valid hero card eventId is required when includeHeroCard is enabled" },
        { status: 400 },
      );
    }
    if (
      effectiveIncludeFeedbackPrompt &&
      (!effectiveFeedbackEventId || !isValidUUID(effectiveFeedbackEventId))
    ) {
      return NextResponse.json(
        {
          error:
            "A valid feedbackEventId is required when includeFeedbackPrompt is enabled",
        },
        { status: 400 },
      );
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.subject !== undefined) {
      updates.subject = validateCampaignSubject(body.subject)!;
    }
    if (body.body !== undefined) updates.body = body.body;
    if (body.audiences !== undefined) updates.audiences = JSON.stringify(body.audiences);
    if (body.eventId !== undefined)
      updates.eventId = body.eventId && isValidUUID(body.eventId) ? body.eventId : null;
    if (body.includeHeroCard !== undefined) updates.includeHeroCard = body.includeHeroCard;
    if (body.feedbackEventId !== undefined) {
      updates.feedbackEventId =
        body.feedbackEventId && isValidUUID(body.feedbackEventId)
          ? body.feedbackEventId
          : null;
    }
    if (body.includeFeedbackPrompt !== undefined) {
      updates.includeFeedbackPrompt = body.includeFeedbackPrompt;
    }
    if (body.footerType !== undefined) {
      if (!isValidFooterType(body.footerType)) {
        return NextResponse.json(
          {
            error: `footerType must be one of: ${VALID_FOOTER_TYPES.join(", ")}`,
          },
          { status: 400 },
        );
      }
      updates.footerType = body.footerType;
    }

    const [updated] = await db
      .update(emailCampaigns)
      .set(updates)
      .where(eq(emailCampaigns.id, id))
      .returning();

    return NextResponse.json({ campaign: updated });
  } catch (err) {
    console.error("Campaign update error:", err);
    return NextResponse.json(
      { error: "Failed to update campaign" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const campaign = await db.query.emailCampaigns.findFirst({
      where: eq(emailCampaigns.id, id),
      columns: { id: true, status: true, eventId: true },
    });

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const auth = await requirePermission("campaigns.send", campaign.eventId);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }
    if (campaign.status !== "draft") {
      return NextResponse.json(
        { error: "Can only delete draft campaigns" },
        { status: 400 },
      );
    }

    await db.delete(emailCampaigns).where(eq(emailCampaigns.id, id));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Campaign delete error:", err);
    return NextResponse.json(
      { error: "Failed to delete campaign" },
      { status: 500 },
    );
  }
}
