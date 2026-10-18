/** A local model chooses every action. The host only dispatches declared tools. */
export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  invoke(args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
}
export interface ToolCall { function: { name: string; arguments: Record<string, unknown> } }
export interface ChatMessage {
  role: string; content: string; thinking?:string; tool_name?: string; tool_calls?: ToolCall[];
}
export interface AgentEvent { type: string; at: string; [key: string]: unknown }

type ParsedAction={action:'final';answer:string}|{action:'tool';tool:string;arguments:Record<string,unknown>};
const latexCommands = new Set(['frac','text','times','begin','end','right','left','nabla','beta','theta','rho','alpha','gamma','delta','epsilon','lambda','mu','pi','sigma','phi','omega','sum','int','partial','cdot','cdots','ldots','mathbb','mathrm','mathbf','overline','underline','sqrt','hat','vec','rightarrow','infty','leq','geq','neq','approx','tan','sin','cos','log','ln','lim','operatorname','displaystyle']);
/** A model may put single LaTeX backslashes into its JSON action. Keep JSON escapes intact while preserving TeX commands. */
function preserveLatexInAction(json:string):string{
  let out='',quoted=false;
  for(let i=0;i<json.length;i++){
    const c=json[i]!;
    if(c==='"'){quoted=!quoted;out+=c;continue;}
    if(!quoted||c!=='\\'){out+=c;continue;}
    const next=json[i+1];
    if(next==='\\'||next==='"'||next==='/'){out+=c+next;i++;continue;}
    const word=/^[A-Za-z]+/.exec(json.slice(i+1))?.[0];
    const validJsonEscape=next==='b'||next==='f'||next==='n'||next==='r'||next==='t'||(next==='u'&&/^[a-fA-F0-9]{4}$/.test(json.slice(i+2,i+6)));
    out+=word&&latexCommands.has(word)||!validJsonEscape?'\\\\':'\\';
  }
  return out;
}
/** Reads a structured action, tolerating code fences or prose around the JSON. Anything else asks for a repair. */
export function parseAction(text:string):ParsedAction|null{
  const candidates=[text];
  const fenced=/```(?:json)?\s*([\s\S]*?)```/i.exec(text);if(fenced?.[1])candidates.push(fenced[1].trim());
  const first=text.indexOf('{'),last=text.lastIndexOf('}');if(first>=0&&last>first)candidates.push(text.slice(first,last+1));
  for(const candidate of candidates){
    try{
      const action=JSON.parse(preserveLatexInAction(candidate));
      if(action&&action.action==='final'&&typeof action.answer==='string'&&action.answer.trim())return {action:'final',answer:action.answer};
      if(action&&action.action==='tool'&&typeof action.tool==='string'&&action.arguments&&typeof action.arguments==='object'&&!Array.isArray(action.arguments))return {action:'tool',tool:action.tool,arguments:action.arguments};
    }catch{/* try the next form */}
  }
  return null;
}
export async function runBuyerAgent(options: {
  model: string; ollamaUrl: string; system: string; prompt: string; history?: ChatMessage[];
  tools: AgentTool[]; signal: AbortSignal; deadline: number;
  onEvent(event: AgentEvent): void; isComplete(): boolean;
  fetchImpl?: typeof fetch;
  thinking?:boolean|string;stream?:boolean;
  structuredActions?:boolean;
  onIdle?():Promise<ChatMessage[]|null>;
  /** Called before every model turn; returned messages (asynchronous results) are appended without waiting. */
  beforeTurn?():ChatMessage[]|null;
  /** True while delegated work is still outstanding; an empty model turn then means "waiting", not "no action". */
  hasPendingWork?():boolean;
  acquireModel?(signal:AbortSignal):Promise<()=>void>;
}) {
  const messages: ChatMessage[] = [
    { role: "system", content: options.system }, ...(options.history ?? []), { role: "user", content: options.prompt },
  ];
  const emit = (type: string, data: Record<string, unknown>) => options.onEvent({ type, at: new Date().toISOString(), ...data });
  const tools = options.tools.map(({ name, description, parameters }) => ({ type: "function", function: { name, description, parameters } }));
  const actionSchema={oneOf:[
    ...options.tools.map(tool=>({type:'object',properties:{action:{const:'tool'},tool:{const:tool.name},arguments:tool.parameters},required:['action','tool','arguments'],additionalProperties:false})),
    {type:'object',properties:{action:{const:'final'},answer:{type:'string',minLength:1}},required:['action','answer'],additionalProperties:false},
  ]};
  if(options.structuredActions)messages[0]!.content+='\nChoose exactly one action per turn. Return JSON matching this schema: '+JSON.stringify(actionSchema)+
    '\nTools: '+JSON.stringify(options.tools.map(t=>({name:t.name,description:t.description})))+
    '\nExample shape for a tool: {"action":"tool","tool":"NAME_FROM_SCHEMA","arguments":{}}. For a completed answer or a necessary clarification question: {"action":"final","answer":"Your response"}. Never invent tool results. After each result, assess what remains, take another action if useful, and finish only when you can answer or clearly explain the remaining blocker. No reasoning trace is required.';
  const fetcher = options.fetchImpl ?? fetch;
  let malformedActions=0;
  let consecutiveToolErrors=0;
  for (let turn = 0; turn < 100 && !options.isComplete(); turn++) {
    options.signal.throwIfAborted();
    const arrived=options.beforeTurn?.();if(arrived?.length)messages.push(...arrived);
    const started = Date.now();
    const release=await options.acquireModel?.(options.signal);
    let data:any;
    try {
    const response = await fetcher(`${options.ollamaUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST", redirect: "error", signal: options.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: options.model, messages, ...(options.structuredActions?{format:actionSchema}:{tools}), stream: options.stream??false, ...(options.thinking===undefined?{}:{think:options.thinking}),
        options: { temperature: 0, seed: 42, num_ctx: 16384, num_predict: 4096 } }),
    });
    if (!response.ok) throw new Error(`Local model HTTP ${response.status}`);
    if(response.headers.get('content-type')?.includes('application/x-ndjson')&&response.body){
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
      const message:ChatMessage={role:'assistant',content:'',thinking:'',tool_calls:[]};
      const take=(line:string)=>{if(!line.trim())return;const chunk=JSON.parse(line);if(chunk.error)throw Error(String(chunk.error));data=chunk;
        message.content+=chunk.message?.content??'';message.thinking+=chunk.message?.thinking??'';
        if(chunk.message?.tool_calls)message.tool_calls!.push(...chunk.message.tool_calls);
        if(!options.structuredActions)emit('model_delta',{turn,content:message.content,thinking:message.thinking,duration_ms:Date.now()-started});};
      for(;;){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let n;while((n=buffer.indexOf('\n'))>=0){take(buffer.slice(0,n));buffer=buffer.slice(n+1);}}
      take(buffer);data={...data,message};
    }else data=await response.json();
    } finally {release?.();}
    if (data.message?.role !== "assistant") throw new Error("Missing local assistant response");
    const rawMessage=data.message;
    if(options.structuredActions){
      const text=String(rawMessage.content??'').trim();
      // Some models (gpt-oss) reason and then stop without a message when they believe there is
      // nothing to do yet. That is an idle turn, not a malformed action: hand it to the idle hook.
      if(!text&&options.hasPendingWork?.()){
        data.message={role:'assistant',content:''};
        emit('idle_turn',{turn,reason:String(rawMessage.thinking??'').trim().slice(0,200)||'The model returned no action.'});
      }else if(!text){
        // Reasoned, then said nothing, with no work outstanding: ask for the action it decided on.
        if(++malformedActions>=3)throw Error('Repeated tool errors: model could not produce a valid action.');
        emit('action_error',{turn,error:'The model returned no action; asking it to act.',sample:String(rawMessage.thinking??'').trim().slice(0,200)});
        messages.push(rawMessage,{role:'user',content:'You reasoned but returned no action. Output the JSON action you decided on now: a tool action, or a final answer.'});continue;
      }else{
        const action=parseAction(text);
        if(action&&action.action==='final')data.message={role:'assistant',content:action.answer};
        else if(action&&action.action==='tool')data.message={role:'assistant',content:'',tool_calls:[{function:{name:action.tool,arguments:action.arguments}}]};
        else{
          if(++malformedActions>=3)throw Error('Repeated tool errors: model could not produce a valid action.');
          emit('action_error',{turn,error:'Invalid action format; asking the model to repair it.',sample:text.slice(0,200)});
          messages.push({role:'user',content:'Your response was not a valid action. Return only a tool action or final answer matching the provided JSON schema.'});continue;
        }
        malformedActions=0;
      }
    }
    messages.push(rawMessage);
    emit("model", { turn, duration_ms: Date.now() - started, input_tokens: data.prompt_eval_count ?? null,
      output_tokens: data.eval_count ?? null, load_ms: data.load_duration === undefined ? null : data.load_duration / 1e6, message: data.message });
    const calls = data.message.tool_calls ?? [];
    if (!calls.length) { const updates=await options.onIdle?.();if(updates?.length){messages.push(...updates);continue;}emit("stopped", { reason: "model_finished", complete: options.isComplete() }); return; }
    // Sequential dispatch makes authorization/budget accounting atomic. The posted jobs
    // execute asynchronously on general workers; the model can continue local work.
    for (const call of calls) {
      options.signal.throwIfAborted();
      const tool = options.tools.find((t) => t.name === call.function.name);
      emit("tool_call", { turn, name: call.function.name, arguments: call.function.arguments });
      let result: unknown;
      try {
        if (!tool) throw new Error("Unknown or unavailable tool");
        result = await tool.invoke(call.function.arguments, options.signal);
      } catch (error) {
        if (options.signal.aborted) throw error;
        result = { error: error instanceof Error ? error.message : String(error) };
      }
      emit("tool_result", { turn, name: call.function.name, result });
      consecutiveToolErrors=(result as any)?.error?consecutiveToolErrors+1:0;
      if(consecutiveToolErrors>=6)throw Error('Repeated tool errors prevented progress. Review the tool results before retrying.');
      messages.push({ role: options.structuredActions?"user":"tool", ...(options.structuredActions?{}:{tool_name:call.function.name}),
        content: JSON.stringify({ tool:call.function.name, result, remaining_seconds: Math.max(0, Math.floor((options.deadline - Date.now()) / 1000)) }) });
      if (options.isComplete()) break;
    }
  }
  emit("stopped", { reason: options.isComplete() ? "all_submitted" : "turn_limit", complete: options.isComplete() });
}
