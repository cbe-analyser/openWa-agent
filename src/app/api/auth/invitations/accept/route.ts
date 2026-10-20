import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route, verifyCsrf } from "@/server/http/route";
import { acceptInvitation } from "@/server/services/auth";
import { sessionCookieName, sessionCookieOptions } from "@/server/auth/sessions";

const body = z.object({
  token: z.string().min(10).max(200),
  name: z.string().min(1).max(100),
  password: z.string().min(1).max(256),
});

export const POST = route(
  { auth: "public", rateLimit: { limit: 20, windowSec: 3600 } },
  async (req, { ip }) => {
    verifyCsrf(req);
    const input = await parseJson(req, body);
    const { token, session } = await acceptInvitation(input.token, input, ip, req.headers.get("user-agent"));
    const res = NextResponse.json({ ok: true });
    res.cookies.set(sessionCookieName(), token, sessionCookieOptions(session.expiresAt));
    return res;
  },
);
