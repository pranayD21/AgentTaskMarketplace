import fs from 'node:fs';
import os from 'node:os';
export interface ComputeSettings { cpu_threads:number;context_tokens:number;max_model_gb:number;model:string }
export function computeSettings(value:unknown={}):ComputeSettings {
 const v=value as Partial<ComputeSettings>,cores=Math.max(1,os.cpus().length);
 const result={cpu_threads:v.cpu_threads??Math.min(4,cores),context_tokens:v.context_tokens??8192,max_model_gb:v.max_model_gb??Math.max(1,Math.floor(os.totalmem()/1e9/2)),model:v.model??''};
 if(!Number.isInteger(result.cpu_threads)||result.cpu_threads<1||result.cpu_threads>cores||![2048,4096,8192,16384].includes(result.context_tokens)||!Number.isFinite(result.max_model_gb)||result.max_model_gb<1||result.max_model_gb>os.totalmem()/1e9||typeof result.model!=='string'||result.model.length>100)throw Error('Choose valid CPU, context and model size settings.');
 return result;
}
export function readCompute(file:string):ComputeSettings {return computeSettings(fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{});}
