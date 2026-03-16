import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { db, eq, events, roles, referrals } from "@ssb/db";
import type { InferSelectModel } from "@ssb/db";
import {
  getTicketCounts as _getTicketCounts,
  getAvailablePublicTickets as _getAvailablePublicTickets,
  isEventUnderCapacity as _isEventUnderCapacity,
} from "@ssb/db/queries";
import { generateReferralCode } from "./utils";

type DBEvent = InferSelectModel<typeof events>;

/**
 * Serialized event type used across the admin app.
 * Maps from DB Event (camelCase) to the snake_case string/number format the UI expects.
 */
export type Event = {
  id: string;
  created_at: string;
  name: string | null;
  desc: string | null;
  tagline: string | null;
  img: string | null;
  capacity: number;
  tickets?: number | null;
  venue: string | null;
  reserved: number | null;
  venue_link: string | null;
  release_date: string | null;
  ticketing_date?: string | null;
  start_time_date: string | null;
  doors_open: string | null;
  route: string | null;
  img_version?: number | null;
  live?: boolean;
  latitude?: number;
  longitude?: number;
  address?: string;
  waitlist_chance?: string | null;
  standby_enabled?: boolean | null;
  livestream?: string | null;
  priority?: string | null;
  hide_ticketing_date?: boolean;
  referrals_enabled?: boolean;
};

/**
 * Convert a DB Event to the serialized Event type used by the UI.
 */
export function serializeEvent(e: DBEvent): Event {
  return {
    id: e.id,
    created_at: e.createdAt.toISOString(),
    name: e.name,
    desc: e.desc,
    tagline: e.tagline,
    img: e.img,
    capacity: e.capacity,
    tickets: e.tickets,
    venue: e.venue,
    reserved: e.reserved,
    venue_link: e.venueLink,
    release_date: e.releaseDate?.toISOString() ?? null,
    ticketing_date: e.ticketingDate?.toISOString() ?? null,
    start_time_date: e.startTimeDate?.toISOString() ?? null,
    doors_open: e.doorsOpen?.toISOString() ?? null,
    route: e.route,
    img_version: e.imgVersion,
    live: e.live,
    latitude: Number(e.latitude),
    longitude: Number(e.longitude),
    address: e.address,
    waitlist_chance: e.waitlistChance ?? null,
    standby_enabled: e.standbyEnabled ?? null,
    livestream: e.livestream ?? null,
    priority: e.priority ?? null,
    hide_ticketing_date: e.hideTicketingDate ?? false,
    referrals_enabled: e.referralsEnabled ?? false,
  };
}

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
 * Supabase client for Auth and Storage operations only.
 * Database queries use Drizzle via @ssb/db.
 */
export function getSupabaseClient() {
  return createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );
}

/**
 * Verify that the current request is authenticated and belongs to an admin user.
 * Returns the admin client for privileged Storage/Auth access when authorized.
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

  const roleRecord = await db.query.roles.findFirst({
    where: eq(roles.email, user.email),
    columns: { roles: true },
  });

  if (!roleRecord || !roleRecord.roles?.split(",").includes("admin")) {
    return { authorized: false, error: "Not authorized" };
  }

  const adminClient = getSupabaseClient();
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

// Re-export shared query helpers from @ssb/db, bound to the singleton db client
export async function getTicketCounts(eventId: string) {
  return _getTicketCounts(db, eventId);
}

export async function getAvailablePublicTickets(eventId: string) {
  return _getAvailablePublicTickets(db, eventId);
}

export async function isEventUnderCapacity(eventId: string) {
  return _isEventUnderCapacity(db, eventId);
}
