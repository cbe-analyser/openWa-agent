import { NextResponse } from "next/server";
import { route } from "@/server/http/route";
import { systemHealth } from "@/server/services/analytics";

export const dynamic = "force-dynamic";

/** Unauthenticated liveness/readiness probe (reveals no tenant data). */
export const GET = route({ auth: "public" }, async () => {
  const h = await systemHealth(null);
  return NextResponse.json(h, { status: h.status === "ok" ? 200 : 503 });
});
