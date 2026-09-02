import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GithubAuthProvider, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';

const mock=import.meta.env.VITE_TRIGG_MOCK_MODE!=='false';
const firebaseConfig={apiKey:import.meta.env.VITE_FIREBASE_API_KEY,authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID,appId:import.meta.env.VITE_FIREBASE_APP_ID};
const auth=!mock&&firebaseConfig.apiKey?getAuth(getApps()[0]??initializeApp(firebaseConfig)):null;
const API=import.meta.env.VITE_API_URL??'http://localhost:8787';
const MOCK_USER={uid:'mock-user',email:'developer@trigg.local',displayName:'Trigg Developer',photoURL:null} as User;

export async function token(){return auth?.currentUser?.getIdToken()??'mock-token';}
export async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const response=await fetch(`${API}${path}`,{...init,headers:{authorization:`Bearer ${await token()}`,'content-type':'application/json',...init?.headers}});
  const json=await response.json() as {data?:T;error?:{message:string}}; if(!response.ok||json.error)throw new Error(json.error?.message??'Request failed'); return json.data as T;
}
export function observeAuth(callback:(user:User|null)=>void){if(mock){callback(MOCK_USER);return()=>undefined;}return onAuthStateChanged(auth!,callback);}
export async function login(provider:'google'|'github'){if(mock)return MOCK_USER;return (await signInWithPopup(auth!,provider==='google'?new GoogleAuthProvider():new GithubAuthProvider())).user;}
export async function logout(){if(auth)await signOut(auth);}
export {mock};
