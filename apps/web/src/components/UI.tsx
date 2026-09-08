import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertOctagon, AlertTriangle, Check, Clock3, Info, Minus, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
export function PageHeader({eyebrow,title,description,action}:{eyebrow?:string;title:string;description?:string;action?:ReactNode}){return <header className="page-header"><div>{eyebrow&&<div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description&&<p>{description}</p>}</div>{action&&<div className="page-header-actions">{action}</div>}</header>}
export function Status({value}:{value:string}){const lower=value.toLowerCase();const Icon=lower==='success'||lower==='active'?Check:lower==='failed'?XCircle:lower==='running'||lower==='queued'?Clock3:lower==='skipped'?Minus:AlertTriangle;return <span className={`status status-${lower}`}><Icon size={12}/>{value}</span>}
export function Severity({value}:{value:string}){const lower=value.toLowerCase();const Icon=lower==='critical'?ShieldAlert:lower==='high'?AlertOctagon:lower==='medium'?AlertTriangle:Info;return <span className={`severity severity-${lower}`}><Icon size={11}/>{lower}</span>}

/** Separates a click from a poll so only the click puts the button in its loading state. The first load is neither; a skeleton already covers it. */
export function useRefresh(refetch:()=>Promise<unknown>,isFetching=false,isLoading=false){
  const [isManual,setManual]=useState(false);
  const refresh=useCallback(()=>{setManual(true);void refetch().finally(()=>setManual(false));},[refetch]);
  return {refresh,isManual,isAuto:isFetching&&!isManual&&!isLoading};
}

export function RefreshButton({onRefresh,isRefreshing}:{onRefresh:()=>void;isRefreshing?:boolean}){return <button type="button" className="button" disabled={isRefreshing} onClick={onRefresh}><RefreshCw size={14} className={isRefreshing?'spin':undefined}/>{isRefreshing?'Refreshing…':'Refresh'}</button>}

/** A poll finishes far too quickly to read, so hold the toast open after it settles. */
export function AutoRefreshToast({active}:{active:boolean}){
  const [visible,setVisible]=useState(false);
  useEffect(()=>{
    if(active){setVisible(true);return undefined;}
    if(!visible)return undefined;
    const timer=setTimeout(()=>setVisible(false),1400);
    return ()=>clearTimeout(timer);
  },[active,visible]);
  if(!visible)return null;
  return <div className="toast" role="status" aria-live="polite"><RefreshCw size={12} className="spin"/>Auto-refreshing</div>;
}

export function Empty({icon,title,body,action}:{icon:ReactNode;title:string;body:string;action?:ReactNode}){return <div className="empty"><span>{icon}</span><h3>{title}</h3><p>{body}</p>{action}</div>}
export function Skeleton({rows=3}:{rows?:number}){return <div className="skeletons">{Array.from({length:rows},(_,i)=><div className="skeleton" key={i}/>)}</div>}
