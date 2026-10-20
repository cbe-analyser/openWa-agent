import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { buildOpenApi } from "@/server/openapi";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(buildOpenApi(env().APP_URL));
}
