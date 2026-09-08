import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowLeft, Bot, Github } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { parseJson, pollIfAnyActive, pollWhileActive } from '../lib/runs';
import { AutoRefreshToast, Empty, PageHeader, RefreshButton, Severity, Skeleton, Status, useRefresh } from '../components/UI';

type Row={id:string;workflow_name:string;status:string;mode:string;started_at:string;duration_ms:number|null;error?:string|null};
type Filter='all'|'success'|'failed'|'test';
type Finding={title:string;description?:string;file?:string;line?:number;severity?:string};
type Review={summary?:string;riskScore?:number;severity?:string;findings?:Finding[];recommendation?:string;comment?:string};
type WorkflowNode={id?:string;name?:string};
type Detail={execution:Record<string,string|number|null>;nodes:Array<Record<string,string|number|null>>;aiUsage:Array<Record<string,string|number|null>>};

export function Executions(){
  const [filter,setFilter]=useState<Filter>('all');
  const query=useQuery({queryKey:['executions'],queryFn:()=>api<Row[]>('/api/executions'),refetchInterval:(result)=>pollIfAnyActive(result.state.data)});
  const rows=(query.data??[]).filter((row)=>filter==='all'||(filter==='test'?row.mode.toLowerCase()==='test':row.status.toLowerCase()===filter));
  const {refresh,isManual,isAuto}=useRefresh(query.refetch,query.isFetching,query.isLoading);
  return <div className="page">
    <PageHeader eyebrow="OBSERVABILITY" title="Executions" description="Inspect every trigger, decision, action, and retry." action={<RefreshButton isRefreshing={isManual} onRefresh={refresh}/>}/>
    <AutoRefreshToast active={isAuto}/>
    <section className="panel executions-panel"><header><h2>All runs</h2><div className="filter-tabs">{(['all','success','failed','test'] as const).map((value)=><button key={value} className={filter===value?'active':''} onClick={()=>setFilter(value)}>{value[0]?.toUpperCase()}{value.slice(1)}</button>)}</div></header>
    {query.isLoading?<Skeleton rows={5}/>:query.isError?<p className="error-text panel-message">{query.error.message}</p>:rows.length?<div className="execution-table"><div className="table-head"><span>Workflow</span><span>Status</span><span>Mode</span><span>Started</span><span>Duration</span></div>{rows.map((row)=><Link to={`/executions/${row.id}`} key={row.id}><span className="execution-name"><i className="event-icon"><Github size={15}/></i><span><b>{row.workflow_name}</b><small className="execution-mobile-meta">{row.mode} · {new Date(row.started_at).toLocaleString()} · {row.duration_ms?`${row.duration_ms} ms`:'In progress'}</small></span></span><Status value={row.status}/><small>{row.mode}</small><time>{new Date(row.started_at).toLocaleString()}</time><code>{row.duration_ms?`${row.duration_ms} ms`:'Not available'}</code></Link>)}</div>:<Empty icon={<Activity/>} title={query.data?.length?'No matching executions':'No executions yet'} body={query.data?.length?'Try a different filter to see other runs.':'Test or activate a workflow to see its complete execution trace here.'}/>}
    </section>
  </div>;
}

