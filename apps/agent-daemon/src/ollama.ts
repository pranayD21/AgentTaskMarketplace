export interface OllamaModel { model_id: string; digest: string; size_gb: number }

export async function listOllamaModels(baseUrl: string): Promise<OllamaModel[]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!res.ok) throw new Error(`ollama /api/tags HTTP ${res.status}`);
  const json = (await res.json()) as { models?: { name: string; digest: string; size: number }[] };
  return (json.models ?? []).map((m) => ({ model_id: m.name, digest: m.digest, size_gb: Math.round((m.size / 1e9) * 10) / 10 }));
}
