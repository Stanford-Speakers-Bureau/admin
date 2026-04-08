import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/app/lib/auth";
import { isValidEmail, isValidUUID } from "@/app/lib/validation";
import { db, eq, roles } from "@ssb/db";
import { logAuditEvent } from "@/app/lib/audit";

export async function POST(req: Request) {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const body = await req.json();
    const { email, id, type, action } = body;

    if (!type || !["admin", "ban", "scanner", "fee_waiver"].includes(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    if (!action || !["add", "remove"].includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    let roleName = "admin";
    if (type === "ban") roleName = "banned";
    if (type === "scanner") roleName = "scanner";
    if (type === "fee_waiver") roleName = "fee_waiver";

    if (action === "add") {
      if (!email) {
        return NextResponse.json(
          { error: "Email is required" },
          { status: 400 },
        );
      }

      // Validate email format
      if (!isValidEmail(email)) {
        return NextResponse.json(
          { error: "Invalid email format" },
          { status: 400 },
        );
      }

      // Check if user exists in roles table
      const existing = await db.query.roles.findFirst({
        where: eq(roles.email, email),
      });

      if (existing) {
        const currentRoles = existing.roles ? existing.roles.split(",") : [];
        if (currentRoles.includes(roleName)) {
          return NextResponse.json(
            {
              error:
                type === "admin"
                  ? "This email is already an admin"
                  : type === "scanner"
                    ? "This email is already a scanner"
                    : type === "fee_waiver"
                      ? "This email is already marked as Fee Waiver"
                      : "This email is already banned",
            },
            { status: 400 },
          );
        }

        // Add role to existing user
        const newRoles = [...currentRoles, roleName].join(",");
        const [updated] = await db.update(roles)
          .set({ roles: newRoles })
          .where(eq(roles.id, existing.id))
          .returning();

        await logAuditEvent({
          action: "user.add_role",
          actor: auth.email!,
          targetEmail: email,
          metadata: { role: roleName },
        });

        return NextResponse.json({
          success: true,
          user: {
            id: updated.id,
            created_at: updated.createdAt.toISOString(),
            email: updated.email,
            roles: updated.roles,
          },
        });
      } else {
        // Create new user with role
        const [created] = await db.insert(roles)
          .values({ email, roles: roleName })
          .returning();

        await logAuditEvent({
          action: "user.add_role",
          actor: auth.email!,
          targetEmail: email,
          metadata: { role: roleName },
        });

        return NextResponse.json({
          success: true,
          user: {
            id: created.id,
            created_at: created.createdAt.toISOString(),
            email: created.email,
            roles: created.roles,
          },
        });
      }
    } else {
      // Remove
      if (!id) {
        return NextResponse.json({ error: "ID is required" }, { status: 400 });
      }

      // Validate UUID format
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

      // Update roles
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
    }
  } catch (error) {
    console.error("Users action error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
