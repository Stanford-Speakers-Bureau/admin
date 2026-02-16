import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/supabase";
import {
  sendTicketsAvailableNowEmail,
  sendTicketsAvailableInEmail,
  sendClaimTicketEmail,
} from "@/app/lib/email";

export async function POST(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    let body: {
      eventId?: string;
      variant?: "now" | "in" | "claim";
      approxTimeUntilAvailable?: string;
      singleEmail?: string;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { eventId, variant, approxTimeUntilAvailable, singleEmail } = body;

    if (!eventId || typeof eventId !== "string") {
      return NextResponse.json(
        { error: "eventId is required" },
        { status: 400 },
      );
    }
    if (!variant || (variant !== "now" && variant !== "in" && variant !== "claim")) {
      return NextResponse.json(
        { error: 'variant must be "now", "in", or "claim"' },
        { status: 400 },
      );
    }
    if (variant === "in") {
      const approx =
        typeof approxTimeUntilAvailable === "string"
          ? approxTimeUntilAvailable.trim()
          : "";
      if (!approx) {
        return NextResponse.json(
          { error: "approxTimeUntilAvailable is required when variant is 'in'" },
          { status: 400 },
        );
      }
    }

    const adminClient = auth.adminClient!;

    const { data: event, error: eventError } = await adminClient
      .from("events")
      .select("id, name, route, start_time_date")
      .eq("id", eventId)
      .single();

    if (eventError || !event) {
      console.error("Event fetch error:", eventError);
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const eventName = event.name || "Event";
    const eventRoute = event.route ?? null;
    const eventStartTime = event.start_time_date ?? null;

    let emails: string[];
    let skipped = 0;
    if (singleEmail && typeof singleEmail === "string") {
      const email = singleEmail.trim().toLowerCase();
      if (!email) {
        return NextResponse.json(
          { error: "singleEmail must be a non-empty string" },
          { status: 400 },
        );
      }
      emails = [email];
    } else {
      const { data: notifications, error: notifyError } = await adminClient
        .from("notify")
        .select("email")
        .eq("speaker_id", eventId);

      if (notifyError) {
        console.error("Notify fetch error:", notifyError);
        return NextResponse.json(
          { error: "Failed to fetch notify list" },
          { status: 500 },
        );
      }
      const allEmails = [...new Set((notifications || []).map((n: { email: string }) => n.email.toLowerCase()))];

      // For "claim" variant, filter out people who already have tickets
      if (variant === "claim") {
        const { data: tickets, error: ticketsError } = await adminClient
          .from("tickets")
          .select("email")
          .eq("event_id", eventId);

        if (ticketsError) {
          console.error("Tickets fetch error:", ticketsError);
          return NextResponse.json(
            { error: "Failed to check existing tickets" },
            { status: 500 },
          );
        }

        const ticketEmails = new Set(
          (tickets || []).map((t: { email: string }) => t.email.toLowerCase()),
        );
        emails = allEmails.filter((e) => !ticketEmails.has(e));
        skipped = allEmails.length - emails.length;
      } else {
        emails = allEmails;
      }
    }

    if (emails.length === 0) {
      return NextResponse.json(
        { sent: 0, failed: 0, skipped },
        { status: 200 },
      );
    }

    // Send emails in batches to avoid memory overflow
    // Rate limit: max 14 emails per second (matches ticket reminder batching)
    const BATCH_SIZE = 14;
    const MIN_BATCH_DURATION_MS = 1000;
    const results: PromiseSettledResult<{
      success: boolean;
      email: string;
      error?: unknown;
    }>[] = [];

    const approxTime = variant === "in" ? approxTimeUntilAvailable!.trim() : "";

    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batchStartTime = Date.now();
      const batch = emails.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map((email) =>
        (variant === "claim"
          ? sendClaimTicketEmail({
              email,
              eventName,
              eventRoute,
              eventStartTime,
            })
          : variant === "now"
            ? sendTicketsAvailableNowEmail({
                email,
                eventName,
                eventRoute,
                eventStartTime,
              })
            : sendTicketsAvailableInEmail({
                email,
                eventName,
                eventRoute,
                eventStartTime,
                approxTimeUntilAvailable: approxTime,
              })
        ).then(
          () => ({ success: true, email }),
          (error) => ({ success: false, email, error }),
        ),
      );
      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults);

      // Rate limiting: ensure we don't exceed 14 emails/second
      const batchDuration = Date.now() - batchStartTime;
      if (batchDuration < MIN_BATCH_DURATION_MS && i + BATCH_SIZE < emails.length) {
        await new Promise((resolve) =>
          setTimeout(resolve, MIN_BATCH_DURATION_MS - batchDuration),
        );
      }
    }

    let sent = 0;
    let failed = 0;
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value.success) {
          sent++;
        } else {
          failed++;
          console.error(`Failed to send notify email to ${result.value.email}:`, result.value.error);
        }
      } else {
        failed++;
      }
    }

    return NextResponse.json({ sent, failed, skipped });
  } catch (err) {
    console.error("Notify send error:", err);
    return NextResponse.json(
      { error: "Failed to send notify emails" },
      { status: 500 },
    );
  }
}
