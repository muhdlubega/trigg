import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Blocks, Bot, Github, MoreHorizontal, Play, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { WORKFLOW_TEMPLATES, type WorkflowDefinition } from '@trigg/shared';
import { api } from '../lib/api';
import { Empty, PageHeader, Skeleton, Status } from '../components/UI';

type Row={id:string;name:string;description:string;enabled:number;trigger_type:string;run_count:number;updated_at:string;repository?:string};
type Repository={id:string;full_name:string;private:number};

export function Workflows(){
  const navigate=useNavigate();const client=useQueryClient();
  const query=useQuery({queryKey:['workflows'],queryFn:()=>api<Row[]>('/api/workflows')});
  const repositories=useQuery({queryKey:['repositories'],queryFn:()=>api<Repository[]>('/api/github/repositories')});
  const [repository]=repositories.data??[];
  const create=useMutation({mutationFn:(definition:Omit<WorkflowDefinition,'id'|'version'>)=>api<WorkflowDefinition>('/api/workflows',{method:'POST',body:JSON.stringify(definition)}),onSuccess:(workflow)=>navigate(`/workflows/${workflow.id}`)});
  const run=useMutation({mutationFn:(id:string)=>api<{queued:boolean;pullRequest:number}>(`/api/workflows/${id}/run`,{method:'POST'}),onSuccess:()=>void client.invalidateQueries({queryKey:['dashboard']})});
  const createReviewer=()=>{if(!repository)return;const template=WORKFLOW_TEMPLATES[0]!;create.mutate({...template,id:undefined,version:undefined,repositoryId:repository.id} as never);};
  return <div className="page">
    <PageHeader eyebrow="AUTOMATIONS" title="Workflows" description="Run code reviews for pull requests in your connected repositories." action={repository?<button className="button primary" onClick={createReviewer}><Plus size={15}/>New reviewer</button>:<Link className="button primary" to="/integrations"><Github size={15}/>Connect GitHub</Link>}/>
    {repositories.data&&repositories.data.length>1&&<section className="template-row"><h2>Create for a repository</h2><div>{repositories.data.map((repo)=><button key={repo.id} onClick={()=>{const template=WORKFLOW_TEMPLATES[0]!;create.mutate({...template,id:undefined,version:undefined,repositoryId:repo.id,name:`Review ${repo.full_name}`} as never);}}><Github size={18}/><span><b>{repo.full_name}</b><small>Review new pull requests</small></span><Plus size={14}/></button>)}</div></section>}
    <section className="panel workflows-panel"><header><h2>Your workflows</h2></header>{query.isLoading?<Skeleton rows={4}/>:query.data?.length?<div className="workflow-list">{query.data.map((row)=><Link to={`/workflows/${row.id}`} key={row.id}><span className="workflow-icon"><Bot/></span><div><b>{row.name}</b><small>{row.repository??'No repository'} · {row.description}</small></div><Status value={row.enabled?'Active':'Draft'}/><span className="run-count">{row.run_count} runs</span><button aria-label={`Run ${row.name}`} disabled={run.isPending} onClick={(event)=>{event.preventDefault();run.mutate(row.id);}}><Play/></button><button aria-label="Workflow menu"><MoreHorizontal/></button></Link>)}</div>:<Empty icon={<Blocks/>} title={repository?'No workflows yet':'Connect GitHub first'} body={repository?'Create a reviewer for your repository.':'Install the Trigg GitHub App and choose repositories to review.'} action={repository?<button className="button primary" onClick={createReviewer}><Plus size={15}/>Create reviewer</button>:<Link className="button primary" to="/integrations">Connect GitHub</Link>}/>}</section>
  </div>;
}
