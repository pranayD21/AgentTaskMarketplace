import { CONTRACT_VERSION } from "@atm/shared";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
let runnerHash: string | undefined;

export async function requireCompatibleRelease(marketplaceUrl: string): Promise<void> {
  const url = new URL("/api/seller-release", marketplaceUrl);
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "error" });
  if (!response.ok) throw new Error("SELLER_RELEASE_UNAVAILABLE");
  const release = await response.json() as { contract_version?: string; seller_protocol?: number; artifacts?: Record<string, { sha256: string }> };
  if (release.contract_version !== CONTRACT_VERSION || release.seller_protocol !== 1) throw new Error("SELLER_UPDATE_REQUIRED");
  if (process.env.ATM_APP_ROOT) {
    runnerHash ??= createHash("sha256").update(fs.readFileSync(path.join(process.env.ATM_APP_ROOT, "packages/runner-wasm/dist/runner.wasm"))).digest("hex");
    if (release.artifacts?.["runner.wasm"]?.sha256 !== runnerHash) throw new Error("SELLER_UPDATE_REQUIRED");
  }
}
