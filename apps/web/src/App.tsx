import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { User } from 'firebase/auth';
import { observeAuth } from './lib/api';
import { AppShell } from './components/AppShell';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Workflows } from './pages/Workflows';
import { Executions, ExecutionDetail } from './pages/Executions';
import { Integrations } from './pages/Integrations';
import { Settings } from './pages/Settings';
import { GitHubCallback } from './pages/Integrations';
import { Docs, Privacy, Terms } from './pages/Legal';

export function App(){const [user,setUser]=useState<User|null|undefined>(undefined);useEffect(()=>observeAuth(setUser),[]);if(user===undefined)return <div className="boot"><span className="logo-mark">T</span></div>;const protectedElement=(element:React.ReactNode)=>user?<AppShell user={user}>{element}</AppShell>:<Navigate to="/login" replace/>;return <Routes><Route path="/" element={<Landing/>}/><Route path="/login" element={user?<Navigate to="/dashboard" replace/>:<Login/>}/><Route path="/signup" element={<Login/>}/><Route path="/dashboard" element={protectedElement(<Dashboard/>)}/><Route path="/workflows" element={protectedElement(<Workflows/>)}/><Route path="/workflows/:id" element={<Navigate to="/workflows" replace/>}/><Route path="/executions" element={protectedElement(<Executions/>)}/><Route path="/executions/:id" element={protectedElement(<ExecutionDetail/>)}/><Route path="/integrations" element={protectedElement(<Integrations/>)}/><Route path="/integrations/github/callback" element={protectedElement(<GitHubCallback/>)}/><Route path="/settings/*" element={protectedElement(<Settings/>)}/><Route path="/docs" element={<Docs/>}/><Route path="/privacy" element={<Privacy/>}/><Route path="/terms" element={<Terms/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes>}
