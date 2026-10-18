const taskId=new URLSearchParams(location.search).get('task');let loading=false,snapshot='';
async function refreshTask(){if(loading)return;loading=true;try{
 const response=await fetch('/api/chat');if(!response.ok)throw Error(response.status===401?'Open the dashboard with atm-seller dashboard, then select Open task viewer.':'Connection interrupted; retrying.');
 const {runs}=await response.json();const run=runs.find(r=>r.task_ids.includes(taskId));if(!run)throw Error('This task is not in the signed-in account’s local history.');
 document.getElementById('viewer-status').textContent='Live · updates every 3 seconds';const next=JSON.stringify(run);if(next!==snapshot){snapshot=next;const root=document.getElementById('task-results');root.replaceChildren();renderTaskCards(root,run,taskId);}
 }catch(error){document.getElementById('viewer-status').textContent=error.message;}finally{loading=false;}}
void refreshTask();setInterval(refreshTask,3000);
