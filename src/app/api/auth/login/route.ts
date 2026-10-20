import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { login } from "@/server/services/auth";
import { sessionCookieName, sessionCookieOptions } from "@/server/auth/sessions";
import { verifyCsrf } from "@/server/http/route";

const body = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) });

export const POST = route(
  { auth: "public", rateLimit: { limit: 30, windowSec: 300 } },
  async (req, { ip }) => {
    verifyCsrf(req);
    const { email, password } = await parseJson(req, body);
    const { token, session, user } = await login(email, password, ip, req.headers.get("user-agent"));
    const res = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } });
    res.cookies.set(sessionCookieName(), token, sessionCookieOptions(session.expiresAt));
    return res;
  },
);
