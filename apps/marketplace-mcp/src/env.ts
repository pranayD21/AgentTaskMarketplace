import { z } from "zod";

const AppEnvSchema = z.object({
  // memory = in-process tables built from db/schema.sql: tests and offline
  // development only, lost on restart, labelled in /health and marketplace_info.
  DB_MODE: z.enum(["insforge", "memory"]).default("insforge"),
  INSFORGE_BASE_URL: z.string().url().optional(),
  INSFORGE_API_KEY: z.string().min(10).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PROFILE_ID: z.string().optional(),
  MPP_SECRET_KEY: z.preprocess((v) => v === "" ? undefined : v, z.string().min(32).optional()),
  PAYMENT_MODE: z.enum(["card", "mpp", "mock"]).default("card"),
  INKBOX_API_KEY: z.string().optional(),
  SERVER_KEK_B64: z.string().min(40),
  JUDGE_PUBLIC_KEY_B64: z.string().min(40),
  JUDGE_KEY_ID: z.string().default("judge-1"),
  JUDGE_REGISTRATION_SECRET: z.string().min(8),
  BASE_URL: z.string().optional(),
  MCP_URL: z.string().optional(),
  SUSPEND_AFTER_STRIKES: z.coerce.number().int().positive().default(1),
  DEFAULT_SPEND_CAP_CENTS: z.coerce.number().int().positive().default(2000),
});

export type AppEnv = z.infer<typeof AppEnvSchema> & { baseUrl: string };

let cached: AppEnv | undefined;

export function env(): AppEnv {
  if (cached) return cached;
  const parsed = AppEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid environment: ${problems}`);
  }
  const e = parsed.data;
  if (e.DB_MODE === "insforge" && (!e.INSFORGE_BASE_URL || !e.INSFORGE_API_KEY)) {
    throw new Error("INSFORGE_BASE_URL and INSFORGE_API_KEY are required unless DB_MODE=memory");
  }
  if (e.PAYMENT_MODE !== "mock" && !e.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is required unless PAYMENT_MODE=mock");
  }
  if (e.PAYMENT_MODE === "mpp" && !e.STRIPE_PROFILE_ID) {
    throw new Error("STRIPE_PROFILE_ID is required for PAYMENT_MODE=mpp");
  }
  // Manufact injects MCP_URL (…/mcp); derive the public base URL from it.
  const baseUrl = e.BASE_URL ?? (e.MCP_URL ? e.MCP_URL.replace(/\/mcp\/?$/, "") : "http://localhost:3000");
  cached = { ...e, baseUrl };
  return cached;
}
