import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { getEmbeddingConfig, updateEmbeddingConfig } from "@/server/services/settings";

export const GET = route({ auth: "session", permission: "settings:read" }, async (_req, { ctx }) =>
  getEmbeddingConfig(ctx),
);

export const PUT = route({ auth: "session", permission: "settings:write" }, async (req, { ctx }) =>
  updateEmbeddingConfig(
    ctx,
    await parseJson(
      req,
      z.object({
        kind: z.enum(["LOCAL_HASH", "OPENAI_COMPATIBLE", "OLLAMA"]),
        model: z.string().max(120).optional(),
        baseUrl: z.string().url().max(500).nullable().optional(),
        apiKey: z.string().max(500).nullable().optional(),
        dimensions: z.number().int().min(64).max(4096).optional(),
        minRelevance: z.number().min(0).max(1).optional(),
      }),
    ),
  ),
);
