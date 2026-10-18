/* Shared by the dashboard and the authenticated per-task tab. Text is never HTML. */
function renderTaskCards(parent,run,onlyId){
 const labels={OPEN:'Waiting for a worker',PAYLOAD_READY:'Worker accepted',CLAIMED:'Worker accepted',RUNNING:'Worker is working',SUBMITTED:'Output received · awaiting review',JUDGING:'Output received · review in progress',APPROVED:'✓ Completed · approved',REJECTED:'Review rejected this output',EXPIRED:'Expired',CANCELLED:'Cancelled'};
 for(const [index,id] of (run.task_ids??[]).entries()){
  if(onlyId&&id!==onlyId)continue;
  const events=run.events??[],task=events.filter(e=>e.type==='task_status'&&e.task?.task_id===id).at(-1)?.task??{};
  const answer=events.filter(e=>['remote_answer','remote_preview'].includes(e.type)&&e.task_id===id).at(-1);
  const card=document.createElement('article');card.className='task-result';
  const title=document.createElement('h3');title.textContent=`Task ${index+1} · ${labels[task.status]??task.status??'Posting'}`;
  const meta=document.createElement('p');meta.textContent=`${id}${task.seller_id?' · Worker '+task.seller_id:''}${task.model_id?' · '+task.model_id:''}`;
  const link=document.createElement('a');link.href='/task.html?task='+encodeURIComponent(id);link.target='_blank';link.rel='noopener';link.textContent='Open task viewer ↗';
  card.append(title,meta,link);
  const prompt=run.task_prompts?.[id];
  if(prompt){const details=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('pre');details.open=true;summary.textContent='Worker task prompt';text.textContent=prompt;details.append(summary,text);card.append(details);}
  const heading=document.createElement('h4');heading.textContent=task.status==='APPROVED'?'Final output':'Submitted output';card.append(heading);
  const output=document.createElement('pre');output.className='task-output';output.textContent=answer?.answer??(['SUBMITTED','JUDGING','APPROVED','REJECTED'].includes(task.status)?'Retrieving the worker’s output…':'No output yet. This updates automatically.');card.append(output);
  const note=document.createElement('p');note.className='task-review';note.textContent=task.status==='APPROVED'?'Completion-format check passed. This does not verify answer correctness.':task.status==='REJECTED'?'This output failed review; it is not an approved result.':answer?'Awaiting review. This is the worker’s submitted output, not an approved result.':'The worker will submit its output when inference finishes.';card.append(note);
  if(answer){const copy=document.createElement('button');copy.type='button';copy.className='secondary';copy.textContent='Copy output';copy.onclick=async()=>{try{await navigator.clipboard.writeText(answer.answer);copy.textContent='Copied';}catch{copy.textContent='Select the output above to copy';}};card.append(copy);}
  parent.append(card);
 }
}
