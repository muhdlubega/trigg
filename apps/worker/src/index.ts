import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { CodeReviewSchema, FallbackAIProvider, GeminiProvider, MistralProvider, type AIProvider, type CodeReview } from '@trigg/ai';
import { GitHubAppClient, ResendEmailProvider, assertSafeHttpUrl, missingGitHubPermissions, normalizePullRequestEvent, verifyGitHubSignature, type GitHubCheckConclusion, type GitHubCheckRun, type GitHubPullRequestContext } from '@trigg/integrations';
import { WORKFLOW_TEMPLATES, workflowDefinitionSchema, type ApiError, type ApiResponse, type WorkflowDefinition, type WorkflowNode } from '@trigg/shared';
import { executeWorkflow, type ExecutionContext, type NodeExecutor } from '@trigg/workflow-engine';

type Variables = { user: { id:string; firebaseUid:string; email:string; displayName?:string; photoUrl?:string } };
type Bindings = Env & {
  FIREBASE_PROJECT_ID?:string; GITHUB_APP_ID?:string; GITHUB_PRIVATE_KEY?:string; GITHUB_WEBHOOK_SECRET?:string;
  GITHUB_APP_SLUG?:string; RESEND_API_KEY?:string; GEMINI_API_KEY?:string; MISTRAL_API_KEY?:string; MISTRAL_MODEL?:string; GEMINI_MODEL?:string;
};
type QueueMessage = {kind:'github-event';eventId:string}|{kind:'workflow-run';workflowId:string;userId:string;input:ExecutionContext;mode:'LIVE';executionId?:string};
type GitHubRepository = {id:number;full_name:string;private:boolean;default_branch:string;updated_at:string;owner:{login:string}};
const reviewerSettingsSchema=z.object({enabled:z.boolean(),branches:z.array(z.string().trim().min(1).max(255)).min(1).max(20),responseFormat:z.enum(['concise','detailed']),focus:z.enum(['balanced','correctness','security']),commentMode:z.enum(['always','issues_only'])});
type ReviewerSettings=z.infer<typeof reviewerSettingsSchema>;
type AppContext = Context<{Bindings:Bindings;Variables:Variables}>;
const app = new Hono<{Bindings:Bindings;Variables:Variables}>();

const ok=<T>(data:T)=>({data}) satisfies ApiResponse<T>;
const fail=(code:string,message:string,status:400|401|403|404|409|429|500=400)=>Response.json({error:{code,message}} satisfies ApiError,{status});
const now=()=>new Date().toISOString();
const uuid=(prefix:string)=>`${prefix}_${crypto.randomUUID().replaceAll('-','')}`;
const parseJson=<T>(value:string|null,fallback:T):T=>{try{return value?JSON.parse(value) as T:fallback;}catch{return fallback;}};

async function syncGitHubRepositories(env:Bindings,userId:string,localInstallationId:string,githubInstallationId:string){
  if(!env.GITHUB_APP_ID||!env.GITHUB_PRIVATE_KEY)return;
  const client=new GitHubAppClient(env.GITHUB_APP_ID,env.GITHUB_PRIVATE_KEY,githubInstallationId);
  const result=await client.request<{repositories:GitHubRepository[]}>('GET','/installation/repositories?per_page=100');
  const syncedAt=now();
  for(const repository of result.repositories)await env.DB.prepare('INSERT INTO repositories (id,user_id,installation_id,github_repository_id,full_name,private,default_branch,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,github_repository_id) DO UPDATE SET installation_id=excluded.installation_id,full_name=excluded.full_name,private=excluded.private,default_branch=excluded.default_branch,updated_at=excluded.updated_at').bind(uuid('repo'),userId,localInstallationId,String(repository.id),repository.full_name,repository.private?1:0,repository.default_branch,syncedAt,repository.updated_at||syncedAt).run();
  return result.repositories;
}

function reviewerDefinition(id:string,repositoryId:string,repository:string,version:number,settings:ReviewerSettings):WorkflowDefinition{return {id,repositoryId,name:`AI review · ${repository}`,description:'AI code review for newly opened pull requests',enabled:settings.enabled,version,nodes:[{id:'github',type:'trigger.github',name:'PR opened',category:'trigger',position:{x:0,y:0},config:{event:'pull_request',action:'opened',branches:settings.branches}},{id:'review',type:'ai.codeReview',name:'AI review',category:'ai',position:{x:0,y:0},config:{responseFormat:settings.responseFormat,focus:settings.focus,commentMode:settings.commentMode}},{id:'comment',type:'action.githubComment',name:'Post review',category:'action',position:{x:0,y:0},config:{repository:'{{github.repository}}',issueNumber:'{{github.prNumber}}',body:'{{review.comment}}'}}],edges:[{id:'e1',source:'github',target:'review'},{id:'e2',source:'review',target:'comment'}]};}

app.use('*', async (c,next) => cors({origin:(origin)=>origin && c.env.ALLOWED_ORIGINS.split(',').map((item)=>item.trim()).includes(origin)?origin:'',allowHeaders:['Authorization','Content-Type','X-Trigg-Secret'],allowMethods:['GET','POST','PUT','PATCH','DELETE','OPTIONS'],credentials:true})(c,next));

