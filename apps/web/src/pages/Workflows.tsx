import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Github, Play, Search } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { AutoRefreshToast, PageHeader, RefreshButton, Skeleton, Status, useRefresh } from '../components/UI';

type Repository={id:string;full_name:string;private:number;default_branch:string;updated_at:string};
type ReviewerSettings={workflowId:string|null;repositoryId:string;repository:string;enabled:boolean;branches:string[];responseFormat:'concise'|'detailed';focus:'balanced'|'correctness'|'security';commentMode:'always'|'issues_only'};

export function Workflows(){
  const [search,setSearch]=useState('');
  const [params,setParams]=useSearchParams();
  const repositories=useQuery({queryKey:['repositories'],queryFn:()=>api<Repository[]>('/api/github/repositories')});
  const sorted=[...(repositories.data??[])].sort((a,b)=>new Date(b.updated_at).getTime()-new Date(a.updated_at).getTime()||a.full_name.localeCompare(b.full_name));
  const visible=sorted.filter((repository)=>repository.full_name.toLowerCase().includes(search.trim().toLowerCase()));
  const selectedRepositoryId=params.get('repository')??undefined;
  const repository=sorted.find((item)=>item.id===selectedRepositoryId)??sorted[0];
  const select=(id:string)=>setParams(id===sorted[0]?.id?{}:{repository:id},{replace:true});
  const {refresh,isManual,isAuto}=useRefresh(repositories.refetch,repositories.isFetching,repositories.isLoading);
  return <div className="page workflows-page">
    <PageHeader eyebrow="AI CODE REVIEW" title="Repository reviews" description="Turn on automatic AI reviews for pull requests in your repositories." action={<RefreshButton isRefreshing={isManual} onRefresh={refresh}/>}/>
    <AutoRefreshToast active={isAuto}/>
    <div className="workflows-layout">
      <aside className="panel repository-sidebar"><header><div><h2>Repositories</h2><p>{sorted.length} available · recently updated first</p></div></header><label className="repository-search"><Search size={14}/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search repositories…"/></label>{repositories.isLoading?<Skeleton rows={5}/>:visible.length?<div className="repository-list">{visible.map((item)=><button type="button" className={repository?.id===item.id?'active':''} key={item.id} onClick={()=>select(item.id)}><Github size={15}/><span><b>{item.full_name}</b><small>{item.private?'Private':'Public'} · Updated {new Date(item.updated_at).toLocaleDateString()}</small></span></button>)}</div>:<div className="repository-empty"><p>{sorted.length?'No matching repositories.':'No repositories connected.'}</p>{!sorted.length&&<Link className="button" to="/integrations">Connect GitHub</Link>}</div>}{repositories.error&&<p className="error-text panel-message">{repositories.error.message}</p>}</aside>
      {repository?<ReviewerPanel key={repository.id} repository={repository}/>:<section className="panel reviewer-panel"><div className="repository-empty"><Bot/><h2>Select a repository</h2><p>Connect GitHub to enable AI pull-request reviews.</p></div></section>}
    </div>
  </div>;
}

function ReviewerPanel({repository}:{repository:Repository}){
  const navigate=useNavigate();
  const client=useQueryClient();
  const reviewer=useQuery({queryKey:['repository-reviewer',repository.id],queryFn:()=>api<ReviewerSettings>(`/api/repositories/${repository.id}/reviewer`)});
  const [enabled,setEnabled]=useState(false);
  const [branches,setBranches]=useState(repository.default_branch);
  const [responseFormat,setResponseFormat]=useState<ReviewerSettings['responseFormat']>('detailed');
  const [focus,setFocus]=useState<ReviewerSettings['focus']>('balanced');
  const [commentMode,setCommentMode]=useState<ReviewerSettings['commentMode']>('always');
  useEffect(()=>{if(!reviewer.data)return;setEnabled(reviewer.data.enabled);setBranches(reviewer.data.branches.join(', '));setResponseFormat(reviewer.data.responseFormat);setFocus(reviewer.data.focus);setCommentMode(reviewer.data.commentMode);},[reviewer.data]);
  const save=useMutation({mutationFn:()=>api<ReviewerSettings>(`/api/repositories/${repository.id}/reviewer`,{method:'PUT',body:JSON.stringify({enabled,branches:branches.split(',').map((branch)=>branch.trim()).filter(Boolean),responseFormat,focus,commentMode})}),onSuccess:(settings)=>{void reviewer.refetch();setEnabled(settings.enabled);}});
  const run=useMutation({mutationFn:(workflowId:string)=>api<{executionId:string}>(`/api/workflows/${workflowId}/run`,{method:'POST'}),onSuccess:(result)=>{void client.invalidateQueries({queryKey:['executions']});void client.invalidateQueries({queryKey:['dashboard']});void navigate(`/executions/${result.executionId}`);}});
  const {refresh,isManual,isAuto}=useRefresh(reviewer.refetch,reviewer.isFetching,reviewer.isLoading);
  const validBranches=branches.split(',').some((branch)=>branch.trim());
  const workflowId=reviewer.data?.workflowId;
  return <section className="panel reviewer-panel">
    <header><div><h2>{repository.full_name}</h2><p>AI reviews for newly opened pull requests</p></div><div className="page-header-actions"><RefreshButton isRefreshing={isManual} onRefresh={refresh}/><Status value={enabled?'Active':'Off'}/></div></header>
    <AutoRefreshToast active={isAuto}/>
    {reviewer.isLoading?<Skeleton rows={5}/>:<div className="reviewer-settings">
      <label className="reviewer-toggle"><span><b>Automatic code review</b><small>Review new pull requests on the selected branches.</small></span><input type="checkbox" checked={enabled} onChange={(event)=>setEnabled(event.target.checked)}/><i/></label>
      <label><span>Target branches<small>Comma-separated base branches, such as main, develop.</small></span><input value={branches} onChange={(event)=>setBranches(event.target.value)} placeholder={repository.default_branch}/></label>
      <label><span>Response format<small>Choose how much detail appears in the PR comment.</small></span><select value={responseFormat} onChange={(event)=>setResponseFormat(event.target.value as ReviewerSettings['responseFormat'])}><option value="concise">Concise</option><option value="detailed">Detailed</option></select></label>
      <label><span>Review focus<small>All reviews remain AI-based and ignore style-only preferences.</small></span><select value={focus} onChange={(event)=>setFocus(event.target.value as ReviewerSettings['focus'])}><option value="balanced">Balanced</option><option value="correctness">Bugs and correctness</option><option value="security">Security</option></select></label>
      <label><span>Comment preference<small>Control whether clean reviews create a GitHub comment.</small></span><select value={commentMode} onChange={(event)=>setCommentMode(event.target.value as ReviewerSettings['commentMode'])}><option value="always">Always post a review</option><option value="issues_only">Only post when issues are found</option></select></label>
      <footer>
        <button className="button primary" disabled={save.isPending||!validBranches} onClick={()=>save.mutate()}>{save.isPending?'Saving…':save.isSuccess?'Saved':'Save review settings'}</button>
        <button className="button" disabled={run.isPending||!workflowId} onClick={()=>workflowId&&run.mutate(workflowId)}><Play size={14}/>{run.isPending?'Starting…':'Run now'}</button>
        {save.error&&<span className="error-text">{save.error.message}</span>}
        {run.error&&<span className="error-text">{run.error.message}</span>}
      </footer>
    </div>}
  </section>;
}
