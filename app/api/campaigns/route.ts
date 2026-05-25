import { NextResponse } from "next/server";
import {
  requireActionAnyScope,
  requirePermission,
} from "@/app/lib/permissions";
import { db, desc, emailCampaigns } from "@ssb/db";
import { logAuditEvent } from "@/app/lib/audit";
import { hasUnsafeHeaderChars, isValidUUID } from "@/app/lib/validation";
import {
  validateSegments,
  type AudienceSegment,
} from "@/app/lib/campaignAudience";

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

export async function GET() {
  try {
    const auth = await requireActionAnyScope("campaigns.send");
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
        feedbackEventId: c.feedbackEventId,
        eventName: c.event?.name ?? null,
        includeHeroCard: c.includeHeroCard,
        includeFeedbackPrompt: c.includeFeedbackPrompt,
        footerType: c.footerType,
        sentAt: c.sentAt?.toISOString() ?? null,
        sentBy: c.sentBy,
        recipientCount: c.recipientCount,
        failedCount: c.failedCount,
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

    const {
      subject,
      body: emailBody,
      audiences,
      eventId,
      includeHeroCard,
      feedbackEventId,
      includeFeedbackPrompt,
      footerType,
    } = body;

    // A campaign tied to an event needs campaigns.send for that event; an
    // at-large campaign (no event) needs the all-events scope.
    const auth = await requirePermission(
      "campaigns.send",
      eventId && isValidUUID(eventId) ? eventId : null,
    );
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    if (footerType !== undefined && !isValidFooterType(footerType)) {
      return NextResponse.json(
        {
          error: `footerType must be one of: ${VALID_FOOTER_TYPES.join(", ")}`,
        },
        { status: 400 },
      );
    }
    const resolvedFooterType: FooterType =
      isValidFooterType(footerType)
        ? footerType
        : eventId && isValidUUID(eventId)
          ? "event_unsubscribe"
          : "announce_unsubscribe";

    const validatedSubject = validateCampaignSubject(subject);
    if (!validatedSubject) {
      return NextResponse.json(
        {
          error:
            "subject is required, must be 200 characters or less, and cannot contain line breaks",
        },
        { status: 400 },
      );
    }
    if (!validateSegments(audiences)) {
      return NextResponse.json(
        { error: "audiences must be a non-empty array of valid {type, eventIds} segments" },
        { status: 400 },
      );
    }
    if (includeHeroCard !== undefined && typeof includeHeroCard !== "boolean") {
      return NextResponse.json(
        { error: "includeHeroCard must be a boolean when provided" },
        { status: 400 },
      );
    }
    if (
      includeFeedbackPrompt !== undefined
      && typeof includeFeedbackPrompt !== "boolean"
    ) {
      return NextResponse.json(
        { error: "includeFeedbackPrompt must be a boolean when provided" },
        { status: 400 },
      );
    }
    if (
      eventId !== undefined &&
      eventId !== null &&
      typeof eventId !== "string"
    ) {
      return NextResponse.json(
        { error: "eventId must be a string or null when provided" },
        { status: 400 },
      );
    }
    if (
      feedbackEventId !== undefined &&
      feedbackEventId !== null &&
      typeof feedbackEventId !== "string"
    ) {
      return NextResponse.json(
        { error: "feedbackEventId must be a string or null when provided" },
        { status: 400 },
      );
    }
    if (includeHeroCard && (!eventId || !isValidUUID(eventId))) {
      return NextResponse.json(
        { error: "A valid hero card eventId is required when includeHeroCard is enabled" },
        { status: 400 },
      );
    }
    if (
      includeFeedbackPrompt
      && (!feedbackEventId || !isValidUUID(feedbackEventId))
    ) {
      return NextResponse.json(
        {
          error:
            "A valid feedbackEventId is required when includeFeedbackPrompt is enabled",
        },
        { status: 400 },
      );
    }

    const [campaign] = await db
      .insert(emailCampaigns)
      .values({
        subject: validatedSubject,
        body: typeof emailBody === "string" ? emailBody : "",
        audiences: JSON.stringify(audiences),
        eventId: eventId && isValidUUID(eventId) ? eventId : null,
        includeHeroCard: includeHeroCard ?? false,
        feedbackEventId:
          feedbackEventId && isValidUUID(feedbackEventId)
            ? feedbackEventId
            : null,
        includeFeedbackPrompt: includeFeedbackPrompt ?? false,
        footerType: resolvedFooterType,
        createdBy: auth.email!,
      })
      .returning();

    await logAuditEvent({
      action: "campaign.create",
      actor: auth.email!,
      metadata: { campaignId: campaign.id, subject: validatedSubject },
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