async function authenticate(token:string,env:Bindings) {
  if(!env.FIREBASE_PROJECT_ID) throw new Error('Firebase is not configured');
  const jwks=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
  const {payload}=await jwtVerify(token,jwks,{issuer:`https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,audience:env.FIREBASE_PROJECT_ID});
  if(!payload.sub) throw new Error('Invalid Firebase identity');
  return {firebaseUid:payload.sub,email:typeof payload.email==='string'?payload.email:undefined,displayName:typeof payload.name==='string'?payload.name:undefined,photoUrl:typeof payload.picture==='string'?payload.picture:undefined};
}

app.use('/api/*',async(c,next)=>{
  const token=c.req.header('authorization')?.replace(/^Bearer\s+/i,''); if(!token) return fail('UNAUTHORIZED','Authentication required',401);
  try {
    const identity=await authenticate(token,c.env); const timestamp=now(); const existing=await c.env.DB.prepare('SELECT * FROM users WHERE firebase_uid = ?').bind(identity.firebaseUid).first<Record<string,string>>();
    const id=existing?.id ?? uuid('usr');
    const email=identity.email??existing?.email??`${identity.firebaseUid}@users.trigg.invalid`;
    const displayName=existing?.display_name??identity.displayName;
    const photoUrl=existing?.photo_url??identity.photoUrl;
    if(existing) await c.env.DB.prepare('UPDATE users SET email=?,display_name=?,photo_url=?,updated_at=? WHERE id=?').bind(email,displayName??null,photoUrl??null,timestamp,id).run();
    else await c.env.DB.prepare('INSERT INTO users (id,firebase_uid,email,display_name,photo_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(id,identity.firebaseUid,email,displayName??null,photoUrl??null,timestamp,timestamp).run();
    c.set('user',{id,firebaseUid:identity.firebaseUid,email,...(displayName?{displayName}:{}),...(photoUrl?{photoUrl}:{})}); await next();
  } catch(error){return fail('UNAUTHORIZED',error instanceof Error?error.message:'Invalid token',401);}
});

app.get('/',(c)=>c.json(ok({name:'Trigg API',tagline:'Automate what happens next.',environment:c.env.ENVIRONMENT})));
app.get('/health',(c)=>c.json(ok({status:'ok',time:now()})));
app.get('/api/me',(c)=>c.json(ok(c.get('user'))));
app.patch('/api/me',async(c)=>{const body=z.object({displayName:z.string().trim().min(1).max(80)}).parse(await c.req.json());await c.env.DB.prepare('UPDATE users SET display_name=?,updated_at=? WHERE id=?').bind(body.displayName,now(),c.get('user').id).run();return c.json(ok({...c.get('user'),displayName:body.displayName}));});
app.get('/api/settings/status',(c)=>c.json(ok({ai:{mistral:Boolean(c.env.MISTRAL_API_KEY),gemini:Boolean(c.env.GEMINI_API_KEY)},limits:{runs:Number(c.env.FREE_DAILY_RUN_LIMIT??100),ai:Number(c.env.FREE_DAILY_AI_LIMIT??50),emails:25}})));
app.get('/api/node-definitions',async(c)=>c.json(ok({templates:WORKFLOW_TEMPLATES})));

app.get('/api/dashboard',async(c)=>{
  const user=c.get('user');
  const [workflows,executions,ai,recent,active]=await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) total FROM workflows WHERE user_id=? AND enabled=1').bind(user.id).first<{total:number}>(),
    c.env.DB.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) successful FROM workflow_executions WHERE user_id=? AND date(started_at)=date('now')").bind(user.id).first<{total:number;successful:number}>(),
    c.env.DB.prepare("SELECT COUNT(*) requests, COALESCE(SUM(input_tokens+output_tokens),0) tokens FROM ai_usage a JOIN workflow_executions e ON e.id=a.execution_id WHERE e.user_id=? AND date(a.created_at)=date('now')").bind(user.id).first<{requests:number;tokens:number}>(),
    c.env.DB.prepare('SELECT e.*,w.name workflow_name FROM workflow_executions e JOIN workflows w ON w.id=e.workflow_id WHERE e.user_id=? ORDER BY e.started_at DESC LIMIT 5').bind(user.id).all(),
    c.env.DB.prepare('SELECT w.id,w.name,r.id repositoryId,r.full_name repository FROM workflows w JOIN repositories r ON r.id=w.repository_id WHERE w.user_id=? AND w.enabled=1 ORDER BY w.updated_at DESC').bind(user.id).all(),
  ]);
  const total=executions?.total??0; return c.json(ok({activeWorkflows:workflows?.total??0,executionsToday:total,successRate:total?Math.round(((executions?.successful??0)/total)*100):0,aiRuns:ai?.requests??0,aiTokens:ai?.tokens??0,recent:recent.results,active:active.results}));
});

app.get('/api/workflows',async(c)=>{const result=await c.env.DB.prepare('SELECT w.*,r.full_name repository,COUNT(e.id) run_count FROM workflows w LEFT JOIN repositories r ON r.id=w.repository_id LEFT JOIN workflow_executions e ON e.workflow_id=w.id WHERE w.user_id=? GROUP BY w.id ORDER BY w.updated_at DESC').bind(c.get('user').id).all();return c.json(ok(result.results));});
app.get('/api/repositories/:id/reviewer',async(c)=>{const user=c.get('user');const repository=await c.env.DB.prepare('SELECT id,full_name,default_branch FROM repositories WHERE id=? AND user_id=?').bind(c.req.param('id'),user.id).first<{id:string;full_name:string;default_branch:string}>();if(!repository)return fail('NOT_FOUND','Repository not found',404);const row=await c.env.DB.prepare("SELECT w.*,v.definition_json FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=w.current_version WHERE w.repository_id=? AND w.user_id=? AND w.trigger_type='trigger.github' ORDER BY w.updated_at DESC LIMIT 1").bind(repository.id,user.id).first<Record<string,string|number>>();if(!row)return c.json(ok({workflowId:null,repositoryId:repository.id,repository:repository.full_name,enabled:false,branches:[repository.default_branch],responseFormat:'detailed',focus:'balanced',commentMode:'always'}));const definition=parseJson<WorkflowDefinition>(String(row.definition_json),{} as WorkflowDefinition);const trigger=definition.nodes?.find((node)=>node.type==='trigger.github');const review=definition.nodes?.find((node)=>node.type==='ai.codeReview');return c.json(ok({workflowId:String(row.id),repositoryId:repository.id,repository:repository.full_name,enabled:Boolean(row.enabled),branches:Array.isArray(trigger?.config.branches)?trigger.config.branches:[repository.default_branch],responseFormat:review?.config.responseFormat==='concise'?'concise':'detailed',focus:['correctness','security'].includes(String(review?.config.focus))?review?.config.focus:'balanced',commentMode:review?.config.commentMode==='issues_only'?'issues_only':'always'}));});
app.put('/api/repositories/:id/reviewer',async(c)=>{const user=c.get('user');const settings=reviewerSettingsSchema.parse(await c.req.json());const repository=await c.env.DB.prepare('SELECT id,full_name FROM repositories WHERE id=? AND user_id=?').bind(c.req.param('id'),user.id).first<{id:string;full_name:string}>();if(!repository)return fail('NOT_FOUND','Repository not found',404);const existing=await c.env.DB.prepare("SELECT id,current_version FROM workflows WHERE repository_id=? AND user_id=? AND trigger_type='trigger.github' ORDER BY updated_at DESC LIMIT 1").bind(repository.id,user.id).first<{id:string;current_version:number}>();const workflowId=existing?.id??uuid('wf');const version=Number(existing?.current_version??0)+1;const definition=reviewerDefinition(workflowId,repository.id,repository.full_name,version,settings);const timestamp=now();const statements=[c.env.DB.prepare('INSERT INTO workflow_versions (id,workflow_id,version,definition_json,created_at) VALUES (?,?,?,?,?)').bind(uuid('wfv'),workflowId,version,JSON.stringify(definition),timestamp)];if(existing)statements.unshift(c.env.DB.prepare("UPDATE workflows SET name=?,description=?,enabled=?,current_version=?,trigger_event='pull_request',trigger_action='opened',updated_at=? WHERE id=? AND user_id=?").bind(definition.name,definition.description,settings.enabled?1:0,version,timestamp,workflowId,user.id));else statements.unshift(c.env.DB.prepare('INSERT INTO workflows (id,user_id,repository_id,name,description,enabled,current_version,trigger_type,trigger_event,trigger_action,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(workflowId,user.id,repository.id,definition.name,definition.description,settings.enabled?1:0,version,'trigger.github','pull_request','opened',timestamp,timestamp));statements.push(c.env.DB.prepare("UPDATE workflows SET enabled=0,updated_at=? WHERE repository_id=? AND user_id=? AND trigger_type='trigger.github' AND id<>?").bind(timestamp,repository.id,user.id,workflowId));await c.env.DB.batch(statements);return c.json(ok({workflowId,repositoryId:repository.id,repository:repository.full_name,...settings}));});
app.post('/api/workflows',async(c)=>{
  const body=workflowDefinitionSchema.omit({id:true,version:true}).extend({id:z.string().optional(),version:z.number().optional()}).parse(await c.req.json());
  const definition:WorkflowDefinition={...body,id:body.id??uuid('wf'),version:body.version??1}; const trigger=definition.nodes.find((node)=>node.category==='trigger'); if(!trigger)return fail('INVALID_WORKFLOW','A trigger is required');
  if(trigger.type==='trigger.github'&&!definition.repositoryId)return fail('REPOSITORY_REQUIRED','Choose a repository for this workflow');
  if(definition.repositoryId){const repository=await c.env.DB.prepare('SELECT id FROM repositories WHERE id=? AND user_id=?').bind(definition.repositoryId,c.get('user').id).first();if(!repository)return fail('INVALID_REPOSITORY','Repository not found',404);}
  const timestamp=now(); const webhookId=trigger.type==='trigger.webhook'?uuid('hook'):null;
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO workflows (id,user_id,repository_id,name,description,enabled,current_version,trigger_type,trigger_event,trigger_action,webhook_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(definition.id,c.get('user').id,definition.repositoryId??null,definition.name,definition.description,definition.enabled?1:0,1,trigger.type,String(trigger.config.event??''),String(trigger.config.action??''),webhookId,timestamp,timestamp),
    c.env.DB.prepare('INSERT INTO workflow_versions (id,workflow_id,version,definition_json,created_at) VALUES (?,?,?,?,?)').bind(uuid('wfv'),definition.id,1,JSON.stringify(definition),timestamp),
  ]);
  return c.json(ok({...definition,webhookId}),201);
});

async function ownedWorkflow(env:Bindings,userId:string,id:string){return env.DB.prepare('SELECT w.*,v.definition_json,r.full_name repository,gi.installation_id github_installation_id FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=w.current_version LEFT JOIN repositories r ON r.id=w.repository_id LEFT JOIN github_installations gi ON gi.id=r.installation_id WHERE w.id=? AND w.user_id=?').bind(id,userId).first<Record<string,string|number>>();}
app.get('/api/workflows/:id',async(c)=>{const row=await ownedWorkflow(c.env,c.get('user').id,c.req.param('id'));return row?c.json(ok({...parseJson<WorkflowDefinition>(String(row.definition_json),{} as WorkflowDefinition),webhookId:row.webhook_id})):fail('NOT_FOUND','Workflow not found',404);});
app.patch('/api/workflows/:id',async(c)=>{
  const current=await ownedWorkflow(c.env,c.get('user').id,c.req.param('id')); if(!current)return fail('NOT_FOUND','Workflow not found',404);
  const body=workflowDefinitionSchema.parse(await c.req.json()); const version=Number(current.current_version)+1; const definition={...body,id:c.req.param('id'),version}; const trigger=definition.nodes.find((node)=>node.category==='trigger'); if(!trigger)return fail('INVALID_WORKFLOW','A trigger is required');
  if(trigger.type==='trigger.github'&&!definition.repositoryId)return fail('REPOSITORY_REQUIRED','Choose a repository for this workflow');
  if(definition.repositoryId){const repository=await c.env.DB.prepare('SELECT id FROM repositories WHERE id=? AND user_id=?').bind(definition.repositoryId,c.get('user').id).first();if(!repository)return fail('INVALID_REPOSITORY','Repository not found',404);}
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE workflows SET repository_id=?,name=?,description=?,enabled=?,current_version=?,trigger_type=?,trigger_event=?,trigger_action=?,updated_at=? WHERE id=? AND user_id=?').bind(definition.repositoryId??null,definition.name,definition.description,definition.enabled?1:0,version,trigger.type,String(trigger.config.event??''),String(trigger.config.action??''),now(),definition.id,c.get('user').id),
    c.env.DB.prepare('INSERT INTO workflow_versions (id,workflow_id,version,definition_json,created_at) VALUES (?,?,?,?,?)').bind(uuid('wfv'),definition.id,version,JSON.stringify(definition),now()),
  ]); return c.json(ok(definition));
});
app.delete('/api/workflows/:id',async(c)=>{const result=await c.env.DB.prepare('DELETE FROM workflows WHERE id=? AND user_id=?').bind(c.req.param('id'),c.get('user').id).run();return result.meta.changes?c.json(ok({deleted:true})):fail('NOT_FOUND','Workflow not found',404);});
app.post('/api/workflows/:id/activate',async(c)=>toggle(c,true)); app.post('/api/workflows/:id/deactivate',async(c)=>toggle(c,false));
async function toggle(c:AppContext,enabled:boolean){const user=c.get('user');const result=await c.env.DB.prepare('UPDATE workflows SET enabled=?,updated_at=? WHERE id=? AND user_id=?').bind(enabled?1:0,now(),c.req.param('id'),user.id).run();return result.meta.changes?c.json(ok({enabled})):fail('NOT_FOUND','Workflow not found',404);}
app.post('/api/workflows/:id/run',async(c)=>{
  const user=c.get('user');const row=await ownedWorkflow(c.env,user.id,c.req.param('id'));if(!row)return fail('NOT_FOUND','Workflow not found',404);
  if(!row.repository||!row.github_installation_id)return fail('REPOSITORY_REQUIRED','Connect a GitHub repository to run this workflow');
  if(!c.env.GITHUB_APP_ID||!c.env.GITHUB_PRIVATE_KEY)return fail('NOT_CONFIGURED','GitHub App credentials are not configured',500);
  const daily=await c.env.DB.prepare("SELECT COUNT(*) total FROM workflow_executions WHERE user_id=? AND date(started_at)=date('now')").bind(user.id).first<{total:number}>(); if((daily?.total??0)>=Number(c.env.FREE_DAILY_RUN_LIMIT))return fail('RATE_LIMITED','Daily workflow run limit reached',429);
  const client=new GitHubAppClient(c.env.GITHUB_APP_ID,c.env.GITHUB_PRIVATE_KEY,String(row.github_installation_id));const pulls=await client.listOpenPullRequests(String(row.repository));const pull=pulls[0];
  if(!pull)return fail('NO_OPEN_PULL_REQUESTS','This repository has no open pull requests',404);
  const github:GitHubPullRequestContext={repository:String(row.repository),repositoryId:String(row.repository_id),prNumber:pull.number,title:pull.title,body:pull.body??'',author:pull.user.login,action:'manual',baseBranch:pull.base.ref,headBranch:pull.head.ref,headSha:pull.head.sha,url:pull.html_url};
  const executionId=uuid('exec');
  await c.env.DB.prepare('INSERT INTO workflow_executions (id,workflow_id,workflow_version,user_id,status,mode,trigger_json,started_at) VALUES (?,?,?,?,?,?,?,?)').bind(executionId,String(row.id),Number(row.current_version),user.id,'queued', 'LIVE',JSON.stringify({github,installationId:String(row.github_installation_id)}),now()).run();
  await c.env.WORKFLOW_QUEUE.send({kind:'workflow-run',workflowId:c.req.param('id'),userId:user.id,input:{github,installationId:String(row.github_installation_id)},mode:'LIVE',executionId} satisfies QueueMessage);
  return c.json(ok({queued:true,executionId,pullRequest:pull.number}),202);
});

app.get('/api/executions',async(c)=>{const result=await c.env.DB.prepare('SELECT e.*,w.name workflow_name FROM workflow_executions e JOIN workflows w ON w.id=e.workflow_id WHERE e.user_id=? ORDER BY e.started_at DESC LIMIT 100').bind(c.get('user').id).all();return c.json(ok(result.results));});
app.get('/api/executions/:id',async(c)=>{const execution=await c.env.DB.prepare('SELECT e.*,w.name workflow_name,v.definition_json FROM workflow_executions e JOIN workflows w ON w.id=e.workflow_id JOIN workflow_versions v ON v.workflow_id=e.workflow_id AND v.version=e.workflow_version WHERE e.id=? AND e.user_id=?').bind(c.req.param('id'),c.get('user').id).first();if(!execution)return fail('NOT_FOUND','Execution not found',404);const nodes=await c.env.DB.prepare('SELECT * FROM node_executions WHERE execution_id=? ORDER BY started_at').bind(c.req.param('id')).all();const usage=await c.env.DB.prepare('SELECT * FROM ai_usage WHERE execution_id=?').bind(c.req.param('id')).all();return c.json(ok({execution,nodes:nodes.results,aiUsage:usage.results}));});

app.get('/api/integrations/github',async(c)=>{
  const installs=await c.env.DB.prepare('SELECT g.*,COUNT(r.id) repository_count FROM github_installations g LEFT JOIN repositories r ON r.installation_id=g.id WHERE g.user_id=? GROUP BY g.id').bind(c.get('user').id).all<Record<string,string|number>>();
  const installations=await Promise.all(installs.results.map(async(installation)=>{
    if(!c.env.GITHUB_APP_ID||!c.env.GITHUB_PRIVATE_KEY)return {...installation,missingPermissions:[] as string[]};
    try {
      const client=new GitHubAppClient(c.env.GITHUB_APP_ID,c.env.GITHUB_PRIVATE_KEY,String(installation.installation_id));
      return {...installation,missingPermissions:missingGitHubPermissions(await client.installationPermissions())};
    } catch { return {...installation,missingPermissions:[] as string[]}; }
  }));
  return c.json(ok({configured:Boolean(c.env.GITHUB_APP_ID),appSlug:c.env.GITHUB_APP_SLUG??null,installations}));
});
app.get('/api/github/repositories',async(c)=>{const user=c.get('user');const installations=await c.env.DB.prepare('SELECT id,installation_id FROM github_installations WHERE user_id=?').bind(user.id).all<{id:string;installation_id:string}>();for(const installation of installations.results){try{await syncGitHubRepositories(c.env,user.id,installation.id,installation.installation_id);}catch{/* Return cached repositories if GitHub is temporarily unavailable. */}}const result=await c.env.DB.prepare('SELECT * FROM repositories WHERE user_id=? ORDER BY updated_at DESC,full_name ASC').bind(user.id).all();return c.json(ok(result.results));});
app.post('/api/integrations/github/connect',async(c)=>{if(!c.env.GITHUB_APP_SLUG)return fail('NOT_CONFIGURED','GitHub App slug is not configured');const state=crypto.randomUUID();const timestamp=now();await c.env.DB.prepare("DELETE FROM integration_connections WHERE user_id=? AND provider='github_pending'").bind(c.get('user').id).run();await c.env.DB.prepare('INSERT INTO integration_connections (id,user_id,provider,status,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(uuid('conn'),c.get('user').id,'github_pending','pending',JSON.stringify({state,expiresAt:Date.now()+15*60*1000}),timestamp,timestamp).run();return c.json(ok({url:`https://github.com/apps/${c.env.GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`}));});
app.post('/api/integrations/github/callback',async(c)=>{
  const {installationId,state}=z.object({installationId:z.coerce.string().min(1),state:z.string().min(1)}).parse(await c.req.json());
  const pending=await c.env.DB.prepare("SELECT id,config_json FROM integration_connections WHERE user_id=? AND provider='github_pending' AND status='pending' ORDER BY created_at DESC LIMIT 1").bind(c.get('user').id).first<{id:string;config_json:string}>();const pendingConfig=parseJson<{state:string;expiresAt:number}>(pending?.config_json??null,{state:'',expiresAt:0});
  if(!pending||pendingConfig.state!==state||pendingConfig.expiresAt<Date.now())return fail('INVALID_STATE','GitHub connection expired. Start the connection again.',401);
  if(!c.env.GITHUB_APP_ID||!c.env.GITHUB_PRIVATE_KEY)return fail('NOT_CONFIGURED','GitHub App credentials are not configured',500);
  const client=new GitHubAppClient(c.env.GITHUB_APP_ID,c.env.GITHUB_PRIVATE_KEY,installationId);
  const result=await client.request<{repositories:GitHubRepository[]}>('GET','/installation/repositories?per_page=100');
  const user=c.get('user');const timestamp=now();const localInstallationId=uuid('ghi');const accountLogin=result.repositories[0]?.owner.login??'GitHub account';
  await c.env.DB.prepare('INSERT INTO github_installations (id,user_id,installation_id,account_login,account_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(installation_id) DO UPDATE SET user_id=excluded.user_id,account_login=excluded.account_login,updated_at=excluded.updated_at').bind(localInstallationId,user.id,installationId,accountLogin,'User',timestamp,timestamp).run();
  const installed=await c.env.DB.prepare('SELECT id FROM github_installations WHERE installation_id=? AND user_id=?').bind(installationId,user.id).first<{id:string}>();
  for(const repository of result.repositories)await c.env.DB.prepare('INSERT INTO repositories (id,user_id,installation_id,github_repository_id,full_name,private,default_branch,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,github_repository_id) DO UPDATE SET installation_id=excluded.installation_id,full_name=excluded.full_name,private=excluded.private,default_branch=excluded.default_branch,updated_at=excluded.updated_at').bind(uuid('repo'),user.id,installed?.id??localInstallationId,String(repository.id),repository.full_name,repository.private?1:0,repository.default_branch,timestamp,repository.updated_at||timestamp).run();
  await c.env.DB.prepare('DELETE FROM integration_connections WHERE id=?').bind(pending.id).run();
  return c.json(ok({connected:true,repositories:result.repositories.length}));
});

app.post('/webhooks/github',async(c)=>{
  const payload=await c.req.text(); if(!c.env.GITHUB_WEBHOOK_SECRET)return fail('NOT_CONFIGURED','GitHub webhook secret is not configured',500);
  if(!await verifyGitHubSignature(payload,c.req.header('x-hub-signature-256')??null,c.env.GITHUB_WEBHOOK_SECRET))return fail('INVALID_SIGNATURE','Invalid webhook signature',401);
  const delivery=c.req.header('x-github-delivery'); const event=c.req.header('x-github-event'); if(!delivery||!event)return fail('INVALID_WEBHOOK','Missing GitHub headers');
  const json=JSON.parse(payload) as {action?:string;installation?:{id:number;account?:{login?:string;type?:string}};repository?:{id:number;full_name:string;private:boolean;default_branch:string}};
  const id=uuid('evt'); const insert=await c.env.DB.prepare('INSERT OR IGNORE INTO webhook_events (id,delivery_id,event,action,installation_id,repository_id,payload_json,status,received_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,delivery,event,json.action??null,json.installation?.id?String(json.installation.id):null,json.repository?.id?String(json.repository.id):null,payload,'queued',now()).run();
  if(insert.meta.changes===0)return c.json(ok({accepted:true,duplicate:true}));
  await c.env.WORKFLOW_QUEUE.send({kind:'github-event',eventId:id} satisfies QueueMessage); return c.json(ok({accepted:true}),202);
});

app.all('/hooks/:webhookId',async(c)=>{
  const row=await c.env.DB.prepare("SELECT * FROM workflows WHERE webhook_id=? AND enabled=1 AND trigger_type='trigger.webhook'").bind(c.req.param('webhookId')).first<Record<string,string>>(); if(!row)return fail('NOT_FOUND','Webhook not found',404);
  const version=await c.env.DB.prepare('SELECT definition_json FROM workflow_versions WHERE workflow_id=? AND version=?').bind(row.id,row.current_version).first<{definition_json:string}>(); const definition=parseJson<WorkflowDefinition>(version?.definition_json??null,{} as WorkflowDefinition); const trigger=definition.nodes.find((node)=>node.category==='trigger');
  if(trigger?.config.auth==='secret'&&c.req.header('x-trigg-secret')!==trigger.config.secret)return fail('UNAUTHORIZED','Invalid webhook secret',401);
  if(trigger?.config.auth==='bearer'&&c.req.header('authorization')!==`Bearer ${trigger.config.secret}`)return fail('UNAUTHORIZED','Invalid bearer token',401);
  const contentType=c.req.header('content-type')??''; const input=contentType.includes('application/json')?await c.req.json():{body:await c.req.text()}; await c.env.WORKFLOW_QUEUE.send({kind:'workflow-run',workflowId:String(row.id),userId:String(row.user_id),input:{[trigger?.id??'webhook']:input},mode:'LIVE'} satisfies QueueMessage); return c.json(ok({accepted:true}),202);
});

function aiProvider(env:Bindings):AIProvider{const mistral=env.MISTRAL_API_KEY?.trim()?new MistralProvider(env.MISTRAL_API_KEY,env.MISTRAL_MODEL):null;const gemini=env.GEMINI_API_KEY?.trim()?new GeminiProvider(env.GEMINI_API_KEY,env.GEMINI_MODEL):null;if(mistral&&gemini)return new FallbackAIProvider(mistral,gemini);const provider=mistral??gemini;if(!provider)throw new Error('A Mistral or Gemini API key is required');return provider;}
function reviewComment(review:CodeReview,format:'concise'|'detailed',commentMode:'always'|'issues_only'){if(commentMode==='issues_only'&&!review.findings.length)return '';const findings=review.findings.length?review.findings.map((finding,index)=>format==='concise'?`${index+1}. **${finding.severity.toUpperCase()}: ${finding.title}**${finding.file?` — \`${finding.file}${finding.line?`:${finding.line}`:''}\``:''}`:`${index+1}. **${finding.severity.toUpperCase()}: ${finding.title}**${finding.file?` — \`${finding.file}${finding.line?`:${finding.line}`:''}\``:''}\n   ${finding.description}`).join('\n'):'No material issues found.';return `## Trigg code review\n\n${review.summary}\n\n**Risk:** ${review.riskScore}/100 (${review.severity})  \n**Recommendation:** ${review.recommendation.replace('_',' ')}\n\n### Findings\n${findings}\n\n<sub>Reviewed by Trigg using Mistral with Gemini fallback.</sub>`;}
function executors(env:Bindings,executionId:string,installationId?:string):Record<string,NodeExecutor>{
  const ai=aiProvider(env);
  const github=installationId&&env.GITHUB_APP_ID&&env.GITHUB_PRIVATE_KEY?new GitHubAppClient(env.GITHUB_APP_ID,env.GITHUB_PRIVATE_KEY,installationId):null;
  const runAI=async(node:WorkflowNode,context:ExecutionContext)=>{const request={prompt:`${String(node.config.prompt??'Analyze the following event')}\n${JSON.stringify(context).slice(0,60000)}`};const result=await ai.generate(request);await recordAI(env,executionId,node.id,result);return {text:result.text};};
  const codeReview=async(node:WorkflowNode,context:ExecutionContext)=>{if(!github)throw new Error('GitHub App installation is required');const pr=context.github as {repository?:string;prNumber?:number;title?:string;body?:string};if(!pr?.repository||!pr.prNumber)throw new Error('Pull request context is missing');const rawDiff=await github.pullRequestDiff(pr.repository,pr.prNumber);const truncated=rawDiff.length>60000;const diff=rawDiff.slice(0,60000);const focus=node.config.focus==='security'?'Prioritize exploitable security and privacy risks.':node.config.focus==='correctness'?'Prioritize bugs, regressions, edge cases, and reliability problems.':'Balance correctness, security, reliability, and significant regressions.';const format=node.config.responseFormat==='concise'?'concise':'detailed';const commentMode=node.config.commentMode==='issues_only'?'issues_only':'always';const prompt=`Review this pull request diff. ${focus} Ignore style-only preferences. ${format==='concise'?'Keep the summary and each finding brief.':'Explain each material finding clearly and include actionable remediation.'} If no material issue exists, return an empty findings array. Return JSON with summary, riskScore (0-100), severity, findings, and recommendation.\n\nPR title: ${pr.title??''}\nPR description: ${pr.body??''}\nDiff${truncated?' (truncated to 60,000 characters)':''}:\n${diff}`;const result=await ai.generateStructured({prompt},CodeReviewSchema);await recordAI(env,executionId,node.id,result.usage);return {...result.data,comment:reviewComment(result.data,format,commentMode)};};
  return {
    'ai.prompt':(node,context)=>runAI(node,context),'ai.classifier':(node,context)=>runAI(node,context),'ai.extract':(node,context)=>runAI(node,context),'ai.summarize':(node,context)=>runAI(node,context),'ai.agent':(node,context)=>runAI(node,context),'ai.codeReview':codeReview,
    'logic.transform':async(node)=>node.config.mapping,'logic.delay':async(node)=>({waitingSeconds:node.config.seconds}),
    'action.save':async(node)=>node.config.value,
    'action.email':async(node)=>{if(!env.RESEND_API_KEY)throw new Error('Resend is not configured');const provider=new ResendEmailProvider(env.RESEND_API_KEY,env.EMAIL_FROM);const result=await provider.send({to:String(node.config.to),subject:String(node.config.subject),body:String(node.config.body)});await env.DB.prepare('INSERT INTO email_logs (id,execution_id,recipient_masked,provider,status,created_at) VALUES (?,?,?,?,?,?)').bind(uuid('email'),executionId,String(node.config.to).replace(/^(.{2}).+(@.+)$/,'$1***$2'),result.provider,'sent',now()).run();return result;},
    'action.githubComment':async(node)=>{if(!github)throw new Error('GitHub App installation is required');const body=String(node.config.body??'').trim();if(!body)return {skipped:true,reason:'No material findings'};const posted=await github.createPullRequestReview(String(node.config.repository),Number(node.config.issueNumber),body);return {id:posted.id,html_url:posted.html_url};},
    'action.githubIssue':async(node)=>{if(!github)throw new Error('GitHub App installation is required');return github.createIssue(String(node.config.repository),String(node.config.title),String(node.config.body),node.config.labels as string[]|undefined);},
    'action.http':async(node)=>{const url=assertSafeHttpUrl(String(node.config.url));const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Number(node.config.timeout??10000));const method=String(node.config.method);try{const response=await fetch(url,{method,...(node.config.headers?{headers:node.config.headers as Record<string,string>}:{}),...(['GET','HEAD'].includes(method)?{}:{body:String(node.config.body??'')}),signal:controller.signal,redirect:'error'});return {status:response.status,ok:response.ok,body:(await response.text()).slice(0,10000)};}finally{clearTimeout(timer);}},
  };
}
async function recordAI(env:Bindings,executionId:string,nodeId:string,usage:{provider:string;model:string;inputTokens:number;outputTokens:number;durationMs:number}){await env.DB.prepare('INSERT INTO ai_usage (id,execution_id,node_id,provider,model,input_tokens,output_tokens,duration_ms,estimated_cost,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(uuid('ai'),executionId,nodeId,usage.provider,usage.model,usage.inputTokens,usage.outputTokens,usage.durationMs,0,now()).run();}

function pullRequestFromInput(input:ExecutionContext):GitHubPullRequestContext|undefined {
  const github=input.github; if(!github||typeof github!=='object') return undefined; return github as GitHubPullRequestContext;
}

function reviewFromOutputs(outputs:ExecutionContext):Partial<CodeReview>&{comment?:string}|undefined {
  const review=outputs.review; if(!review||typeof review!=='object') return undefined; return review as Partial<CodeReview>&{comment?:string};
}

function checkConclusion(result:{status:string;nodes:Array<{nodeId:string;status:string}>}):GitHubCheckConclusion {
  const review=result.nodes.find((node)=>node.nodeId==='review');
  if(!review||review.status==='failed') return 'failure';
  if(review.status==='skipped') return 'neutral';
  return 'success';
}

function checkOutput(result:{outputs:ExecutionContext;status:string;nodes:Array<{nodeId:string;status:string;error?:string}>}) {
  const review=reviewFromOutputs(result.outputs);
  const comment=result.nodes.find((node)=>node.nodeId==='comment');
  const conclusion=checkConclusion(result);
  const title=conclusion==='success'?'Trigg AI review complete':conclusion==='neutral'?'Trigg AI review skipped':'Trigg AI review failed';
  const summary=review?.summary??(comment?.error??result.nodes.find((node)=>node.error)?.error??'Review finished.');
  const text=review?.comment??(review?.findings?.length?review.findings.map((finding)=>`- ${finding.severity}: ${finding.title}`).join('\n'):undefined);
  return {conclusion,title,summary,text};
}

async function startReviewCheck(github:GitHubAppClient|null,pr:GitHubPullRequestContext|undefined) {
  if(!github||!pr?.repository||!pr.headSha) return null;
  try { return await github.createCheckRun(pr.repository,{name:'Trigg AI review',headSha:pr.headSha,status:'in_progress',title:'Reviewing pull request',summary:'Trigg is reviewing this pull request.'}); }
  catch(error){ console.error(JSON.stringify({event:'github.check.start_failed',error:error instanceof Error?error.message:'Unknown'})); return null; }
}

async function completeReviewCheck(github:GitHubAppClient|null,pr:GitHubPullRequestContext|undefined,check:GitHubCheckRun|null,result:{outputs:ExecutionContext;status:string;nodes:Array<{nodeId:string;status:string;error?:string}>}) {
  if(!github||!pr?.repository||!check) return;
  const output=checkOutput(result);
  try { await github.updateCheckRun(pr.repository,check.id,{status:'completed',conclusion:output.conclusion,title:output.title,summary:output.summary,...(output.text?{text:output.text}:{})}); }
  catch(error){ console.error(JSON.stringify({event:'github.check.complete_failed',error:error instanceof Error?error.message:'Unknown'})); }
}

async function failExecution(env:Bindings,executionId:string|undefined,started:number,error:unknown) {
  if(!executionId) return;
  const message=error instanceof Error?error.message:'Unknown error';
  await env.DB.prepare('UPDATE workflow_executions SET status=?,error=?,completed_at=?,duration_ms=? WHERE id=? AND status IN (\'queued\',\'running\')').bind('failed',message,now(),Date.now()-started,executionId).run();
}

async function runWorkflow(env:Bindings,message:Extract<QueueMessage,{kind:'workflow-run'}>){
  const executionId=message.executionId??uuid('exec'); const started=Date.now();
  try {
    const row=await ownedWorkflow(env,message.userId,message.workflowId); if(!row)throw new Error('Workflow not found');
    const workflow=parseJson<WorkflowDefinition>(String(row.definition_json),{} as WorkflowDefinition);
    const daily=await env.DB.prepare("SELECT COUNT(*) total FROM workflow_executions WHERE user_id=? AND date(started_at)=date('now')").bind(message.userId).first<{total:number}>();
    if((daily?.total??0)>=Number(env.FREE_DAILY_RUN_LIMIT)&&!message.executionId)throw new Error('Daily workflow run limit reached');
    if(message.executionId) await env.DB.prepare("UPDATE workflow_executions SET status='running' WHERE id=?").bind(executionId).run();
    else await env.DB.prepare('INSERT INTO workflow_executions (id,workflow_id,workflow_version,user_id,status,mode,trigger_json,started_at) VALUES (?,?,?,?,?,?,?,?)').bind(executionId,workflow.id,workflow.version,message.userId,'running',message.mode,JSON.stringify(message.input),now()).run();
    await env.DB.batch([env.DB.prepare('DELETE FROM node_executions WHERE execution_id=?').bind(executionId),env.DB.prepare('DELETE FROM ai_usage WHERE execution_id=?').bind(executionId)]);
    const installationId=typeof message.input.installationId==='string'?message.input.installationId:undefined;
    const github=installationId&&env.GITHUB_APP_ID&&env.GITHUB_PRIVATE_KEY?new GitHubAppClient(env.GITHUB_APP_ID,env.GITHUB_PRIVATE_KEY,installationId):null;
    const pr=pullRequestFromInput(message.input);
    const check=await startReviewCheck(github,pr);
    const result=await executeWorkflow(workflow,message.input,executors(env,executionId,installationId));
    for(const node of result.nodes)await env.DB.prepare('INSERT INTO node_executions (id,execution_id,node_id,status,input_json,output_json,error,duration_ms,started_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(uuid('nexec'),executionId,node.nodeId,node.status,JSON.stringify(node.input),node.output===undefined?null:JSON.stringify(node.output),node.error??null,node.durationMs,new Date(started).toISOString()).run();
    await completeReviewCheck(github,pr,check,result);
    await env.DB.prepare('UPDATE workflow_executions SET status=?,outputs_json=?,error=?,completed_at=?,duration_ms=? WHERE id=?').bind(result.status,JSON.stringify(result.outputs),result.nodes.find((node)=>node.error)?.error??null,now(),Date.now()-started,executionId).run();
  } catch(error) {
    await failExecution(env,executionId,started,error);
    throw error;
  }
}

async function processGitHubEvent(env:Bindings,eventId:string){
  const event=await env.DB.prepare('SELECT * FROM webhook_events WHERE id=?').bind(eventId).first<Record<string,string>>();if(!event)return;
  if(event.event!=='pull_request'){await env.DB.prepare("UPDATE webhook_events SET status='ignored',processed_at=? WHERE id=?").bind(now(),eventId).run();return;}
  const payload=parseJson<Record<string,unknown>>(event.payload_json??null,{});const github=normalizePullRequestEvent(payload);const workflows=await env.DB.prepare("SELECT w.*,r.github_repository_id,v.definition_json FROM workflows w JOIN repositories r ON r.id=w.repository_id JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=w.current_version WHERE w.enabled=1 AND w.trigger_type='trigger.github' AND w.trigger_event='pull_request' AND (w.trigger_action=? OR w.trigger_action='') AND r.github_repository_id=?").bind(event.action??'',event.repository_id??'').all<Record<string,string>>();
  for(const workflow of workflows.results){const definition=parseJson<WorkflowDefinition>(workflow.definition_json??null,{} as WorkflowDefinition);const trigger=definition.nodes?.find((node)=>node.type==='trigger.github');const branches=Array.isArray(trigger?.config.branches)?trigger.config.branches.map(String):[];if(branches.length&&!branches.includes(github.baseBranch))continue;await runWorkflow(env,{kind:'workflow-run',workflowId:String(workflow.id),userId:String(workflow.user_id),input:{github,installationId:event.installation_id},mode:'LIVE'});}
  await env.DB.prepare("UPDATE webhook_events SET status='processed',processed_at=? WHERE id=?").bind(now(),eventId).run();
}

const handler:ExportedHandler<Bindings,QueueMessage>={
  fetch:app.fetch,
  async queue(batch,env){for(const message of batch.messages){try{if(message.body.kind==='github-event')await processGitHubEvent(env,message.body.eventId);else await runWorkflow(env,message.body);message.ack();}catch(error){console.error(JSON.stringify({event:'queue.error',messageId:message.id,error:error instanceof Error?error.message:'Unknown'}));message.retry();}}},
};
export default handler;
