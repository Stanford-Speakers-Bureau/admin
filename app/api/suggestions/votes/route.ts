import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/supabase";
import { getAdminSuggestions } from "@/app/suggest/data";
import { db, eq, suggest } from "@ssb/db";

export async function PATCH(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const body = await req.json();
    const { speaker_id, votes } = body;

    if (
      !speaker_id ||
      typeof speaker_id !== "string" ||
      typeof votes !== "number" ||
      votes < 0 ||
      !Number.isInteger(votes)
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid request: speaker_id and votes (non-negative integer) are required",
        },
        { status: 400 },
      );
    }

    // Verify the suggestion exists
    const suggestion = await db.query.suggest.findFirst({
      where: eq(suggest.id, speaker_id),
      columns: { id: true },
    });

    if (!suggestion) {
      return NextResponse.json(
        { error: "Speaker suggestion not found" },
        { status: 404 },
      );
    }

    // Update the vote count directly
    await db.update(suggest)
      .set({ votes })
      .where(eq(suggest.id, speaker_id));

    // Return fresh suggestions
    const { suggestions } = await getAdminSuggestions();
    return NextResponse.json({ success: true, suggestions });
  } catch (error) {
    console.error("Update vote count error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
