import AdminUsersClient, {
  Admin,
  Ban,
  FeeWaiver,
  Scanner,
} from "./AdminUsersClient";
import { hasRoleName, verifyAdminRequest } from "@/app/lib/auth";
import { db } from "@ssb/db";
import { connection } from "next/server";

export const dynamic = "force-dynamic";

async function getInitialUsers(): Promise<{
  admins: Admin[];
  bans: Ban[];
  feeWaivers: FeeWaiver[];
  scanners: Scanner[];
}> {
  try {
    const auth = await verifyAdminRequest();
    if (!auth.authorized) {
      return { admins: [], bans: [], feeWaivers: [], scanners: [] };
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

    const admins = serialized.filter((r) => hasRoleName(r.roles, "admin"));
    const bans = serialized.filter((r) => hasRoleName(r.roles, "banned"));
    const feeWaivers = serialized.filter((r) => hasRoleName(r.roles, "fee_waiver"));
    const scanners = serialized.filter((r) => hasRoleName(r.roles, "scanner"));

    return {
      admins: admins as Admin[],
      bans: bans as Ban[],
      feeWaivers: feeWaivers as FeeWaiver[],
      scanners: scanners as Scanner[],
    };
  } catch (error) {
    console.error("Failed to fetch initial users:", error);
    return { admins: [], bans: [], feeWaivers: [], scanners: [] };
  }
}

export default async function AdminUsersPage() {
  await connection();
  const { admins, bans, feeWaivers, scanners } = await getInitialUsers();
  return (
    <AdminUsersClient
      initialAdmins={admins}
      initialBans={bans}
      initialFeeWaivers={feeWaivers}
      initialScanners={scanners}
    />
  );
}
