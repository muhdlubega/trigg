import type { ReactNode } from 'react';
import { AlertTriangle, Check, Clock3, XCircle } from 'lucide-react';
export function PageHeader({eyebrow,title,description,action}:{eyebrow?:string;title:string;description?:string;action?:ReactNode}){return <header className="page-header"><div>{eyebrow&&<div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description&&<p>{description}</p>}</div>{action}</header>}
export function Status({value}:{value:string}){const lower=value.toLowerCase();const Icon=lower==='success'||lower==='active'?Check:lower==='failed'?XCircle:lower==='running'||lower==='queued'?Clock3:AlertTriangle;return <span className={`status status-${lower}`}><Icon size={12}/>{value}</span>}
export function Empty({icon,title,body,action}:{icon:ReactNode;title:string;body:string;action?:ReactNode}){return <div className="empty"><span>{icon}</span><h3>{title}</h3><p>{body}</p>{action}</div>}
export function Skeleton({rows=3}:{rows?:number}){return <div className="skeletons">{Array.from({length:rows},(_,i)=><div className="skeleton" key={i}/>)}</div>}
