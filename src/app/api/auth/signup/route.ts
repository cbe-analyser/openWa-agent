import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route, verifyCsrf } from "@/server/http/route";
import { registerOwner } from "@/server/services/orgs";
import { createSession, sessionCookieName, sessionCookieOptions } from "@/server/auth/sessions";

const body = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(100),
  password: z.string().min(1).max(256),
  orgName: z.string().min(2).max(100),
});

export const POST = route(
  { auth: "public", rateLimit: { limit: 10, windowSec: 3600 } },
  async (req, { ip }) => {
    verifyCsrf(req);
    const input = await parseJson(req, body);
    const { user, org } = await registerOwner(input);
    const { token, session } = await createSession(user.id, org.id, ip, req.headers.get("user-agent"));
    const res = NextResponse.json(
      { user: { id: user.id, email: user.email }, organization: { id: org.id, name: org.name } },
      { status: 201 },
    );
    res.cookies.set(sessionCookieName(), token, sessionCookieOptions(session.expiresAt));
    return res;
  },
);
