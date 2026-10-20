import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { notFound } from "@/server/errors";
import { decideToolExecution } from "@/server/tools/executor";

/** Approve or reject a pending high-impact tool call. Session only: a human must decide. */
export const POST = route<{ id: string }>(
  { auth: "session", permission: "conversations:write" },
  async (req, { ctx, params }) => {
    const { approve } = await parseJson(req, z.object({ approve: z.boolean() }));
    const outcome = await decideToolExecution(ctx.orgId, params.id, approve, ctx.userId);
    if (approve && !outcome) throw notFound("Pending tool execution");
    return { decided: true, outcome };
  },
);
