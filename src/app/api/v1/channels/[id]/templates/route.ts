import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { channelTemplates, createChannelTemplate } from "@/server/services/settings";

type P = { id: string };

export const GET = route<P>({ auth: "any", permission: "settings:read" }, async (_req, { ctx, params }) => ({
  items: await channelTemplates(ctx, params.id),
}));

/** Submits a new message template to Meta for review (WhatsApp Cloud channels only). */
export const POST = route<P>(
  { auth: "session", permission: "settings:write" },
  async (req, { ctx, params }) => {
    const b = await parseJson(
      req,
      z.object({
        name: z.string().regex(/^[a-z0-9_]{1,512}$/),
        language: z.string().min(2).max(15),
        category: z.enum(["UTILITY", "MARKETING", "AUTHENTICATION"]),
        body: z.string().min(1).max(1024),
      }),
    );
    return NextResponse.json(await createChannelTemplate(ctx, params.id, b), { status: 201 });
  },
);
