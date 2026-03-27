import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import { getAdminSuggestions } from "@/app/suggest/data";
import { isValidUUID } from "@/app/lib/validation";
import { db, eq, suggest, votes } from "@ssb/db";

export async function POST(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const body = await req.json();
    const { id, action } = body;

    if (!id || !action || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    // Validate UUID format
    if (!isValidUUID(id)) {
      return NextResponse.json(
        { error: "Invalid suggestion ID format" },
        { status: 400 },
      );
    }

    await db.update(suggest)
      .set({ reviewed: true, approved: action === "approve" })
      .where(eq(suggest.id, id));

    // Return fresh suggestions using the same logic as the initial page load
    const { suggestions } = await getAdminSuggestions();
    return NextResponse.json({ success: true, suggestions });
  } catch (error) {
    console.error("Suggestion action error:", error);
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
    const { id, speaker, duplicate } = body;

    if (!id) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    // Validate UUID format
    if (!isValidUUID(id)) {
      return NextResponse.json(
        { error: "Invalid suggestion ID format" },
        { status: 400 },
      );
    }

    // Handle marking as duplicate
    if (typeof duplicate === "boolean") {
      await db.update(suggest)
        .set({ duplicate })
        .where(eq(suggest.id, id));

      // Return fresh suggestions using the same logic as the initial page load
      const { suggestions } = await getAdminSuggestions();
      return NextResponse.json({ success: true, suggestions });
    }

    // Handle updating speaker name
    if (typeof speaker !== "string") {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    await db.update(suggest)
      .set({ speaker: speaker.trim() })
      .where(eq(suggest.id, id));

    // Return fresh suggestions using the same logic as the initial page load
    const { suggestions } = await getAdminSuggestions();
    return NextResponse.json({ success: true, suggestions });
  } catch (error) {
    console.error("Suggestion edit error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const body = await req.json();
    const { sourceId, targetId } = body;

    if (
      !sourceId ||
      !targetId ||
      typeof sourceId !== "string" ||
      typeof targetId !== "string"
    ) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    // Validate UUID formats
    if (!isValidUUID(sourceId) || !isValidUUID(targetId)) {
      return NextResponse.json(
        { error: "Invalid suggestion ID format" },
        { status: 400 },
      );
    }

    // Verify source is pending or rejected (not approved) and target is approved
    const source = await db.query.suggest.findFirst({
      where: eq(suggest.id, sourceId),
      columns: { id: true, reviewed: true, approved: true },
    });

    if (!source || source.approved) {
      return NextResponse.json(
        { error: "Source suggestion must be pending or rejected" },
        { status: 400 },
      );
    }

    const target = await db.query.suggest.findFirst({
      where: eq(suggest.id, targetId),
      columns: { id: true, approved: true },
    });

    if (!target || !target.approved) {
      return NextResponse.json(
        { error: "Target suggestion must be approved" },
        { status: 400 },
      );
    }

    // Get all votes from the source suggestion
    const sourceVotes = await db.query.votes.findMany({
      where: eq(votes.speakerId, sourceId),
      columns: { email: true },
    });

    // Get existing votes for the target to avoid duplicates
    const targetVotes = await db.query.votes.findMany({
      where: eq(votes.speakerId, targetId),
      columns: { email: true },
    });

    const targetVoterEmails = new Set(targetVotes.map((v) => v.email));

    // Filter out votes that already exist for the target
    const votesToTransfer = sourceVotes.filter(
      (vote) => vote.email && !targetVoterEmails.has(vote.email),
    );

    // Transfer votes to target (only new ones)
    if (votesToTransfer.length > 0) {
      await db.insert(votes).values(
        votesToTransfer.map((vote) => ({
          speakerId: targetId,
          email: vote.email!,
        })),
      );
    }

    // Delete all votes from source
    await db.delete(votes).where(eq(votes.speakerId, sourceId));

    // Mark source as reviewed, rejected, and duplicate
    await db.update(suggest)
      .set({ reviewed: true, approved: false, duplicate: true })
      .where(eq(suggest.id, sourceId));

    // Return fresh suggestions using the same logic as the initial page load
    const { suggestions } = await getAdminSuggestions();
    return NextResponse.json({ success: true, suggestions });
  } catch (error) {
    console.error("Duplicate merge error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
