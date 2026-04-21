import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { fromZonedTime } from "date-fns-tz";
import {
  getSignedImageUrl,
  getSupabaseClient,
  serializeEvent,
} from "@/app/lib/supabase";
import { verifyAdminRequest } from "@/app/lib/auth";
import { PACIFIC_TIMEZONE } from "@/app/lib/constants";
import { pullFromWaitlist } from "@/app/lib/waitlist";
import { db, eq, ne, events } from "@ssb/db";
import { logAuditEvent } from "@/app/lib/audit";
import type { InferInsertModel, InferSelectModel } from "@ssb/db";
import {
  isTicketingRole,
  resolveTicketingRoles,
} from "@/app/lib/ticketingRoles";
import {
  isValidUUID,
  isValidUrl,
  isValidRoute,
  isValidCapacity,
  isValidImageExtension,
  isValidAppleWalletImageExtension,
  isValidImageSize,
  isValidDateString,
  isValidLatitude,
  isValidLongitude,
  isValidAddress,
} from "@/app/lib/validation";

async function uploadEventImage(
  adminClient: ReturnType<typeof getSupabaseClient>,
  imageFile: File | null,
  options?: {
    allowedType?: "default" | "apple-wallet";
  },
): Promise<string | null> {
  if (!imageFile || imageFile.size === 0) {
    return null;
  }

  if (!isValidImageSize(imageFile.size)) {
    throw new Error("Image file too large. Maximum size is 5MB.");
  }

  const isAppleWalletImage = options?.allowedType === "apple-wallet";

  if (
    isAppleWalletImage
      ? !isValidAppleWalletImageExtension(imageFile.name)
      : !isValidImageExtension(imageFile.name)
  ) {
    throw new Error(
      isAppleWalletImage
        ? "Invalid Apple Wallet image file type. Upload a PNG."
        : "Invalid image file type. Allowed types: JPG, PNG, GIF, WebP.",
    );
  }

  if (isAppleWalletImage && imageFile.type && imageFile.type !== "image/png") {
    throw new Error("Invalid Apple Wallet image file type. Upload a PNG.");
  }

  const fileExt = imageFile.name.split(".").pop();
  const fileName = `${Date.now()}-${randomUUID()}.${fileExt}`;

  const { error: uploadError } = await adminClient.storage
    .from("speakers")
    .upload(fileName, imageFile, {
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) {
    console.error("Image upload error:", uploadError);
    throw new Error("Failed to upload image");
  }

  return fileName;
}

async function serializeEventWithImages(
  event: InferSelectModel<typeof events>,
) {
  const serialized = serializeEvent(event);
  return {
    ...serialized,
    image_url: event.img ? await getSignedImageUrl(event.img, 60 * 60) : null,
    mobile_image_url: event.mobileImg
      ? await getSignedImageUrl(event.mobileImg, 60 * 60)
      : null,
    apple_wallet_image_url: event.appleWalletImg
      ? await getSignedImageUrl(event.appleWalletImg, 60 * 60)
      : null,
  };
}

export async function POST(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const adminClient = auth.adminClient!;
    const formData = await req.formData();
    const id = formData.get("id") as string | null;
    const name = formData.get("name") as string;
    const desc = formData.get("desc") as string;
    const tagline = formData.get("tagline") as string;
    const capacity = formData.get("capacity") as string;
    const tickets = formData.get("tickets") as string;
    const reserved = formData.get("reserved") as string;
    const venue = formData.get("venue") as string;
    const venue_link = formData.get("venue_link") as string;
    const release_date = formData.get("release_date") as string;
    const ticketing_date = formData.get("ticketing_date") as string;
    const start_time_date = formData.get("start_time_date") as string;
    const end_time_date = formData.get("end_time_date") as string;
    const doors_open = formData.get("doors_open") as string;
    const route = formData.get("route") as string;
    const priority = formData.get("priority") as string;
    const hide_ticketing_date = formData.get("hide_ticketing_date") === "true";
    const referrals_enabled = formData.get("referrals_enabled") === "true";
    const standby_enabled = formData.get("standby_enabled") === "true";
    const livestream = formData.get("livestream") as string;
    const latitude = formData.get("latitude") as string;
    const longitude = formData.get("longitude") as string;
    const address = formData.get("address") as string;
    const external_ticketing_enabled =
      formData.get("external_ticketing_enabled") === "true";
    const external_ticketing_url =
      (formData.get("external_ticketing_url") as string | null)?.trim() || "";
    const rawTicketingRoles = formData
      .getAll("ticketing_roles")
      .filter((value): value is string => typeof value === "string");
    const imageFile = formData.get("image") as File | null;
    const mobileImageFile = formData.get("mobile_image") as File | null;
    const appleWalletImageFile = formData.get(
      "apple_wallet_image",
    ) as File | null;
    const invalidTicketingRole = rawTicketingRoles.find(
      (value) => !isTicketingRole(value),
    );

    // Validate ID if provided
    if (id && !isValidUUID(id)) {
      return NextResponse.json(
        { error: "Invalid event ID format" },
        { status: 400 },
      );
    }

    // Validate capacity
    if (capacity && !isValidCapacity(capacity)) {
      return NextResponse.json(
        { error: "Invalid capacity value" },
        { status: 400 },
      );
    }

    // Validate priority notice length
    if (priority && priority.trim().length > 300) {
      return NextResponse.json(
        { error: "Priority notice must be 300 characters or less" },
        { status: 400 },
      );
    }

    // Validate livestream URL
    if (livestream && !isValidUrl(livestream)) {
      return NextResponse.json(
        { error: "Invalid livestream URL" },
        { status: 400 },
      );
    }

    // Validate venue_link URL
    if (venue_link && !isValidUrl(venue_link)) {
      return NextResponse.json(
        { error: "Invalid venue link URL" },
        { status: 400 },
      );
    }

    if (external_ticketing_enabled && !external_ticketing_url) {
      return NextResponse.json(
        {
          error:
            "External ticketing URL is required when external ticketing is enabled.",
        },
        { status: 400 },
      );
    }

    if (external_ticketing_url && !isValidUrl(external_ticketing_url)) {
      return NextResponse.json(
        { error: "Invalid external ticketing URL" },
        { status: 400 },
      );
    }

    // Validate route slug
    if (route && !isValidRoute(route)) {
      return NextResponse.json(
        {
          error:
            "Invalid route format. Use only lowercase letters, numbers, hyphens, and underscores.",
        },
        { status: 400 },
      );
    }

    // Validate dates
    if (release_date && !isValidDateString(release_date)) {
      return NextResponse.json(
        { error: "Invalid release date format" },
        { status: 400 },
      );
    }
    if (ticketing_date && !isValidDateString(ticketing_date)) {
      return NextResponse.json(
        { error: "Invalid ticketing date format" },
        { status: 400 },
      );
    }
    if (start_time_date && !isValidDateString(start_time_date)) {
      return NextResponse.json(
        { error: "Invalid start time date format" },
        { status: 400 },
      );
    }
    if (end_time_date && !isValidDateString(end_time_date)) {
      return NextResponse.json(
        { error: "Invalid end time date format" },
        { status: 400 },
      );
    }
    if (doors_open && !isValidDateString(doors_open)) {
      return NextResponse.json(
        { error: "Invalid doors open date format" },
        { status: 400 },
      );
    }

    // Validate latitude (required)
    if (!latitude || !isValidLatitude(latitude)) {
      return NextResponse.json(
        { error: "Valid latitude is required (-90 to 90)" },
        { status: 400 },
      );
    }

    // Validate longitude (required)
    if (!longitude || !isValidLongitude(longitude)) {
      return NextResponse.json(
        { error: "Valid longitude is required (-180 to 180)" },
        { status: 400 },
      );
    }

    // Validate address
    if (address && !isValidAddress(address)) {
      return NextResponse.json(
        { error: "Address must be 500 characters or less" },
        { status: 400 },
      );
    }

    if (invalidTicketingRole) {
      return NextResponse.json(
        { error: "Invalid ticketing role selection" },
        { status: 400 },
      );
    }

    let existingEvent: {
      capacity: number;
      reserved: number;
      tickets: number;
      imgVersion: number;
    } | null = null;

    if (id) {
      existingEvent =
        (await db.query.events.findFirst({
          where: eq(events.id, id),
          columns: {
            capacity: true,
            reserved: true,
            tickets: true,
            imgVersion: true,
          },
        })) ?? null;
    }

    let imgName: string | null = null;
    let mobileImgName: string | null = null;
    let appleWalletImgName: string | null = null;

    try {
      imgName = await uploadEventImage(adminClient, imageFile);
      mobileImgName = await uploadEventImage(adminClient, mobileImageFile);
      appleWalletImgName = await uploadEventImage(
        adminClient,
        appleWalletImageFile,
        {
          allowedType: "apple-wallet",
        },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to upload image";
      return NextResponse.json(
        { error: message },
        {
          status:
            message.startsWith("Invalid") ||
            message.startsWith("Image file too large")
              ? 400
              : 500,
        },
      );
    }

    const parsedCapacity = capacity ? parseInt(capacity, 10) : 0;
    const parsedReserved = reserved ? parseInt(reserved, 10) : 0;
    const parsedTickets = tickets ? parseInt(tickets, 10) : parsedReserved;
    const releaseDateValue = release_date
      ? fromZonedTime(release_date, PACIFIC_TIMEZONE)
      : null;
    const ticketingDateValue = ticketing_date
      ? fromZonedTime(ticketing_date, PACIFIC_TIMEZONE)
      : null;
    const startTimeDateValue = start_time_date
      ? fromZonedTime(start_time_date, PACIFIC_TIMEZONE)
      : null;
    const endTimeDateValue = end_time_date
      ? fromZonedTime(end_time_date, PACIFIC_TIMEZONE)
      : null;
    const doorsOpenValue = doors_open
      ? fromZonedTime(doors_open, PACIFIC_TIMEZONE)
      : null;
    const ticketingRoles = resolveTicketingRoles(rawTicketingRoles);

    // Build event data object
    const eventData: InferInsertModel<typeof events> = {
      name: name || null,
      desc: desc || null,
      tagline: tagline || null,
      capacity: parsedCapacity,
      tickets: parsedTickets,
      reserved: parsedReserved,
      venue: venue || null,
      venueLink: venue_link || null,
      releaseDate: releaseDateValue,
      ticketingDate: ticketingDateValue,
      startTimeDate: startTimeDateValue,
      endTimeDate: endTimeDateValue,
      doorsOpen: doorsOpenValue,
      route: route || null,
      priority: priority?.trim() || null,
      ticketingRoles,
      hideTicketingDate: hide_ticketing_date,
      referralsEnabled: referrals_enabled,
      standbyEnabled: standby_enabled,
      livestream: livestream || null,
      latitude,
      longitude,
      address: address || "",
      externalTicketingEnabled: external_ticketing_enabled,
      externalTicketingUrl: external_ticketing_enabled
        ? external_ticketing_url
        : null,
    };

    // Enforce: ticketing date must be on/after release date when both are set
    if (releaseDateValue && ticketingDateValue) {
      const publishMs = releaseDateValue.getTime();
      const ticketingMs = ticketingDateValue.getTime();
      if (Number.isNaN(publishMs) || Number.isNaN(ticketingMs)) {
        return NextResponse.json(
          { error: "Invalid date format" },
          { status: 400 },
        );
      }
      if (ticketingMs < publishMs) {
        return NextResponse.json(
          {
            error: "Ticketing date must be on or after the release date.",
          },
          { status: 400 },
        );
      }
    }

    if (startTimeDateValue && endTimeDateValue) {
      const startMs = startTimeDateValue.getTime();
      const endMs = endTimeDateValue.getTime();
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        return NextResponse.json(
          { error: "Invalid date format" },
          { status: 400 },
        );
      }
      if (endMs < startMs) {
        return NextResponse.json(
          {
            error: "End time must be on or after the event start time.",
          },
          { status: 400 },
        );
      }
    }

    if (imgName) {
      eventData.img = imgName;
    }

    if (mobileImgName) {
      eventData.mobileImg = mobileImgName;
    }

    if (appleWalletImgName) {
      eventData.appleWalletImg = appleWalletImgName;
    }

    if (imgName || mobileImgName) {
      eventData.imgVersion =
        id && existingEvent ? existingEvent.imgVersion + 1 : 1;
    }

    let savedEvent: InferSelectModel<typeof events> | undefined;

    if (id) {
      // Update existing event
      const [updated] = await db
        .update(events)
        .set(eventData)
        .where(eq(events.id, id))
        .returning();
      savedEvent = updated;
    } else {
      // Create new event
      const [created] = await db.insert(events).values(eventData).returning();
      savedEvent = created;
    }

    if (!savedEvent) {
      return NextResponse.json(
        { error: "Failed to save event" },
        { status: 500 },
      );
    }

    if (id && existingEvent && savedEvent) {
      const previousCapacity = existingEvent.capacity;
      const previousReserved = existingEvent.reserved;
      const newCapacity = savedEvent.capacity;
      const newReserved = savedEvent.reserved;

      const capacityIncreased = newCapacity > previousCapacity;
      const reservedDecreased = newReserved < previousReserved;

      if (capacityIncreased || reservedDecreased) {
        try {
          const trigger =
            capacityIncreased && reservedDecreased
              ? "event.capacity_increase_and_reserved_decrease"
              : capacityIncreased
                ? "event.capacity_increase"
                : "event.reserved_decrease";

          await pullFromWaitlist(adminClient, savedEvent.id, undefined, {
            actor: auth.email!,
            metadata: {
              trigger,
              previousCapacity,
              newCapacity,
              previousReserved,
              newReserved,
            },
          });
        } catch (waitlistError) {
          console.error(
            "Waitlist conversion error (non-fatal):",
            waitlistError,
          );
        }
      }
    }

    await logAuditEvent({
      action: id ? "event.edit" : "event.create",
      actor: auth.email!,
      eventId: savedEvent.id,
      eventName: savedEvent.name ?? null,
    });

    const eventWithImage = await serializeEventWithImages(savedEvent);

    return NextResponse.json({ success: true, event: eventWithImage });
  } catch (error) {
    console.error("Event save error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const body = await req.json();
    const { id, live, standbyEnabled } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Event ID is required" },
        { status: 400 },
      );
    }

    if (typeof standbyEnabled === "boolean") {
      const [updatedEvent] = await db
        .update(events)
        .set({ standbyEnabled })
        .where(eq(events.id, id))
        .returning();

      await logAuditEvent({
        action: "event.toggle_standby",
        actor: auth.email!,
        eventId: id,
        eventName: updatedEvent.name ?? null,
        metadata: { standbyEnabled },
      });

      const eventWithImage = await serializeEventWithImages(updatedEvent);

      return NextResponse.json({ success: true, event: eventWithImage });
    }

    if (typeof live !== "boolean") {
      return NextResponse.json(
        { error: "Either 'live' or 'standbyEnabled' boolean is required" },
        { status: 400 },
      );
    }

    if (live) {
      // Set all events to not live first
      await db.update(events).set({ live: false }).where(ne(events.id, id));

      // Set the specified event to live
      const [updatedEvent] = await db
        .update(events)
        .set({ live: true })
        .where(eq(events.id, id))
        .returning();

      await logAuditEvent({
        action: "event.toggle_live",
        actor: auth.email!,
        eventId: id,
        eventName: updatedEvent.name ?? null,
        metadata: { live: true },
      });

      const eventWithImage = await serializeEventWithImages(updatedEvent);

      return NextResponse.json({ success: true, event: eventWithImage });
    } else {
      // Just set this event to not live
      const [updatedEvent] = await db
        .update(events)
        .set({ live: false })
        .where(eq(events.id, id))
        .returning();

      await logAuditEvent({
        action: "event.toggle_live",
        actor: auth.email!,
        eventId: id,
        eventName: updatedEvent.name ?? null,
        metadata: { live: false },
      });

      const eventWithImage = await serializeEventWithImages(updatedEvent);

      return NextResponse.json({ success: true, event: eventWithImage });
    }
  } catch (error) {
    console.error("Event live update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const body = await req.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Event ID is required" },
        { status: 400 },
      );
    }

    // Validate UUID format
    if (!isValidUUID(id)) {
      return NextResponse.json(
        { error: "Invalid event ID format" },
        { status: 400 },
      );
    }

    // Get the event first to delete its image
    const event = await db.query.events.findFirst({
      where: eq(events.id, id),
      columns: { name: true, img: true, mobileImg: true, appleWalletImg: true },
    });

    // Delete the image from storage if it exists (Supabase Storage)
    const imagesToDelete = [
      event?.img,
      event?.mobileImg,
      event?.appleWalletImg,
    ].filter((value): value is string => !!value);
    if (imagesToDelete.length > 0) {
      const adminClient = auth.adminClient!;
      await adminClient.storage.from("speakers").remove(imagesToDelete);
    }

    // Delete the event
    await db.delete(events).where(eq(events.id, id));

    await logAuditEvent({
      action: "event.delete",
      actor: auth.email!,
      eventId: id,
      eventName: event?.name ?? null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Event delete error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
