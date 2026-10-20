import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { createProvider, listProviders } from "@/server/services/settings";
import { providerFields } from "../_lib/providerFields";

export const GET = route({ auth: "session", permission: "settings:read" }, async (_req, { ctx }) => ({
  items: await listProviders(ctx),
}));

export const POST = route({ auth: "session", permission: "settings:write" }, async (req, { ctx }) =>
  NextResponse.json(await createProvider(ctx, await parseJson(req, z.object(providerFields))), {
    status: 201,
  }),
);
