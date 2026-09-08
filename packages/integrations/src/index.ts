export interface SendEmailInput { to:string; subject:string; body:string }
export interface EmailResult { id:string; provider:string }
export interface EmailProvider { send(input:SendEmailInput):Promise<EmailResult> }

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

export async function githubErrorMessage(response:Response,fallback='GitHub API failed'):Promise<string> {
  if(response.status===403&&response.headers.get('x-ratelimit-remaining')==='0') return `GitHub rate limit reached; resets at ${response.headers.get('x-ratelimit-reset')??'unknown'}`;
  const body=await response.text().catch(()=>'');
  let detail='';
  try {
    const parsed=JSON.parse(body) as {message?:unknown};
    if(typeof parsed.message==='string') detail=parsed.message;
  } catch { detail=body.replace(/\s+/g,' ').trim(); }
  return `${fallback} (${response.status})${detail?`: ${detail.slice(0,200)}`:''}`;
}

export type GitHubCheckConclusion='success'|'failure'|'neutral'|'cancelled'|'timed_out'|'action_required'|'skipped';
export type GitHubCheckRun={id:number;html_url?:string;status:string;conclusion?:string|null};

export class GitHubAppClient {
  private token?:{value:string;expires:number};
  constructor(private readonly appId:string,private readonly privateKey:string,private readonly installationId:string) {}
  private async installationToken() {
    if(this.token && this.token.expires>Date.now()+60_000) return this.token.value;
    const jwt=await createGitHubAppJwt(this.appId,this.privateKey);
    const response=await fetch(`https://api.github.com/app/installations/${this.installationId}/access_tokens`,{method:'POST',headers:{authorization:`Bearer ${jwt}`,accept:'application/vnd.github+json','user-agent':'trigg/0.1','x-github-api-version':'2022-11-28'}});
    if(!response.ok) throw new Error(await githubErrorMessage(response,'GitHub token request failed'));
    const json=await response.json() as {token:string;expires_at:string}; this.token={value:json.token,expires:new Date(json.expires_at).getTime()}; return json.token;
  }
  async request<T>(method:string,path:string,body?:unknown):Promise<T> {
    const token=await this.installationToken(); const response=await fetch(`https://api.github.com${path}`,{method,headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json','content-type':'application/json','user-agent':'trigg/0.1','x-github-api-version':'2022-11-28'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(!response.ok) throw new Error(await githubErrorMessage(response));
    if(response.status===204) return undefined as T;
    return response.json() as Promise<T>;
  }
  async requestText(method:string,path:string,accept:string):Promise<string> {
    const token=await this.installationToken();
    const response=await fetch(`https://api.github.com${path}`,{method,headers:{authorization:`Bearer ${token}`,accept,'user-agent':'trigg/0.1','x-github-api-version':'2022-11-28'}});
    if(!response.ok)throw new Error(await githubErrorMessage(response));
    return response.text();
  }
  listOpenPullRequests(repository:string){return this.request<Array<{number:number;title:string;body:string|null;html_url:string;user:{login:string};base:{ref:string};head:{ref:string;sha:string}}>>('GET',`/repos/${repository}/pulls?state=open&sort=updated&direction=desc&per_page=1`);}
  pullRequestDiff(repository:string,number:number){return this.requestText('GET',`/repos/${repository}/pulls/${number}`,'application/vnd.github.diff');}
  createPullRequestReview(repository:string,pullNumber:number,body:string){return this.request<{id:number;html_url:string}>('POST',`/repos/${repository}/pulls/${pullNumber}/reviews`,{body,event:'COMMENT'});}
  comment(repository:string,issueNumber:number,body:string){return this.createPullRequestReview(repository,issueNumber,body);}
  createIssue(repository:string,title:string,body:string,labels?:string[]){return this.request('POST',`/repos/${repository}/issues`,{title,body,labels});}
  createCheckRun(repository:string,input:{name:string;headSha:string;status?:'queued'|'in_progress'|'completed';conclusion?:GitHubCheckConclusion;title?:string;summary?:string;text?:string}){
    return this.request<GitHubCheckRun>('POST',`/repos/${repository}/check-runs`,{
      name:input.name,head_sha:input.headSha,status:input.status??'in_progress',
      ...(input.conclusion?{conclusion:input.conclusion}:{}),
      ...(input.title||input.summary?{output:{title:input.title??input.name,summary:input.summary??'',...(input.text?{text:input.text}:{})}}:{}),
    });
  }
  updateCheckRun(repository:string,checkRunId:number,input:{status?:'queued'|'in_progress'|'completed';conclusion?:GitHubCheckConclusion;title?:string;summary?:string;text?:string}){
    return this.request<GitHubCheckRun>('PATCH',`/repos/${repository}/check-runs/${checkRunId}`,{
      ...(input.status?{status:input.status}:{}),
      ...(input.conclusion?{conclusion:input.conclusion,status:'completed'}:{}),
      ...(input.title||input.summary?{output:{title:input.title??'Trigg AI review',summary:input.summary??'',...(input.text?{text:input.text}:{})}}:{}),
    });
  }
}

export type GitHubPullRequestContext = {repository:string;repositoryId:string;prNumber:number;title:string;body:string;author:string;action:string;baseBranch:string;headBranch:string;headSha:string;url:string};
export function normalizePullRequestEvent(payload:Record<string,unknown>):GitHubPullRequestContext {
  const repository=payload.repository as {id?:number;full_name?:string}|undefined;
  const pullRequest=payload.pull_request as {number?:number;title?:string;body?:string|null;html_url?:string;user?:{login?:string};base?:{ref?:string};head?:{ref?:string;sha?:string}}|undefined;
  if(!repository?.full_name||!repository.id||!pullRequest?.number)throw new Error('Invalid GitHub pull request payload');
  return {repository:repository.full_name,repositoryId:String(repository.id),prNumber:pullRequest.number,title:pullRequest.title??'',body:pullRequest.body??'',author:pullRequest.user?.login??'',action:String(payload.action??''),baseBranch:pullRequest.base?.ref??'',headBranch:pullRequest.head?.ref??'',headSha:pullRequest.head?.sha??'',url:pullRequest.html_url??''};
}

export function assertSafeHttpUrl(raw:string):URL {
  const url=new URL(raw); if(url.protocol!=='https:') throw new Error('HTTP actions require HTTPS');
  const host=url.hostname.toLowerCase();
  if(host==='localhost'||host==='0.0.0.0'||host==='::1'||host.endsWith('.local')||/^127\./.test(host)||/^10\./.test(host)||/^192\.168\./.test(host)||/^169\.254\./.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error('Internal network destinations are blocked');
  return url;
}
