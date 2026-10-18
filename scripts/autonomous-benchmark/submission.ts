import fs from "node:fs";
import path from "node:path";
import type { AgentTool } from "../../apps/agent-daemon/src/buyer-agent.ts";

export interface Submission { file: string; source_task_id: string | null; at: string }
export function submissionTools(options: {
  network: boolean; dir: string; taskIds: string[];
  submitted: Map<string, Submission>; cached: Map<string, any>;
}): AgentTool[] {
  const idSchema = { type: "array", items: { type: "string" }, minItems: 1 };
  function save(ids: unknown, code: unknown, sourceTaskId: string | null) {
    if (!Array.isArray(ids) || !ids.length || ids.some(id => !options.taskIds.includes(id))) throw new Error("Unknown task_ids");
    if (typeof code !== "string" || !code.trim() || code.length > 100000) throw new Error("Complete Python source required");
    for (const id of ids) {
      const file = path.join(options.dir, `${id.replace("/", "-")}.py`);
      fs.writeFileSync(file, code, { mode: 0o600 });
      options.submitted.set(id, { file, source_task_id: sourceTaskId, at: new Date().toISOString() });
    }
    return { saved: ids, missing: options.taskIds.filter(id => !options.submitted.has(id)) };
  }
  const tools: AgentTool[] = [{ name: "submit_solution",
    description: "Save your final Python source for one or more task_ids. Include all necessary imports and supplied helper functions. No hidden-test feedback is returned. A later submission replaces the earlier one before the deadline.",
    parameters: { type: "object", properties: { task_ids: idSchema, code: { type: "string" } }, required: ["task_ids", "code"], additionalProperties: false },
    async invoke(args) { return save(args.task_ids, args.code, null); },
  }];
  if (options.network) tools.push({ name: "submit_remote_solution",
    description: "Save the Python answer from a marketplace task for one or more task_ids without retyping it. First retrieve an APPROVED, commitment-verified result with mcp_get_result. Functional correctness is still untested.",
    parameters: { type: "object", properties: { task_ids: idSchema, source_task_id: { type: "string" } }, required: ["task_ids", "source_task_id"], additionalProperties: false },
    async invoke(args) {
      const result = options.cached.get(String(args.source_task_id));
      if (result?.task?.status !== "APPROVED" || result?.result?.commitment_verified !== true) throw new Error("First retrieve an APPROVED commitment-verified result");
      return save(args.task_ids, result.result.answer, String(args.source_task_id));
    },
  });
  return tools;
}
