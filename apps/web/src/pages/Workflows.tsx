import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Blocks, Bot, Github, MoreHorizontal, Play, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { WORKFLOW_TEMPLATES, type WorkflowDefinition } from '@trigg/shared';
import { api } from '../lib/api';
import { Empty, PageHeader, Skeleton, Status } from '../components/UI';

type Row={id:string;name:string;description:string;enabled:number;trigger_type:string;run_count:number;updated_at:string;repository_id?:string;repository?:string};
type Repository={id:string;full_name:string;private:number;updated_at:string};

export function Workflows(){
  const navigate=useNavigate();const client=useQueryClient();
  const [selectedRepositoryId,setSelectedRepositoryId]=useState<string>();
  const query=useQuery({queryKey:['workflows'],queryFn:()=>api<Row[]>('/api/workflows')});
  const repositories=useQuery({queryKey:['repositories'],queryFn:()=>api<Repository[]>('/api/github/repositories')});
  const sortedRepositories=[...(repositories.data??[])].sort((a,b)=>new Date(b.updated_at).getTime()-new Date(a.updated_at).getTime()||a.full_name.localeCompare(b.full_name));
  const repository=sortedRepositories.find((repo)=>repo.id===selectedRepositoryId)??sortedRepositories[0];
  const workflows=repository?query.data?.filter((row)=>row.repository_id===repository.id):query.data;
  const create=useMutation({mutationFn:(definition:Omit<WorkflowDefinition,'id'|'version'>)=>api<WorkflowDefinition>('/api/workflows',{method:'POST',body:JSON.stringify(definition)}),onSuccess:(workflow)=>navigate(`/workflows/${workflow.id}`)});
  const run=useMutation({mutationFn:(id:string)=>api<{queued:boolean;pullRequest:number}>(`/api/workflows/${id}/run`,{method:'POST'}),onSuccess:()=>void client.invalidateQueries({queryKey:['dashboard']})});
  const createReviewer=()=>{if(!repository)return;const template=WORKFLOW_TEMPLATES[0]!;create.mutate({...template,id:undefined,version:undefined,repositoryId:repository.id,name:`Review ${repository.full_name}`} as never);};
  return <div className="page">
    <PageHeader eyebrow="AUTOMATIONS" title="Workflows" description="Run code reviews for pull requests in your connected repositories." action={repository?<button className="button primary" disabled={create.isPending} onClick={createReviewer}><Plus size={15}/>New reviewer</button>:<Link className="button primary" to="/integrations"><Github size={15}/>Connect GitHub</Link>}/>
    <div className="workflows-layout">
      <aside className="panel repository-sidebar"><header><div><h2>Repositories</h2><p>{sortedRepositories.length} available · recently updated first</p></div></header>{repositories.isLoading?<Skeleton rows={5}/>:sortedRepositories.length?<div className="repository-list">{sortedRepositories.map((repo)=><button type="button" className={repository?.id===repo.id?'active':''} key={repo.id} onClick={()=>setSelectedRepositoryId(repo.id)}><Github size={15}/><span><b>{repo.full_name}</b><small>{repo.private?'Private':'Public'} · Updated {new Date(repo.updated_at).toLocaleDateString()}</small></span></button>)}</div>:<div className="repository-empty"><p>No repositories connected.</p><Link className="button" to="/integrations">Connect GitHub</Link></div>}</aside>
      <section className="panel workflows-panel"><header><div><h2>{repository?.full_name??'Your workflows'}</h2>{repository&&<p>Repository reviewers</p>}</div></header>{query.isLoading?<Skeleton rows={4}/>:workflows?.length?<div className="workflow-list">{workflows.map((row)=><Link to={`/workflows/${row.id}`} key={row.id}><span className="workflow-icon"><Bot/></span><div><b>{row.name}</b><small>{row.repository??'No repository'} · {row.description}</small></div><Status value={row.enabled?'Active':'Draft'}/><span className="run-count">{row.run_count} runs</span><button aria-label={`Run ${row.name}`} disabled={run.isPending} onClick={(event)=>{event.preventDefault();run.mutate(row.id);}}><Play/></button><button aria-label="Workflow menu"><MoreHorizontal/></button></Link>)}</div>:<Empty icon={<Blocks/>} title={repository?'No workflows for this repository':'Connect GitHub first'} body={repository?'Create a reviewer for the selected repository.':'Install the Trigg GitHub App and choose repositories to review.'} action={repository?<button className="button primary" onClick={createReviewer}><Plus size={15}/>Create reviewer</button>:<Link className="button primary" to="/integrations">Connect GitHub</Link>}/>}</section>
    </div>
  </div>;
}
