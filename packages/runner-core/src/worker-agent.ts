/** Bounded tools inside the Wasm component. No shell, filesystem, or extra network grants. */
export const workerTools = [
 {type:'function',function:{name:'calculate',description:'Calculate a numeric sum, product, difference, or quotient accurately.',parameters:{type:'object',properties:{operation:{type:'string',enum:['sum','product','difference','quotient']},values:{type:'array',items:{type:'number'}}},required:['operation','values']}}},
 {type:'function',function:{name:'inspect_text',description:'Count characters, words, lines, and exact occurrences of text in supplied material.',parameters:{type:'object',properties:{text:{type:'string'},find:{type:'string'}},required:['text']}}},
 {type:'function',function:{name:'scratchpad',description:'Save or retrieve a working note during this task. Notes are private to this sandbox task.',parameters:{type:'object',properties:{key:{type:'string'},value:{type:'string'}},required:['key']}}},
];
export function invokeWorkerTool(name:string,args:any,notes:Map<string,string>):unknown{
 if(name==='calculate'){
  const v=args.values;if(!Array.isArray(v)||!v.length||v.length>100||!v.every(x=>typeof x==='number'&&Number.isFinite(x)))throw Error('Provide 1–100 finite numbers.');
  const result=args.operation==='sum'?v.reduce((a,b)=>a+b,0):args.operation==='product'?v.reduce((a,b)=>a*b,1):args.operation==='difference'?v.slice(1).reduce((a,b)=>a-b,v[0]):args.operation==='quotient'?v.slice(1).reduce((a,b)=>a/b,v[0]):NaN;
  if(!Number.isFinite(result))throw Error('Invalid operation or nonfinite result.');return {result,precision:'IEEE-754; use integer cents for exact small currency totals'};
 }
 if(name==='inspect_text'){
  if(typeof args.text!=='string'||args.text.length>20000)throw Error('Text must be at most 20000 characters.');
  return {characters:args.text.length,words:args.text.trim()?args.text.trim().split(/\s+/).length:0,lines:args.text.split('\n').length,...(typeof args.find==='string'&&args.find?{occurrences:args.text.split(args.find).length-1}:{})};
 }
 if(name==='scratchpad'){
  if(typeof args.key!=='string'||args.key.length>80)throw Error('Invalid note key.');
  if(args.value!==undefined){if(typeof args.value!=='string'||args.value.length>4000||notes.size>=8&&!notes.has(args.key))throw Error('Scratchpad limit reached.');notes.set(args.key,args.value);}
  return {key:args.key,value:notes.get(args.key)??null};
 }
 throw Error('Tool is unavailable in this sandbox.');
}
