import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, parseQuery, route } from "@/server/http/route";
import { createTicket, listTickets } from "@/server/services/tickets";

const priority = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);

export const GET = route({ auth: "any", permission: "tickets:read" }, async (req, { ctx }) =>
  listTickets(
    ctx,
    parseQuery(
      req,
      z.object({
        status: z.enum(["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"]).optional(),
        q: z.string().max(100).optional(),
        cursor: z.string().max(40).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      }),
    ),
  ),
);

export const POST = route(
  { auth: "any", permission: "tickets:write", idempotent: true, rateLimit: { limit: 120, windowSec: 60 } },
  async (req, { ctx }) => {
    const b = await parseJson(
      req,
      z.object({
        subject: z.string().trim().min(3).max(150),
        description: z.string().max(5000).optional(),
        category: z.string().max(50).optional(),
        priority: priority.optional(),
        conversationId: z.string().max(40).optional(),
        customerId: z.string().max(40).optional(),
      }),
    );
    return NextResponse.json(await createTicket(ctx, b), { status: 201 });
  },
);
