import AdminUsersClient, { Admin, Ban, Scanner } from "./AdminUsersClient";
import { verifyAdminRequest } from "@/app/lib/supabase";
import { db } from "@ssb/db";

export const dynamic = "force-dynamic";

async function getInitialUsers(): Promise<{
  admins: Admin[];
  bans: Ban[];
  scanners: Scanner[];
}> {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return { admins: [], bans: [], scanners: [] };
    }

    const allRoles = await db.query.roles.findMany({
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });

    // Serialize to snake_case for client components
    const serialized = allRoles.map((r) => ({
      id: r.id,
      created_at: r.createdAt.toISOString(),
      email: r.email,
      roles: r.roles,
    }));

    const admins = serialized.filter((r) =>
      r.roles?.split(",").includes("admin"),
    );
    const bans = serialized.filter((r) =>
      r.roles?.split(",").includes("banned"),
    );
    const scanners = serialized.filter((r) =>
      r.roles?.split(",").includes("scanner"),
    );

    return {
      admins: admins as Admin[],
      bans: bans as Ban[],
      scanners: scanners as Scanner[],
    };
  } catch (error) {
    console.error("Failed to fetch initial users:", error);
    return { admins: [], bans: [], scanners: [] };
  }
}

export default async function AdminUsersPage() {
  const { admins, bans, scanners } = await getInitialUsers();
  return (
    <AdminUsersClient
      initialAdmins={admins}
      initialBans={bans}
      initialScanners={scanners}
    />
  );
}
