import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import { getAdminEventQuestions } from "@/app/event-questions/data";
import { isValidUUID, isValidEmail } from "@/app/lib/validation";
import {
  and,
  db,
  eq,
  eventQuestions,
  eventQuestionVotes,
  events,
} from "@ssb/db";
import { logAuditEvent } from "@/app/lib/audit";
import { sendEventQuestionApprovedEmail } from "@/app/lib/email";

const MIN_LEN = 4;
const MAX_LEN = 280;

export async function POST(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const body = await req.json();
    const { id, action } = body as { id?: string; action?: string };

    if (!id || !action || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    if (!isValidUUID(id)) {
      return NextResponse.json(
        { error: "Invalid question ID format" },
        { status: 400 },
      );
    }

    const existing = await db.query.eventQuestions.findFirst({
      where: eq(eventQuestions.id, id),
      columns: {
        id: true,
        question: true,
        email: true,
        approved: true,
        eventId: true,
      },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Question not found" },
        { status: 404 },
      );
    }

    await db
      .update(eventQuestions)
      .set({ reviewed: true, approved: action === "approve" })
      .where(eq(eventQuestions.id, id));

    await logAuditEvent({
      action:
        action === "approve"
          ? "event_question.approve"
          : "event_question.reject",
      actor: auth.email!,
      eventId: existing.eventId,
      targetEmail: existing.email ?? undefined,
      metadata: { questionId: id, question: existing.question },
    });

    if (
      action === "approve" &&
      !existing.approved &&
      existing.email &&
      existing.question &&
      isValidEmail(existing.email)
    ) {
      try {
        const event = await db.query.events.findFirst({
          where: eq(events.id, existing.eventId),
          columns: { name: true, route: true, id: true },
        });
        if (event) {
          await sendEventQuestionApprovedEmail({
            email: existing.email,
            question: existing.question,
            eventName: event.name ?? "the event",
            eventRoute: event.route ?? event.id,
          });
        }
      } catch (emailError) {
        console.error(
          "Failed to send event question approval email:",
          emailError,
        );
      }
    }

    const { questions } = await getAdminEventQuestions();
    return NextResponse.json({ success: true, questions });
  } catch (error) {
    console.error("Event question action error:", error);
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
    const { id, question, duplicate, hidden } = body as {
      id?: string;
      question?: string;
      duplicate?: boolean;
      hidden?: boolean;
    };

    if (!id) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    if (!isValidUUID(id)) {
      return NextResponse.json(
        { error: "Invalid question ID format" },
        { status: 400 },
      );
    }

    const existing = await db.query.eventQuestions.findFirst({
      where: eq(eventQuestions.id, id),
      columns: { question: true, eventId: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Question not found" },
        { status: 404 },
      );
    }

    if (typeof hidden === "boolean") {
      await db
        .update(eventQuestions)
        .set({ hidden })
        .where(eq(eventQuestions.id, id));
      await logAuditEvent({
        action: hidden ? "event_question.hide" : "event_question.unhide",
        actor: auth.email!,
        eventId: existing.eventId,
        metadata: { questionId: id, question: existing.question, hidden },
      });
      const { questions } = await getAdminEventQuestions();
      return NextResponse.json({ success: true, questions });
    }

    if (typeof duplicate === "boolean") {
      await db
        .update(eventQuestions)
        .set({ duplicate })
        .where(eq(eventQuestions.id, id));
      await logAuditEvent({
        action: "event_question.mark_duplicate",
        actor: auth.email!,
        eventId: existing.eventId,
        metadata: { questionId: id, question: existing.question, duplicate },
      });
      const { questions } = await getAdminEventQuestions();
      return NextResponse.json({ success: true, questions });
    }

    if (typeof question !== "string") {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const trimmed = question.trim();
    if (trimmed.length < MIN_LEN || trimmed.length > MAX_LEN) {
      return NextResponse.json(
        { error: "Question must be 4–280 characters" },
        { status: 400 },
      );
    }

    await db
      .update(eventQuestions)
      .set({ question: trimmed })
      .where(eq(eventQuestions.id, id));
    await logAuditEvent({
      action: "event_question.edit",
      actor: auth.email!,
      eventId: existing.eventId,
      metadata: {
        questionId: id,
        oldQuestion: existing.question,
        newQuestion: trimmed,
      },
    });

    const { questions } = await getAdminEventQuestions();
    return NextResponse.json({ success: true, questions });
  } catch (error) {
    console.error("Event question edit error:", error);
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
    const { sourceId, targetId } = body as {
      sourceId?: string;
      targetId?: string;
    };
    if (
      !sourceId ||
      !targetId ||
      typeof sourceId !== "string" ||
      typeof targetId !== "string"
    ) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    if (!isValidUUID(sourceId) || !isValidUUID(targetId)) {
      return NextResponse.json(
        { error: "Invalid question ID format" },
        { status: 400 },
      );
    }

    const source = await db.query.eventQuestions.findFirst({
      where: eq(eventQuestions.id, sourceId),
      columns: { id: true, approved: true, eventId: true },
    });
    if (!source || source.approved) {
      return NextResponse.json(
        { error: "Source must be pending or rejected" },
        { status: 400 },
      );
    }

    const target = await db.query.eventQuestions.findFirst({
      where: eq(eventQuestions.id, targetId),
      columns: { id: true, approved: true, eventId: true },
    });
    if (!target || !target.approved) {
      return NextResponse.json(
        { error: "Target must be approved" },
        { status: 400 },
      );
    }

    if (source.eventId !== target.eventId) {
      return NextResponse.json(
        { error: "Cannot merge questions across different events" },
        { status: 400 },
      );
    }

    const sourceVotes = await db.query.eventQuestionVotes.findMany({
      where: eq(eventQuestionVotes.questionId, sourceId),
      columns: { email: true },
    });
    const targetVotes = await db.query.eventQuestionVotes.findMany({
      where: eq(eventQuestionVotes.questionId, targetId),
      columns: { email: true },
    });
    const targetVoterEmails = new Set(targetVotes.map((v) => v.email));
    const toTransfer = sourceVotes.filter(
      (v) => v.email && !targetVoterEmails.has(v.email),
    );

    if (toTransfer.length > 0) {
      await db.insert(eventQuestionVotes).values(
        toTransfer.map((v) => ({
          questionId: targetId,
          email: v.email!,
        })),
      );
    }

    await db
      .delete(eventQuestionVotes)
      .where(eq(eventQuestionVotes.questionId, sourceId));

    await db
      .update(eventQuestions)
      .set({ reviewed: true, approved: false, duplicate: true })
      .where(eq(eventQuestions.id, sourceId));

    await logAuditEvent({
      action: "event_question.merge",
      actor: auth.email!,
      eventId: source.eventId,
      metadata: {
        sourceId,
        targetId,
        eventId: source.eventId,
        votesTransferred: toTransfer.length,
      },
    });

    const { questions } = await getAdminEventQuestions();
    return NextResponse.json({ success: true, questions });
  } catch (error) {
    console.error("Event question merge error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
