import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { createChannel, listChannels } from "@/server/services/settings";

export const GET = route({ auth: "session", permission: "settings:read" }, async (_req, { ctx }) => ({
  items: await listChannels(ctx),
}));

export const POST = route({ auth: "session", permission: "settings:write" }, async (req, { ctx }) => {
  const b = await parseJson(
    req,
    z.object({
      kind: z.enum(["WHATSAPP_CLOUD", "SIMULATOR"]),
      name: z.string().min(1).max(60),
      phoneNumberId: z
        .string()
        .regex(/^\d{5,30}$/)
        .optional(),
      wabaId: z
        .string()
        .regex(/^\d{5,30}$/)
        .optional(),
      displayPhoneNumber: z.string().max(30).optional(),
      apiVersion: z
        .string()
        .regex(/^v\d{1,3}\.\d$/)
        .optional(),
      accessToken: z.string().min(20).max(1000).optional(),
      appSecret: z.string().min(16).max(200).optional(),
      verifyToken: z.string().min(16).max(200).optional(),
    }),
  );
  return NextResponse.json(await createChannel(ctx, b), { status: 201 });
});
