import { CONTRACT_VERSION } from "@atm/shared";

export async function requireCompatibleRelease(marketplaceUrl: string): Promise<void> {
  const url = new URL("/api/seller-release", marketplaceUrl);
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "error" });
  if (!response.ok) throw new Error("SELLER_RELEASE_UNAVAILABLE");
  const release = await response.json() as { contract_version?: string; seller_protocol?: number };
  if (release.contract_version !== CONTRACT_VERSION || release.seller_protocol !== 1) throw new Error("SELLER_UPDATE_REQUIRED");
}
