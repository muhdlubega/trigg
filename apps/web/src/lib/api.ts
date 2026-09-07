import { initializeApp, getApps } from 'firebase/app';
import { getAdditionalUserInfo, getAuth, GithubAuthProvider, GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signOut, updateProfile, type User } from 'firebase/auth';

const firebaseConfig={apiKey:import.meta.env.VITE_FIREBASE_API_KEY,authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID,appId:import.meta.env.VITE_FIREBASE_APP_ID};
const configured=Object.values(firebaseConfig).every(Boolean);
const auth=configured?getAuth(getApps()[0]??initializeApp(firebaseConfig)):null;
const API=import.meta.env.VITE_API_URL??'http://localhost:8787';

export async function token(){if(!auth?.currentUser)throw new Error('Sign in is required');return auth.currentUser.getIdToken();}
export async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const response=await fetch(`${API}${path}`,{...init,headers:{authorization:`Bearer ${await token()}`,'content-type':'application/json',...init?.headers}});
  const json=await response.json() as {data?:T;error?:{message:string}}; if(!response.ok||json.error)throw new Error(json.error?.message??'Request failed'); return json.data as T;
}
export function observeAuth(callback:(user:User|null)=>void){if(!auth){callback(null);return()=>undefined;}return onIdTokenChanged(auth,callback);}
export async function login(provider:'google'|'github'){
  if(!auth)throw new Error('Firebase authentication is not configured');
  const result=await signInWithPopup(auth,provider==='google'?new GoogleAuthProvider():new GithubAuthProvider());
  const username=getAdditionalUserInfo(result)?.username;
  if(!result.user.displayName&&username){await updateProfile(result.user,{displayName:username});await result.user.getIdToken(true);}
  return result.user;
}
export async function logout(){if(auth)await signOut(auth);}
export {configured as firebaseConfigured};
