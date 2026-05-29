import { NextRequest, NextResponse } from "next/server";
import { requireActionAnyScope } from "@/app/lib/permissions";
import { buildEventImageToken } from "@/app/lib/image-links";
import { isValidUUID } from "@/app/lib/validation";

type Params = { params: Promise<{ id: string }> };

/**
 * Campaign-editor image preview. The web app serves event images at
 * `/api/images/{eventId}`, but unreleased ("mystery") events 404 unless the
 * request carries a signed token — which can only be minted server-side. The
 * live preview can't build that token in the browser, so it points its <img>
 * at this admin route, which mints the token and redirects to the real web
 * image. Gated on `campaigns.send` so it grants no more visibility than the
 * campaign editor (and the emails it produces) already do.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!isValidUUID(id)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const auth = await requireActionAnyScope("campaigns.send");
  if (!auth.authorized) {
    return new NextResponse(auth.error ?? "Not authorized", { status: 401 });
  }

  const base =
    process.env.NEXT_PUBLIC_BASE_URL || "https://stanfordspeakersbureau.com";
  const requestUrl = new URL(request.url);
  const target = new URL(`/api/images/${id}`, base);
  target.searchParams.set("v", requestUrl.searchParams.get("v") || "1");
  if (requestUrl.searchParams.get("variant") === "mobile") {
    target.searchParams.set("variant", "mobile");
  }
  target.searchParams.set("t", buildEventImageToken(id));

  return NextResponse.redirect(target.toString());
}
