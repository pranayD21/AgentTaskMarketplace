import os from 'node:os';
/**
 * Compute given to the sandboxed worker. There is no user-facing allocation:
 * the seller lends the whole machine while selling, and the worker sizes its
 * Ollama calls from what the host actually has.
 */
export interface ComputeSettings { cpu_threads:number;context_tokens:number;max_model_gb:number;model:string }
export function autoCompute(machine:{cores?:number;totalBytes?:number}={}):ComputeSettings {
 const cores=Math.max(1,machine.cores??os.cpus().length),totalGb=(machine.totalBytes??os.totalmem())/1e9;
 // Larger context only when memory can hold the KV cache beside an 8B model.
 const context_tokens=totalGb>=48?32768:totalGb>=24?16384:8192;
 // Leave roughly a quarter of memory for the OS, Ollama's own overhead and the dashboard.
 const max_model_gb=Math.max(1,Math.floor(totalGb*0.75));
 return {cpu_threads:cores,context_tokens,max_model_gb,model:''};
}
