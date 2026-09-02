import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { User } from 'firebase/auth';
import { observeAuth } from './lib/api';
import { AppShell } from './components/AppShell';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Workflows } from './pages/Workflows';
import { WorkflowEditor } from './pages/WorkflowEditor';
import { Executions, ExecutionDetail } from './pages/Executions';
import { Integrations } from './pages/Integrations';
import { Settings } from './pages/Settings';
import { GitHubCallback } from './pages/Integrations';

export function App(){const [user,setUser]=useState<User|null|undefined>(undefined);useEffect(()=>observeAuth(setUser),[]);if(user===undefined)return <div className="boot"><span className="logo-mark">T</span></div>;const protectedElement=(element:React.ReactNode)=>user?<AppShell user={user}>{element}</AppShell>:<Navigate to="/login" replace/>;return <Routes><Route path="/" element={<Landing/>}/><Route path="/login" element={user?<Navigate to="/dashboard" replace/>:<Login/>}/><Route path="/signup" element={<Login/>}/><Route path="/dashboard" element={protectedElement(<Dashboard/>)}/><Route path="/workflows" element={protectedElement(<Workflows/>)}/><Route path="/workflows/:id" element={protectedElement(<WorkflowEditor/>)}/><Route path="/executions" element={protectedElement(<Executions/>)}/><Route path="/executions/:id" element={protectedElement(<ExecutionDetail/>)}/><Route path="/integrations" element={protectedElement(<Integrations/>)}/><Route path="/integrations/github/callback" element={protectedElement(<GitHubCallback/>)}/><Route path="/settings/*" element={protectedElement(<Settings/>)}/><Route path="/docs" element={<StaticPage title="Documentation"/>}/><Route path="/privacy" element={<StaticPage title="Privacy"/>}/><Route path="/terms" element={<StaticPage title="Terms"/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes>}
function StaticPage({title}:{title:string}){return <main className="static-page"><a className="brand" href="/"><span className="logo-mark">T</span>Trigg</a><h1>{title}</h1><p>Trigg is an open-source automation platform. This deployment is operated by its owner; review the repository documentation for its data handling and retention policy.</p></main>}
