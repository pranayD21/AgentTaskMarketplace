import {expect,it,vi} from 'vitest';
import {startLiveView} from '../src/viewer/server.js';
it('opens a task tab only after a successful claim, once per claim',async()=>{
 const openTab=vi.fn();const view=await startLiveView({port:0,open:'claim',role:'seller',runtime:'wassette',marketplaceUrl:'https://fixture/mcp',openTab});
 try{
  const vm=view.vmStarted({role:'seller',runtime:'wassette',wassette_version:'0.8',wasm_sha256:null,network:[],env:[]});expect(openTab).not.toHaveBeenCalled();
  view.emit({t:'net',phase:'start',id:'1',vm,call:'claim_task'});view.emit({t:'net',phase:'end',id:'1',vm,ok:false});expect(openTab).not.toHaveBeenCalled();
  for(const id of ['2','3']){view.emit({t:'net',phase:'start',id,vm,call:'claim_task'});view.emit({t:'net',phase:'end',id,vm,ok:true,res:{claim:{task_id:'task_x',claim_id:'claim_x'}}});}
  expect(openTab).toHaveBeenCalledExactlyOnceWith(`${view.url}/vm/${vm}?task=task_x`);
 }finally{await view.close();}
});
