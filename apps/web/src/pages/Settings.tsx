import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CircleUserRound, Gauge, Github, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { PageHeader, Skeleton, Status } from '../components/UI';

type Tab='profile'|'integrations'|'providers'|'usage'|'security';
type Me={email:string;displayName?:string;firebaseUid:string};
type GitHubData={configured:boolean;installations:Array<Record<string,string|number>>};
type DashboardData={executionsToday:number;aiRuns:number;aiTokens:number;successRate:number};
type RuntimeStatus={ai:{mistral:boolean;gemini:boolean};limits:{runs:number;ai:number;emails:number}};

const tabs=[
  {id:'profile' as const,Icon:CircleUserRound,label:'Profile'},
  {id:'integrations' as const,Icon:Github,label:'Integrations'},
  {id:'providers' as const,Icon:Bot,label:'AI providers'},
  {id:'usage' as const,Icon:Gauge,label:'Usage'},
  {id:'security' as const,Icon:ShieldCheck,label:'Security'},
];

export function Settings(){
  const client=useQueryClient();
  const [active,setActive]=useState<Tab>('profile');
  const [displayName,setDisplayName]=useState('');
  const me=useQuery({queryKey:['me'],queryFn:()=>api<Me>('/api/me')});
  const github=useQuery({queryKey:['github-integration'],queryFn:()=>api<GitHubData>('/api/integrations/github')});
  const dashboard=useQuery({queryKey:['dashboard'],queryFn:()=>api<DashboardData>('/api/dashboard')});
  const runtime=useQuery({queryKey:['runtime-status'],queryFn:()=>api<RuntimeStatus>('/api/settings/status')});
  const save=useMutation({mutationFn:()=>api<Me>('/api/me',{method:'PATCH',body:JSON.stringify({displayName})}),onSuccess:(updated)=>{client.setQueryData(['me'],updated);}});
  useEffect(()=>{if(me.data)setDisplayName(me.data.displayName??'');},[me.data]);
  const connected=Boolean(github.data?.installations.length);

  let content;
  if(active==='profile')content=<><header><h2>Profile</h2><p>Your Firebase identity and Trigg account.</p></header>{me.isLoading?<Skeleton/>:<><label>Display name<input value={displayName} onChange={(event)=>setDisplayName(event.target.value)} placeholder="Your name"/></label><label>Email<input value={me.data?.email??''} disabled/></label><label>Firebase UID<input value={me.data?.firebaseUid??''} disabled/></label></>}<button className="button primary" disabled={save.isPending||!displayName.trim()} onClick={()=>save.mutate()}>{save.isPending?'Saving…':save.isSuccess?'Saved':'Save profile'}</button>{save.error&&<p className="error-text settings-message">{save.error.message}</p>}</>;
  else if(active==='integrations')content=<><header><h2>Integrations</h2><p>External services connected to your Trigg account.</p></header><div className="settings-status-list"><div><Github/><span><b>GitHub App</b><small>{connected?`${github.data?.installations.length} installation${github.data?.installations.length===1?'':'s'}`:'No installation connected'}</small></span><Status value={connected?'Connected':'Not connected'}/></div></div><Link className="button" to="/integrations">Manage GitHub repositories</Link></>;
  else if(active==='providers')content=<><header><h2>AI providers</h2><p>Trigg uses Mistral first and Gemini when a fallback is needed.</p></header><div className="settings-status-list"><div><Bot/><span><b>Mistral</b><small>Primary code-review provider</small></span><Status value={runtime.data?.ai.mistral?'Available':'Unavailable'}/></div><div><Bot/><span><b>Gemini</b><small>Fallback code-review provider</small></span><Status value={runtime.data?.ai.gemini?'Available':'Unavailable'}/></div></div></>;
  else if(active==='usage')content=<><header><h2>Usage</h2><p>Today's real workflow and AI consumption.</p></header><div className="settings-metrics"><div><small>Executions today</small><b>{dashboard.data?.executionsToday??0}</b><span>of {runtime.data?.limits.runs??100}</span></div><div><small>AI requests today</small><b>{dashboard.data?.aiRuns??0}</b><span>of {runtime.data?.limits.ai??50}</span></div><div><small>AI tokens today</small><b>{(dashboard.data?.aiTokens??0).toLocaleString()}</b><span>{dashboard.data?.successRate??0}% success</span></div></div></>;
  else content=<><header><h2>Security</h2><p>Your session is verified by Firebase before every API request.</p></header><div className="settings-status-list"><div><ShieldCheck/><span><b>Firebase Authentication</b><small>Backend-verified identity</small></span><Status value="Active"/></div></div><dl><dt>Account identifier</dt><dd>{me.data?.firebaseUid??'Loading…'}</dd><dt>Email</dt><dd>{me.data?.email??'Not provided'}</dd></dl></>;

  return <div className="page"><PageHeader eyebrow="ACCOUNT" title="Settings" description="Manage your profile, providers, security, and usage."/><div className="settings-layout"><nav role="tablist" aria-label="Settings sections">{tabs.map(({id,Icon,label})=><button type="button" role="tab" aria-selected={active===id} className={active===id?'active':''} key={id} onClick={()=>setActive(id)}><Icon size={16}/>{label}</button>)}</nav><section className="panel settings-card" role="tabpanel">{content}</section></div></div>;
}