export function ExecutionDetail(){
  const {id}=useParams();
  const query=useQuery({queryKey:['execution',id],queryFn:()=>api<Detail>(`/api/executions/${id}`),enabled:Boolean(id),refetchInterval:(result)=>pollWhileActive(String(result.state.data?.execution.status??'')),refetchIntervalInBackground:true});
  const {refresh,isManual,isAuto}=useRefresh(query.refetch,query.isFetching,query.isLoading);
  if(query.isLoading)return <div className="page"><Skeleton rows={5}/></div>;
  if(query.isError)return <div className="page"><Link className="back" to="/executions"><ArrowLeft size={14}/>Executions</Link><p className="error-text">{query.error.message}</p></div>;
  if(!query.data)return <div className="page"><Link className="back" to="/executions"><ArrowLeft size={14}/>Executions</Link><Empty icon={<Activity/>} title="Execution not found" body="This run is missing or you do not have access to it."/></div>;
  const {execution,nodes,aiUsage}=query.data;
  const names=nodeNames(execution.definition_json);
  const outputs=parseJson<{review?:Review}>(execution.outputs_json,{});
  const review=outputs.review??parseJson<Review|null>(nodes.find((node)=>node.node_id==='review')?.output_json,null)??undefined;
  const comment=nodes.find((node)=>node.node_id==='comment');
  const posted=parseJson<{html_url?:string;skipped?:boolean;reason?:string}>(comment?.output_json,{});
  return <div className="page">
    <Link className="back" to="/executions"><ArrowLeft size={14}/>Executions</Link>
    <PageHeader eyebrow={`EXECUTION · ${execution.mode}`} title={String(execution.workflow_name)} description={`Started ${new Date(String(execution.started_at)).toLocaleString()}`} action={<><RefreshButton isRefreshing={isManual} onRefresh={refresh}/><Status value={String(execution.status)}/></>}/>
    <AutoRefreshToast active={isAuto}/>
    {String(execution.status)==='failed'&&review?.summary&&<p className="notice">Review completed, but posting to GitHub failed{comment?.error?`: ${String(comment.error)}`:'.'}</p>}
    <div className="detail-grid">
      <section className="panel timeline">
        <header><h2>Execution timeline</h2><code>{String(execution.id)}</code></header>
        {nodes.map((node,index)=><article key={String(node.id)}><span className="timeline-line">{index<nodes.length-1&&<i/>}<b>{index+1}</b></span><div><header><b>{names[String(node.node_id)]??String(node.node_id)}</b><Status value={String(node.status)}/><time>{node.duration_ms} ms</time></header>{node.error&&<p className="error-text">{String(node.error)}</p>}{String(node.node_id)==='comment'&&posted.html_url&&<p><a href={posted.html_url} target="_blank" rel="noreferrer">Open GitHub review</a></p>}{String(node.node_id)==='comment'&&posted.skipped&&<p className="muted-text">{posted.reason??'No comment posted'}</p>}<details><summary>Inspect input and output</summary><div className="json-grid"><pre>{formatJson(node.input_json)}</pre><pre>{formatJson(node.output_json)}</pre></div></details></div></article>)}
      </section>
      <aside>
        {review?.summary&&<section className="panel review-card"><header><h2>Review</h2><Status value={String(review.severity??'low')}/></header><p>{review.summary}</p><dl><dt>Risk</dt><dd>{review.riskScore??0}/100</dd><dt>Recommendation</dt><dd>{String(review.recommendation??'Not available').replace('_',' ')}</dd><dt>GitHub</dt><dd>{comment?.status==='failed'?'Failed':posted.skipped?'Skipped':posted.html_url?'Posted':'Not available'}</dd></dl>{review.findings?.length?<ul>{review.findings.map((finding,index)=><li key={`${finding.title}-${index}`}><Severity value={finding.severity??'low'}/><b>{finding.title}</b>{finding.file&&<small>{finding.file}{finding.line?`:${finding.line}`:''}</small>}{finding.description&&<span>{finding.description}</span>}</li>)}</ul>:<p className="muted-text">No material issues found.</p>}{review.comment&&<details><summary>Comment body</summary><pre>{review.comment}</pre></details>}</section>}
        <section className="panel run-summary"><h2>Run summary</h2><dl><dt>Status</dt><dd><Status value={String(execution.status)}/></dd><dt>Duration</dt><dd>{execution.duration_ms??'Not available'}{execution.duration_ms?' ms':''}</dd><dt>Version</dt><dd>v{execution.workflow_version}</dd><dt>Mode</dt><dd>{String(execution.mode)}</dd></dl>{execution.error&&<p className="error-text panel-message">{String(execution.error)}</p>}</section>
        <section className="panel ai-card"><header><Bot size={17}/><h2>AI usage</h2></header>{aiUsage.length?aiUsage.map((usage)=><dl key={String(usage.id)}><dt>Provider</dt><dd>{String(usage.provider)}</dd><dt>Model</dt><dd>{String(usage.model)}</dd><dt>Tokens</dt><dd>{Number(usage.input_tokens)+Number(usage.output_tokens)}</dd><dt>Latency</dt><dd>{usage.duration_ms} ms</dd></dl>):<p>No AI nodes ran.</p>}</section>
      </aside>
    </div>
  </div>;
}

function nodeNames(definitionJson:unknown){const nodes=parseJson<{nodes?:WorkflowNode[]}>(definitionJson,{nodes:[]}).nodes??[];return Object.fromEntries(nodes.filter((node)=>node.id).map((node)=>[String(node.id),String(node.name??node.id)]));}
function formatJson(value:string|number|null|undefined){if(!value)return 'No data';try{return JSON.stringify(JSON.parse(String(value)),null,2)}catch{return String(value)}}
