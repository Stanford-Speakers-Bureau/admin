import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { generateReferralCode } from "./utils";

/**
 * Simple Supabase client for public data queries (bypasses RLS with service key)
 */
export function getSupabaseClient() {
  return createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );
}

export type Event = {
  id: string;
  created_at: string;
  name: string | null;
  desc: string | null;
  tagline: string | null;
  img: string | null;
  capacity: number;
  /**
   * Number of tickets sold so far.
   * (Newer schema field; fall back to `reserved` in older rows/clients.)
   */
  tickets?: number | null;
  venue: string | null;
  reserved: number | null;
  venue_link: string | null;
  release_date: string | null;
  ticketing_date?: string | null;
  banner: boolean | null;
  start_time_date: string | null;
  doors_open: string | null;
  route: string | null;
};

type UnauthorizedResult = {
  authorized: false;
  error: string;
};

type AuthorizedResult = {
  authorized: true;
  email: string;
  adminClient: ReturnType<typeof getSupabaseClient>;
};

export type AdminVerificationResult = UnauthorizedResult | AuthorizedResult;

/**
 * Verify that the current request is authenticated and belongs to an admin user.
 * Returns the admin client for privileged database access when authorized.
 */
export async function verifyAdminRequest(): Promise<AdminVerificationResult> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.email) {
    return { authorized: false, error: "Not authenticated" };
  }

  const adminClient = getSupabaseClient();
  const { data: adminRecord } = await adminClient
    .from("roles")
    .select("roles")
    .eq("email", user.email)
    .single();

  if (!adminRecord || !adminRecord.roles?.split(",").includes("admin")) {
    return { authorized: false, error: "Not authorized" };
  }

  return { authorized: true, email: user.email, adminClient };
}

/**
 * Create a Supabase client for use on the server (server components, API routes)
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Ignore - called from Server Component
          }
        },
      },
    },
  );
}

/**
 * Generate a signed URL for a speaker image from Supabase storage
 */
export async function getSignedImageUrl(
  imgName: string | null,
  expiresIn: number = 60,
): Promise<string | null> {
  if (!imgName) return null;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.storage
    .from("speakers")
    .createSignedUrl(imgName, expiresIn);

  if (error) {
    return null;
  }

  return data?.signedUrl || null;
}

/**
 * Generate a referral code from a user's email address.
 * Re-exported from utils.ts for backward compatibility.
 * @deprecated Import from "./utils" instead for use in Client Components.
 */
export { generateReferralCode };

/**
 * Calculates available public ticket capacity with unified logic
 *
 * Business Rules:
 * - Reserved slots are pre-allocated for VIP tickets
 * - VIP tickets don't count towards public capacity UNLESS they exceed reserved
 * - If VIPs <= reserved: public capacity = capacity - reserved
 * - If VIPs > reserved: public capacity = capacity - vipCount (overflow protection)
 * - Total tickets (VIP + public) can never exceed capacity
 *
 * @param eventId - The event UUID
 * @returns Detailed capacity information for displaying to users
 */
export async function getAvailablePublicTickets(eventId: string): Promise<{
  available: number; // How many public tickets can still be sold
  publicSold: number; // How many public tickets have been sold
  maxPublic: number; // Maximum public ticket capacity (accounting for VIP overflow)
  vipCount: number; // How many VIP tickets exist
  totalCapacity: number; // Total event capacity
  reserved: number; // Reserved slots for VIPs
}> {
  const adminClient = getSupabaseClient();

  // Get event capacity info
  const { data: event } = await adminClient
    .from("events")
    .select("capacity, reserved")
    .eq("id", eventId)
    .single();

  if (!event || !event.capacity) {
    return {
      available: 0,
      publicSold: 0,
      maxPublic: 0,
      vipCount: 0,
      totalCapacity: 0,
      reserved: 0,
    };
  }

  const capacity = event.capacity;
  const reserved = event.reserved ?? 0;

  // Get actual ticket counts from database
  const { vipCount, publicCount } = await getTicketCounts(eventId);

  // Calculate public capacity with VIP overflow protection
  // If VIPs exceed reserved, they start taking from public capacity
  let maxPublic: number;
  if (vipCount <= reserved) {
    // Normal case: VIPs fit within reserved allocation
    maxPublic = capacity - reserved;
  } else {
    // Overflow case: VIPs exceed reserved, reduce public capacity
    maxPublic = capacity - vipCount;
  }

  // Ensure maxPublic is non-negative
  maxPublic = Math.max(0, maxPublic);

  // Calculate available public tickets
  const available = Math.max(0, maxPublic - publicCount);

  return {
    available,
    publicSold: publicCount,
    maxPublic,
    vipCount,
    totalCapacity: capacity,
    reserved,
  };
}

/**
 * Check if an event is under capacity (has available public tickets)
 *
 * @param eventId - The event UUID
 * @returns True if there are available tickets or no capacity is set, false if sold out
 */
export async function isEventUnderCapacity(eventId: string): Promise<boolean> {
  const adminClient = getSupabaseClient();

  // Get event capacity info
  const { data: event } = await adminClient
    .from("events")
    .select("capacity")
    .eq("id", eventId)
    .single();

  // If no capacity is set, event is never "sold out"
  if (!event?.capacity) {
    return true;
  }

  const ticketInfo = await getAvailablePublicTickets(eventId);
  return ticketInfo.available > 0;
}

/**
 * Gets detailed ticket counts for an event
 * Separates VIP and public tickets for proper capacity management
 *
 * @param eventId - The event UUID
 * @returns Object with vipCount, publicCount, and totalCount
 */
export async function getTicketCounts(eventId: string): Promise<{
  vipCount: number;
  publicCount: number;
  totalCount: number;
}> {
  const adminClient = getSupabaseClient();

  // Count VIP tickets (admin-created only)
  const { count: vipCount } = await adminClient
    .from("tickets")
    .select("*", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("type", "VIP");

  // Count public tickets (STANDARD or null)
  const { count: publicCount } = await adminClient
    .from("tickets")
    .select("*", { count: "exact", head: true })
    .eq("event_id", eventId)
    .or("type.eq.STANDARD,type.eq.EXTERNAL,type.is.null");

  return {
    vipCount: vipCount ?? 0,
    publicCount: publicCount ?? 0,
    totalCount: (vipCount ?? 0) + (publicCount ?? 0),
  };
}
