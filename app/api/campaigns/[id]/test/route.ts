import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import { db, eq, emailCampaigns } from "@ssb/db";
import { isValidUUID } from "@/app/lib/validation";
import { sendCampaignEmail } from "@/app/lib/email";

type Params = { params: Promise<{ id: string }> };

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
