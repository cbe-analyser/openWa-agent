import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { changePassword } from "@/server/services/auth";

const body = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
});

export const POST = route(
  { auth: "session", rateLimit: { limit: 10, windowSec: 3600 } },
  async (req, { ctx }) => {
    const b = await parseJson(req, body);
    await changePassword(ctx, b.currentPassword, b.newPassword);
    return { ok: true };
  },
);
