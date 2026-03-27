import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import { getAdminSuggestions } from "@/app/suggest/data";
import { db, eq, count as dbCount, suggest, votes } from "@ssb/db";

export async function POST() {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    // Get all suggestions with their actual vote counts
    const suggestions = await db.query.suggest.findMany({
      columns: { id: true, votes: true },
    });

    let updatedCount = 0;

    for (const suggestion of suggestions) {
      const [result] = await db.select({ count: dbCount() })
        .from(votes)
        .where(eq(votes.speakerId, suggestion.id));
      const actualVoteCount = result?.count ?? 0;

      if (suggestion.votes !== actualVoteCount) {
        await db.update(suggest)
          .set({ votes: actualVoteCount })
          .where(eq(suggest.id, suggestion.id));
        updatedCount++;
      }
    }

    // Return fresh suggestions using the same logic as the initial page load
    const { suggestions: freshSuggestions } = await getAdminSuggestions();
    return NextResponse.json({
      success: true,
      suggestions: freshSuggestions,
      updatedCount,
    });
  } catch (error) {
    console.error("Sync votes error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
