import { NextResponse } from "next/server";
import { normalizeEmail, verifyAdminRequest } from "@/app/lib/auth";
import { isValidEmail, isValidUUID } from "@/app/lib/validation";
import { db, eq, ilike, roles } from "@ssb/db";
import { logAuditEvent } from "@/app/lib/audit";

type RoleType = "admin" | "ban" | "scanner" | "fee_waiver" | "email_suppression";

const ROLE_NAMES: Record<RoleType, string> = {
  admin: "admin",
  ban: "banned",
  scanner: "scanner",
  fee_waiver: "fee_waiver",
  email_suppression: "email_suppression",
};

const ALREADY_HAS_ROLE: Record<RoleType, string> = {
  admin: "This email is already an admin",
  ban: "This email is already banned",
  scanner: "This email is already a scanner",
  fee_waiver: "This email is already marked as Fee Waiver",
  email_suppression: "This email is already suppressed",
};

type SerializedUser = {
  id: string;
  created_at: string;
  email: string | null;
  roles: string | null;
};

export async function POST(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const body = await req.json();
    const { email, emails, id, type, action } = body as {
      email?: string;
      emails?: string[];
      id?: string;
      type?: RoleType;
      action?: "add" | "remove" | "clear_all";
    };

    if (!type || !(type in ROLE_NAMES)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    if (!action || !["add", "remove", "clear_all"].includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const roleName = ROLE_NAMES[type];

    if (action === "add") {
      const inputEmails = Array.isArray(emails)
        ? emails
        : email
          ? [email]
          : [];

      if (inputEmails.length === 0) {
        return NextResponse.json(
          { error: "Email is required" },
          { status: 400 },
        );
      }

      const seen = new Set<string>();
      const normalized: string[] = [];
      const errors: { email: string; error: string }[] = [];

      for (const raw of inputEmails) {
        if (typeof raw !== "string") continue;
        const n = normalizeEmail(raw);
        if (!n) continue;
        if (!isValidEmail(n)) {
          errors.push({ email: raw, error: "Invalid email format" });
          continue;
        }
        if (seen.has(n)) continue;
        seen.add(n);
        normalized.push(n);
      }

      const created: SerializedUser[] = [];

      for (const target of normalized) {
        try {
          const existing = await db.query.roles.findFirst({
            where: eq(roles.email, target),
          });

          if (existing) {
            const currentRoles = existing.roles
              ? existing.roles.split(",")
              : [];
            if (currentRoles.includes(roleName)) {
              errors.push({ email: target, error: ALREADY_HAS_ROLE[type] });
              continue;
            }

            const newRoles = [...currentRoles, roleName].join(",");
            const [updated] = await db.update(roles)
              .set({ roles: newRoles })
              .where(eq(roles.id, existing.id))
              .returning();

            await logAuditEvent({
              action: "user.add_role",
              actor: auth.email!,
              targetEmail: target,
              metadata: { role: roleName },
            });

            created.push({
              id: updated.id,
              created_at: updated.createdAt.toISOString(),
              email: updated.email,
              roles: updated.roles,
            });
          } else {
            const [createdRow] = await db.insert(roles)
              .values({ email: target, roles: roleName })
              .returning();

            await logAuditEvent({
              action: "user.add_role",
              actor: auth.email!,
              targetEmail: target,
              metadata: { role: roleName },
            });

            created.push({
              id: createdRow.id,
              created_at: createdRow.createdAt.toISOString(),
              email: createdRow.email,
              roles: createdRow.roles,
            });
          }
        } catch (err) {
          console.error(`Failed to add ${target}:`, err);
          errors.push({ email: target, error: "Failed to add" });
        }
      }

      // Backwards-compatible single-email response shape.
      if (!Array.isArray(emails) && created.length === 1 && errors.length === 0) {
        return NextResponse.json({ success: true, user: created[0] });
      }

      return NextResponse.json({
        success: errors.length === 0,
        users: created,
        errors,
      });
    }

    if (action === "clear_all") {
      if (type !== "fee_waiver") {
        return NextResponse.json(
          { error: "clear_all is only supported for fee_waiver" },
          { status: 400 },
        );
      }

      const matches = await db.query.roles.findMany({
        where: ilike(roles.roles, `%${roleName}%`),
      });

      let removed = 0;
      for (const row of matches) {
        const currentRoles = row.roles ? row.roles.split(",") : [];
        if (!currentRoles.includes(roleName)) continue;

        const newRoles = currentRoles.filter((r) => r !== roleName).join(",");

        await db.update(roles)
          .set({ roles: newRoles })
          .where(eq(roles.id, row.id));

        await logAuditEvent({
          action: "user.remove_role",
          actor: auth.email!,
          targetEmail: row.email ?? undefined,
          metadata: { role: roleName, bulk: true },
        });

        removed++;
      }

      return NextResponse.json({ success: true, removed });
    }

    // action === "remove"
    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    if (!isValidUUID(id)) {
      return NextResponse.json(
        { error: "Invalid user ID format" },
        { status: 400 },
      );
    }

    const existing = await db.query.roles.findFirst({
      where: eq(roles.id, id),
    });

    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const currentRoles = existing.roles ? existing.roles.split(",") : [];
    const newRoles = currentRoles.filter((r: string) => r !== roleName);
    const newRolesString = newRoles.join(",");

    await db.update(roles)
      .set({ roles: newRolesString })
      .where(eq(roles.id, id));

    await logAuditEvent({
      action: "user.remove_role",
      actor: auth.email!,
      targetEmail: existing.email ?? undefined,
      metadata: { role: roleName },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Users action error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
