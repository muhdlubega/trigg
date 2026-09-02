export interface SendEmailInput { to:string; subject:string; body:string }
export interface EmailResult { id:string; provider:string }
export interface EmailProvider { send(input:SendEmailInput):Promise<EmailResult> }

export class LogEmailProvider implements EmailProvider {
  async send(input: SendEmailInput) { console.log(JSON.stringify({event:'email.mock',to:input.to,subject:input.subject})); return {id:crypto.randomUUID(),provider:'log'}; }
}

export class ResendEmailProvider implements EmailProvider {
  constructor(private readonly apiKey:string, private readonly from:string) {}
  async send(input:SendEmailInput):Promise<EmailResult> {
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${this.apiKey}`,'content-type':'application/json'},body:JSON.stringify({from:this.from,to:[input.to],subject:input.subject,text:input.body})});
    if(!response.ok) throw new Error(`Email provider failed (${response.status})`);
    const result=await response.json() as {id:string}; return {id:result.id,provider:'resend'};
  }
}

export async function verifyGitHubSignature(payload:string, signature:string|null, secret:string):Promise<boolean> {
  if(!signature?.startsWith('sha256=')) return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload)));
  const expected=`sha256=${[...digest].map((byte)=>byte.toString(16).padStart(2,'0')).join('')}`;
  const a=new TextEncoder().encode(signature); const b=new TextEncoder().encode(expected);
  if(a.length!==b.length) return false;
  let diff=0; for(let i=0;i<a.length;i++) diff|=(a[i] ?? 0)^(b[i] ?? 0); return diff===0;
}

function base64Url(value:string|Uint8Array):string {
  const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
  return btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}

export async function createGitHubAppJwt(appId:string, privateKeyPem:string):Promise<string> {
  const now=Math.floor(Date.now()/1000); const header=base64Url(JSON.stringify({alg:'RS256',typ:'JWT'})); const payload=base64Url(JSON.stringify({iat:now-60,exp:now+540,iss:appId}));
  const binary=atob(privateKeyPem.replace(/-----[^-]+-----|\s/g,''));
  const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(binary,(char)=>char.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(`${header}.${payload}`)));
  return `${header}.${payload}.${base64Url(signature)}`;
}

export class GitHubAppClient {
  private token?:{value:string;expires:number};
  constructor(private readonly appId:string,private readonly privateKey:string,private readonly installationId:string) {}
  private async installationToken() {
    if(this.token && this.token.expires>Date.now()+60_000) return this.token.value;
    const jwt=await createGitHubAppJwt(this.appId,this.privateKey);
    const response=await fetch(`https://api.github.com/app/installations/${this.installationId}/access_tokens`,{method:'POST',headers:{authorization:`Bearer ${jwt}`,accept:'application/vnd.github+json','user-agent':'trigg/0.1','x-github-api-version':'2022-11-28'}});
    if(!response.ok) throw new Error(`GitHub token request failed (${response.status})`);
    const json=await response.json() as {token:string;expires_at:string}; this.token={value:json.token,expires:new Date(json.expires_at).getTime()}; return json.token;
  }
  async request<T>(method:string,path:string,body?:unknown):Promise<T> {
    const token=await this.installationToken(); const response=await fetch(`https://api.github.com${path}`,{method,headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json','content-type':'application/json','user-agent':'trigg/0.1','x-github-api-version':'2022-11-28'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.status===403 && response.headers.get('x-ratelimit-remaining')==='0') throw new Error(`GitHub rate limit reached; resets at ${response.headers.get('x-ratelimit-reset') ?? 'unknown'}`);
    if(!response.ok) throw new Error(`GitHub API failed (${response.status})`); return response.json() as Promise<T>;
  }
  comment(repository:string,issueNumber:number,body:string){return this.request('POST',`/repos/${repository}/issues/${issueNumber}/comments`,{body});}
  createIssue(repository:string,title:string,body:string,labels?:string[]){return this.request('POST',`/repos/${repository}/issues`,{title,body,labels});}
}

export function assertSafeHttpUrl(raw:string):URL {
  const url=new URL(raw); if(url.protocol!=='https:') throw new Error('HTTP actions require HTTPS');
  const host=url.hostname.toLowerCase();
  if(host==='localhost'||host==='0.0.0.0'||host==='::1'||host.endsWith('.local')||/^127\./.test(host)||/^10\./.test(host)||/^192\.168\./.test(host)||/^169\.254\./.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error('Internal network destinations are blocked');
  return url;
}
