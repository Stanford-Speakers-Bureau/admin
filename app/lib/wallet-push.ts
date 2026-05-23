import { db, inArray, tickets } from "@ssb/db";

const FUNCTION_NAME = "apns-push";

/**
 * Marks the given tickets as wallet-changed (bumps wallet_updated_at) and asks
 * the APNs edge function to push a refresh to every device registered for them.
 *
 * Best-effort: this never throws into the calling mutation. A failed or
 * unconfigured push must not fail the underlying admin action — the pass will
 * still pick up the change the next time the device polls the web service.
 */
export async function pushWalletUpdate(ticketIds: string[]): Promise<void> {
  const ids = ticketIds.filter(Boolean);
  if (ids.length === 0) return;

  try {
    await db
      .update(tickets)
      .set({ walletUpdatedAt: new Date() })
      .where(inArray(tickets.id, ids));
  } catch (e) {
    // If we can't even record the change, there's nothing to push.
    console.error("[wallet-push] failed to bump wallet_updated_at:", e);
    return;
  }

  const base = process.env.SUPABASE_URL;
  const secret = process.env.WALLET_PUSH_SECRET;
  const apiKey = process.env.SUPABASE_KEY;
  if (!base || !secret) {
    console.warn(
      "[wallet-push] SUPABASE_URL or WALLET_PUSH_SECRET unset; skipping push",
    );
    return;
  }

  try {
    const res = await fetch(`${base}/functions/v1/${FUNCTION_NAME}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-wallet-push-secret": secret,
        ...(apiKey ? { authorization: `Bearer ${apiKey}`, apikey: apiKey } : {}),
      },
      body: JSON.stringify({ serialNumbers: ids }),
    });
    if (!res.ok) {
      console.error(
        `[wallet-push] edge function ${res.status}: ${await res.text()}`,
      );
    }
  } catch (e) {
    console.error("[wallet-push] edge function invocation failed:", e);
  }
}
