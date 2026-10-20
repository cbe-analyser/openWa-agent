import { z, type ZodTypeAny } from "zod";

/**
 * Converts the restricted JSON Schema subset accepted for configurable HTTP tools into Zod.
 * Supported: object with properties of type string (maxLength, enum, pattern), number, integer
 * (minimum, maximum) and boolean; `required`. Anything else is rejected at configuration time.
 */
export interface HttpToolSchema {
  type: "object";
  properties: Record<
    string,
    {
      type: "string" | "number" | "integer" | "boolean";
      description?: string;
      enum?: string[];
      maxLength?: number;
      pattern?: string;
      minimum?: number;
      maximum?: number;
    }
  >;
  required?: string[];
}

export const httpToolSchemaValidator = z.object({
  type: z.literal("object"),
  properties: z
    .record(
      z.string().regex(/^[a-z][a-z0-9_]{0,40}$/),
      z.object({
        type: z.enum(["string", "number", "integer", "boolean"]),
        description: z.string().max(300).optional(),
        enum: z.array(z.string().max(100)).max(50).optional(),
        maxLength: z.number().int().positive().max(2000).optional(),
        pattern: z.string().max(200).optional(),
        minimum: z.number().optional(),
        maximum: z.number().optional(),
      }),
    )
    .refine((p) => Object.keys(p).length <= 20, "At most 20 properties"),
  required: z.array(z.string()).optional(),
});

export function jsonSchemaToZod(schema: HttpToolSchema): ZodTypeAny {
  const shape: Record<string, ZodTypeAny> = {};
  const required = new Set(schema.required ?? []);
  for (const [key, prop] of Object.entries(schema.properties)) {
    let t: ZodTypeAny;
    if (prop.type === "string") {
      if (prop.enum?.length) t = z.enum(prop.enum as [string, ...string[]]);
      else {
        let s = z.string().max(prop.maxLength ?? 500);
        if (prop.pattern) s = s.regex(new RegExp(prop.pattern));
        t = s;
      }
    } else if (prop.type === "boolean") t = z.boolean();
    else {
      let n = prop.type === "integer" ? z.number().int() : z.number();
      if (prop.minimum !== undefined) n = n.min(prop.minimum);
      if (prop.maximum !== undefined) n = n.max(prop.maximum);
      t = n;
    }
    shape[key] = required.has(key) ? t : t.optional();
  }
  return z.object(shape).strict();
}
