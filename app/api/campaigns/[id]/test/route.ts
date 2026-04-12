import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import { and, db, eq, emailCampaigns, events, tickets } from "@ssb/db";
import { buildEventFeedbackLink } from "@/app/lib/feedback-links";
import { isValidUUID } from "@/app/lib/validation";
import { sendCampaignEmail } from "@/app/lib/email";

type Params = { params: Promise<{ id: string }> };

function buildPreviewFeedbackPrompt(baseUrl: string, eventRoute: string, eventName: string | null) {
  const formUrl = new URL(`/events/${eventRoute}`, baseUrl);
  formUrl.hash = "feedback";

  const scoreLinks = Array.from({ length: 10 }, (_, index) => {
    const score = index + 1;
    const url = new URL(formUrl.toString());
    url.searchParams.set("feedback_score", String(score));
    return { score, url: url.toString() };
  });

  return {
    eventName: eventName || "this event",
    formUrl: formUrl.toString(),
    scoreLinks,
  };
}

export async function POST(_req: Request, { params }: Params) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const { id } = await params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
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

    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || "https://stanfordspeakersbureau.com";
    const feedbackEvent = campaign.feedbackEventId
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
    const feedbackTicket = feedbackEvent
      ? await db.query.tickets.findFirst({
          where: and(
            eq(tickets.eventId, feedbackEvent.id),
            eq(tickets.email, auth.email!),
            eq(tickets.scanned, true),
          ),
          columns: {
            id: true,
          },
        })
      : null;

    const feedbackPrompt = campaign.includeFeedbackPrompt && feedbackEvent
      ? feedbackTicket
        ? {
            eventName: feedbackEvent.name || "this event",
            formUrl: await buildEventFeedbackLink({
              baseUrl,
              eventRoute: feedbackEvent.route || feedbackEvent.id,
              email: auth.email!,
              ticketId: feedbackTicket.id,
              eventId: feedbackEvent.id,
              eventStartTime: feedbackEvent.startTimeDate?.toISOString() ?? null,
              eventEndTime: feedbackEvent.endTimeDate?.toISOString() ?? null,
            }),
            scoreLinks: await Promise.all(
              Array.from({ length: 10 }, (_, index) =>
                buildEventFeedbackLink({
                  baseUrl,
                  eventRoute: feedbackEvent.route || feedbackEvent.id,
                  email: auth.email!,
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
        : buildPreviewFeedbackPrompt(
            baseUrl,
            feedbackEvent.route || feedbackEvent.id,
            feedbackEvent.name ?? null,
          )
      : null;

    await sendCampaignEmail({
      email: auth.email!,
      subject: `[TEST] ${campaign.subject}`,
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
      feedbackPrompt,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Campaign test send error:", err);
    return NextResponse.json(
      { error: "Failed to send test email" },
      { status: 500 },
    );
  }
}
