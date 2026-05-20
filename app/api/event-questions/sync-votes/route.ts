import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import { getAdminEventQuestions } from "@/app/event-questions/data";
import {
  count as dbCount,
  db,
  eq,
  eventQuestions,
  eventQuestionVotes,
} from "@ssb/db";
import { isValidUUID } from "@/app/lib/validation";
import { logAuditEvent } from "@/app/lib/audit";

export async function POST(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    let body: { id?: string } = {};
    try {
      body = await req.json();
    } catch {
      /* allow empty body to sync all */
    }

    if (body.id) {
      if (!isValidUUID(body.id)) {
        return NextResponse.json(
          { error: "Invalid question ID format" },
          { status: 400 },
        );
      }
      const [result] = await db
        .select({ count: dbCount() })
        .from(eventQuestionVotes)
        .where(eq(eventQuestionVotes.questionId, body.id));
      const actual = result?.count ?? 0;
      await db
        .update(eventQuestions)
        .set({ votes: actual })
        .where(eq(eventQuestions.id, body.id));
      await logAuditEvent({
        action: "event_question.sync_votes",
        actor: auth.email!,
        metadata: { questionId: body.id, newVotes: actual },
      });
    } else {
      const all = await db.query.eventQuestions.findMany({
        columns: { id: true, votes: true },
      });
      let updated = 0;
      for (const q of all) {
        const [result] = await db
          .select({ count: dbCount() })
          .from(eventQuestionVotes)
          .where(eq(eventQuestionVotes.questionId, q.id));
        const actual = result?.count ?? 0;
        if (q.votes !== actual) {
          await db
            .update(eventQuestions)
            .set({ votes: actual })
            .where(eq(eventQuestions.id, q.id));
          updated++;
        }
      }
      await logAuditEvent({
        action: "event_question.sync_votes",
        actor: auth.email!,
        metadata: { scope: "all", updated },
      });
    }

    const { questions } = await getAdminEventQuestions();
    return NextResponse.json({ success: true, questions });
  } catch (error) {
    console.error("Sync event-question votes error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
