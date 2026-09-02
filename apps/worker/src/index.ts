import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { CodeReviewSchema, MockAIProvider, WorkersAIProvider, type AIProvider } from '@trigg/ai';
import { GitHubAppClient, LogEmailProvider, ResendEmailProvider, assertSafeHttpUrl, verifyGitHubSignature } from '@trigg/integrations';
import { WORKFLOW_TEMPLATES, workflowDefinitionSchema, type ApiError, type ApiResponse, type WorkflowDefinition, type WorkflowNode } from '@trigg/shared';
import { executeWorkflow, type ExecutionContext, type NodeExecutor } from '@trigg/workflow-engine';

type Variables = { user: { id:string; firebaseUid:string; email:string; displayName?:string; photoUrl?:string } };
type Bindings = Env & {
  FIREBASE_PROJECT_ID?:string; GITHUB_APP_ID?:string; GITHUB_PRIVATE_KEY?:string; GITHUB_WEBHOOK_SECRET?:string;
  GITHUB_APP_SLUG?:string; RESEND_API_KEY?:string; GEMINI_API_KEY?:string; MISTRAL_API_KEY?:string;
};
type QueueMessage = {kind:'github-event';eventId:string}|{kind:'workflow-run';workflowId:string;userId:string;input:ExecutionContext;mode:'LIVE'|'TEST'};
type AppContext = Context<{Bindings:Bindings;Variables:Variables}>;
const app = new Hono<{Bindings:Bindings;Variables:Variables}>();

const ok=<T>(data:T)=>({data}) satisfies ApiResponse<T>;
const fail=(code:string,message:string,status:400|401|403|404|409|429|500=400)=>Response.json({error:{code,message}} satisfies ApiError,{status});
const now=()=>new Date().toISOString();
const uuid=(prefix:string)=>`${prefix}_${crypto.randomUUID().replaceAll('-','')}`;
const parseJson=<T>(value:string|null,fallback:T):T=>{try{return value?JSON.parse(value) as T:fallback;}catch{return fallback;}};

app.use('*', async (c,next) => cors({origin:(origin)=>origin && c.env.ALLOWED_ORIGINS.split(',').map((item)=>item.trim()).includes(origin)?origin:'',allowHeaders:['Authorization','Content-Type','X-Trigg-Secret'],allowMethods:['GET','POST','PATCH','DELETE','OPTIONS'],credentials:true})(c,next));

async function authenticate(token:string,env:Bindings) {
  if(env.TRIGG_MOCK_MODE==='true' && token==='mock-token') return {firebaseUid:'mock-user',email:'developer@trigg.local',displayName:'Trigg Developer'};
  if(!env.FIREBASE_PROJECT_ID) throw new Error('Firebase is not configured');
  const jwks=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
  const {payload}=await jwtVerify(token,jwks,{issuer:`https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,audience:env.FIREBASE_PROJECT_ID});
  if(!payload.sub||typeof payload.email!=='string') throw new Error('Invalid Firebase identity');
  return {firebaseUid:payload.sub,email:payload.email,displayName:typeof payload.name==='string'?payload.name:undefined,photoUrl:typeof payload.picture==='string'?payload.picture:undefined};
}

app.use('/api/*',async(c,next)=>{
  const token=c.req.header('authorization')?.replace(/^Bearer\s+/i,''); if(!token) return fail('UNAUTHORIZED','Authentication required',401);
  try {
    const identity=await authenticate(token,c.env); const timestamp=now(); const existing=await c.env.DB.prepare('SELECT * FROM users WHERE firebase_uid = ?').bind(identity.firebaseUid).first<Record<string,string>>();
    const id=existing?.id ?? uuid('usr');
    if(!existing) await c.env.DB.prepare('INSERT INTO users (id,firebase_uid,email,display_name,photo_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(id,identity.firebaseUid,identity.email,identity.displayName??null,identity.photoUrl??null,timestamp,timestamp).run();
    c.set('user',{id,firebaseUid:identity.firebaseUid,email:identity.email,...(identity.displayName?{displayName:identity.displayName}:{}),...(identity.photoUrl?{photoUrl:identity.photoUrl}:{})}); await next();
  } catch(error){return fail('UNAUTHORIZED',error instanceof Error?error.message:'Invalid token',401);}
});

app.get('/',(c)=>c.json(ok({name:'Trigg API',tagline:'Automate what happens next.',environment:c.env.ENVIRONMENT})));
app.get('/health',(c)=>c.json(ok({status:'ok',time:now()})));
app.get('/api/me',(c)=>c.json(ok(c.get('user'))));
app.get('/api/node-definitions',async(c)=>c.json(ok({templates:WORKFLOW_TEMPLATES})));

app.get('/api/dashboard',async(c)=>{
  const user=c.get('user');
  const [workflows,executions,ai,recent]=await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) total FROM workflows WHERE user_id=? AND enabled=1').bind(user.id).first<{total:number}>(),
    c.env.DB.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) successful FROM workflow_executions WHERE user_id=? AND date(started_at)=date('now')").bind(user.id).first<{total:number;successful:number}>(),
    c.env.DB.prepare("SELECT COUNT(*) requests, COALESCE(SUM(input_tokens+output_tokens),0) tokens FROM ai_usage a JOIN workflow_executions e ON e.id=a.execution_id WHERE e.user_id=? AND date(a.created_at)=date('now')").bind(user.id).first<{requests:number;tokens:number}>(),
    c.env.DB.prepare('SELECT e.*,w.name workflow_name FROM workflow_executions e JOIN workflows w ON w.id=e.workflow_id WHERE e.user_id=? ORDER BY e.started_at DESC LIMIT 5').bind(user.id).all(),
  ]);
  const total=executions?.total??0; return c.json(ok({activeWorkflows:workflows?.total??0,executionsToday:total,successRate:total?Math.round(((executions?.successful??0)/total)*100):100,aiRuns:ai?.requests??0,aiTokens:ai?.tokens??0,recent:recent.results}));
});

app.get('/api/workflows',async(c)=>{const result=await c.env.DB.prepare('SELECT w.*, COUNT(e.id) run_count FROM workflows w LEFT JOIN workflow_executions e ON e.workflow_id=w.id WHERE w.user_id=? GROUP BY w.id ORDER BY w.updated_at DESC').bind(c.get('user').id).all();return c.json(ok(result.results));});
app.post('/api/workflows',async(c)=>{
  const body=workflowDefinitionSchema.omit({id:true,version:true}).extend({id:z.string().optional(),version:z.number().optional()}).parse(await c.req.json());
  const definition:WorkflowDefinition={...body,id:body.id??uuid('wf'),version:body.version??1}; const trigger=definition.nodes.find((node)=>node.category==='trigger'); if(!trigger)return fail('INVALID_WORKFLOW','A trigger is required');
  const timestamp=now(); const webhookId=trigger.type==='trigger.webhook'?uuid('hook'):null;
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO workflows (id,user_id,name,description,enabled,current_version,trigger_type,trigger_event,trigger_action,webhook_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(definition.id,c.get('user').id,definition.name,definition.description,definition.enabled?1:0,1,trigger.type,String(trigger.config.event??''),String(trigger.config.action??''),webhookId,timestamp,timestamp),
    c.env.DB.prepare('INSERT INTO workflow_versions (id,workflow_id,version,definition_json,created_at) VALUES (?,?,?,?,?)').bind(uuid('wfv'),definition.id,1,JSON.stringify(definition),timestamp),
  ]);
  return c.json(ok({...definition,webhookId}),201);
});

async function ownedWorkflow(env:Bindings,userId:string,id:string){return env.DB.prepare('SELECT w.*,v.definition_json FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=w.current_version WHERE w.id=? AND w.user_id=?').bind(id,userId).first<Record<string,string|number>>();}
app.get('/api/workflows/:id',async(c)=>{const row=await ownedWorkflow(c.env,c.get('user').id,c.req.param('id'));return row?c.json(ok({...parseJson<WorkflowDefinition>(String(row.definition_json),{} as WorkflowDefinition),webhookId:row.webhook_id})):fail('NOT_FOUND','Workflow not found',404);});
app.patch('/api/workflows/:id',async(c)=>{
  const current=await ownedWorkflow(c.env,c.get('user').id,c.req.param('id')); if(!current)return fail('NOT_FOUND','Workflow not found',404);
  const body=workflowDefinitionSchema.parse(await c.req.json()); const version=Number(current.current_version)+1; const definition={...body,id:c.req.param('id'),version}; const trigger=definition.nodes.find((node)=>node.category==='trigger'); if(!trigger)return fail('INVALID_WORKFLOW','A trigger is required');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE workflows SET name=?,description=?,enabled=?,current_version=?,trigger_type=?,trigger_event=?,trigger_action=?,updated_at=? WHERE id=? AND user_id=?').bind(definition.name,definition.description,definition.enabled?1:0,version,trigger.type,String(trigger.config.event??''),String(trigger.config.action??''),now(),definition.id,c.get('user').id),
    c.env.DB.prepare('INSERT INTO workflow_versions (id,workflow_id,version,definition_json,created_at) VALUES (?,?,?,?,?)').bind(uuid('wfv'),definition.id,version,JSON.stringify(definition),now()),
  ]); return c.json(ok(definition));
});
app.delete('/api/workflows/:id',async(c)=>{const result=await c.env.DB.prepare('DELETE FROM workflows WHERE id=? AND user_id=?').bind(c.req.param('id'),c.get('user').id).run();return result.meta.changes?c.json(ok({deleted:true})):fail('NOT_FOUND','Workflow not found',404);});
app.post('/api/workflows/:id/activate',async(c)=>toggle(c,true)); app.post('/api/workflows/:id/deactivate',async(c)=>toggle(c,false));
async function toggle(c:AppContext,enabled:boolean){const user=c.get('user');const result=await c.env.DB.prepare('UPDATE workflows SET enabled=?,updated_at=? WHERE id=? AND user_id=?').bind(enabled?1:0,now(),c.req.param('id'),user.id).run();return result.meta.changes?c.json(ok({enabled})):fail('NOT_FOUND','Workflow not found',404);}
app.post('/api/workflows/:id/test',async(c)=>{const row=await ownedWorkflow(c.env,c.get('user').id,c.req.param('id'));if(!row)return fail('NOT_FOUND','Workflow not found',404);const input=await c.req.json().catch(()=>({}));await c.env.WORKFLOW_QUEUE.send({kind:'workflow-run',workflowId:c.req.param('id'),userId:c.get('user').id,input,mode:'TEST'} satisfies QueueMessage);return c.json(ok({queued:true}),202);});

app.get('/api/executions',async(c)=>{const result=await c.env.DB.prepare('SELECT e.*,w.name workflow_name FROM workflow_executions e JOIN workflows w ON w.id=e.workflow_id WHERE e.user_id=? ORDER BY e.started_at DESC LIMIT 100').bind(c.get('user').id).all();return c.json(ok(result.results));});
app.get('/api/executions/:id',async(c)=>{const execution=await c.env.DB.prepare('SELECT e.*,w.name workflow_name,v.definition_json FROM workflow_executions e JOIN workflows w ON w.id=e.workflow_id JOIN workflow_versions v ON v.workflow_id=e.workflow_id AND v.version=e.workflow_version WHERE e.id=? AND e.user_id=?').bind(c.req.param('id'),c.get('user').id).first();if(!execution)return fail('NOT_FOUND','Execution not found',404);const nodes=await c.env.DB.prepare('SELECT * FROM node_executions WHERE execution_id=? ORDER BY started_at').bind(c.req.param('id')).all();const usage=await c.env.DB.prepare('SELECT * FROM ai_usage WHERE execution_id=?').bind(c.req.param('id')).all();return c.json(ok({execution,nodes:nodes.results,aiUsage:usage.results}));});

app.get('/api/integrations/github',async(c)=>{const installs=await c.env.DB.prepare('SELECT g.*,COUNT(r.id) repository_count FROM github_installations g LEFT JOIN repositories r ON r.installation_id=g.id WHERE g.user_id=? GROUP BY g.id').bind(c.get('user').id).all();return c.json(ok({configured:Boolean(c.env.GITHUB_APP_ID),appSlug:c.env.GITHUB_APP_SLUG??null,installations:installs.results}));});
app.get('/api/github/repositories',async(c)=>{const result=await c.env.DB.prepare('SELECT * FROM repositories WHERE user_id=? ORDER BY full_name').bind(c.get('user').id).all();return c.json(ok(result.results));});
app.post('/api/integrations/github/connect',async(c)=>{if(!c.env.GITHUB_APP_SLUG)return fail('NOT_CONFIGURED','GitHub App slug is not configured');return c.json(ok({url:`https://github.com/apps/${c.env.GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(c.get('user').id)}`}));});
app.post('/api/integrations/github/callback',async(c)=>{
  const {installationId}=z.object({installationId:z.coerce.string().min(1)}).parse(await c.req.json());
  if(!c.env.GITHUB_APP_ID||!c.env.GITHUB_PRIVATE_KEY)return fail('NOT_CONFIGURED','GitHub App credentials are not configured',500);
  const client=new GitHubAppClient(c.env.GITHUB_APP_ID,c.env.GITHUB_PRIVATE_KEY,installationId);
  const result=await client.request<{repositories:Array<{id:number;full_name:string;private:boolean;default_branch:string;owner:{login:string}}>}>('GET','/installation/repositories');
  const user=c.get('user');const timestamp=now();const localInstallationId=uuid('ghi');const accountLogin=result.repositories[0]?.owner.login??'GitHub account';
  await c.env.DB.prepare('INSERT INTO github_installations (id,user_id,installation_id,account_login,account_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(installation_id) DO UPDATE SET user_id=excluded.user_id,account_login=excluded.account_login,updated_at=excluded.updated_at').bind(localInstallationId,user.id,installationId,accountLogin,'User',timestamp,timestamp).run();
  const installed=await c.env.DB.prepare('SELECT id FROM github_installations WHERE installation_id=? AND user_id=?').bind(installationId,user.id).first<{id:string}>();
  for(const repository of result.repositories)await c.env.DB.prepare('INSERT INTO repositories (id,user_id,installation_id,github_repository_id,full_name,private,default_branch,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,github_repository_id) DO UPDATE SET installation_id=excluded.installation_id,full_name=excluded.full_name,private=excluded.private,default_branch=excluded.default_branch,updated_at=excluded.updated_at').bind(uuid('repo'),user.id,installed?.id??localInstallationId,String(repository.id),repository.full_name,repository.private?1:0,repository.default_branch,timestamp,timestamp).run();
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

function aiProvider(env:Bindings):AIProvider{return env.TRIGG_MOCK_MODE==='true'?new MockAIProvider():new WorkersAIProvider(env.AI,env.AI_MODEL);}
function executors(env:Bindings,executionId:string,installationId?:string):Record<string,NodeExecutor>{
  const ai=aiProvider(env);
  const runAI=async(node:WorkflowNode,context:ExecutionContext,structured=false)=>{const request={prompt:`${String(node.config.prompt??'Analyze the following event')}\n${JSON.stringify(context).slice(0,60000)}`};if(structured){const result=await ai.generateStructured(request,CodeReviewSchema);await recordAI(env,executionId,node.id,result.usage);return result.data;}const result=await ai.generate(request);await recordAI(env,executionId,node.id,result);return {text:result.text};};
  const github=installationId&&env.GITHUB_APP_ID&&env.GITHUB_PRIVATE_KEY?new GitHubAppClient(env.GITHUB_APP_ID,env.GITHUB_PRIVATE_KEY,installationId):null;
  return {
    'ai.prompt':(node,context)=>runAI(node,context),'ai.classifier':(node,context)=>runAI(node,context),'ai.extract':(node,context)=>runAI(node,context),'ai.summarize':(node,context)=>runAI(node,context),'ai.agent':(node,context)=>runAI(node,context),'ai.codeReview':(node,context)=>runAI(node,context,true),
    'logic.transform':async(node)=>node.config.mapping,'logic.delay':async(node)=>({waitingSeconds:node.config.seconds}),
    'action.save':async(node)=>node.config.value,
    'action.email':async(node)=>{const provider=env.RESEND_API_KEY&&env.TRIGG_MOCK_MODE!=='true'?new ResendEmailProvider(env.RESEND_API_KEY,env.EMAIL_FROM):new LogEmailProvider();const result=await provider.send({to:String(node.config.to),subject:String(node.config.subject),body:String(node.config.body)});await env.DB.prepare('INSERT INTO email_logs (id,execution_id,recipient_masked,provider,status,created_at) VALUES (?,?,?,?,?,?)').bind(uuid('email'),executionId,String(node.config.to).replace(/^(.{2}).+(@.+)$/,'$1***$2'),result.provider,'sent',now()).run();return result;},
    'action.githubComment':async(node)=>{if(!github)throw new Error('GitHub App installation is required');return github.comment(String(node.config.repository),Number(node.config.issueNumber),String(node.config.body));},
    'action.githubIssue':async(node)=>{if(!github)throw new Error('GitHub App installation is required');return github.createIssue(String(node.config.repository),String(node.config.title),String(node.config.body),node.config.labels as string[]|undefined);},
    'action.http':async(node)=>{const url=assertSafeHttpUrl(String(node.config.url));const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Number(node.config.timeout??10000));const method=String(node.config.method);try{const response=await fetch(url,{method,...(node.config.headers?{headers:node.config.headers as Record<string,string>}:{}),...(['GET','HEAD'].includes(method)?{}:{body:String(node.config.body??'')}),signal:controller.signal,redirect:'error'});return {status:response.status,ok:response.ok,body:(await response.text()).slice(0,10000)};}finally{clearTimeout(timer);}},
  };
}
async function recordAI(env:Bindings,executionId:string,nodeId:string,usage:{provider:string;model:string;inputTokens:number;outputTokens:number;durationMs:number}){await env.DB.prepare('INSERT INTO ai_usage (id,execution_id,node_id,provider,model,input_tokens,output_tokens,duration_ms,estimated_cost,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(uuid('ai'),executionId,nodeId,usage.provider,usage.model,usage.inputTokens,usage.outputTokens,usage.durationMs,0,now()).run();}

async function runWorkflow(env:Bindings,message:Extract<QueueMessage,{kind:'workflow-run'}>){
  const row=await ownedWorkflow(env,message.userId,message.workflowId); if(!row)throw new Error('Workflow not found'); const workflow=parseJson<WorkflowDefinition>(String(row.definition_json),{} as WorkflowDefinition); const executionId=uuid('exec'); const started=Date.now();
  const daily=await env.DB.prepare("SELECT COUNT(*) total FROM workflow_executions WHERE user_id=? AND date(started_at)=date('now')").bind(message.userId).first<{total:number}>(); if((daily?.total??0)>=Number(env.FREE_DAILY_RUN_LIMIT))throw new Error('Daily workflow run limit reached');
  await env.DB.prepare('INSERT INTO workflow_executions (id,workflow_id,workflow_version,user_id,status,mode,trigger_json,started_at) VALUES (?,?,?,?,?,?,?,?)').bind(executionId,workflow.id,workflow.version,message.userId,'running',message.mode,JSON.stringify(message.input),now()).run();
  const result=await executeWorkflow(workflow,message.input,executors(env,executionId,typeof message.input.installationId==='string'?message.input.installationId:undefined));
  for(const node of result.nodes)await env.DB.prepare('INSERT INTO node_executions (id,execution_id,node_id,status,input_json,output_json,error,duration_ms,started_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(uuid('nexec'),executionId,node.nodeId,node.status,JSON.stringify(node.input),node.output===undefined?null:JSON.stringify(node.output),node.error??null,node.durationMs,new Date(started).toISOString()).run();
  await env.DB.prepare('UPDATE workflow_executions SET status=?,outputs_json=?,error=?,completed_at=?,duration_ms=? WHERE id=?').bind(result.status,JSON.stringify(result.outputs),result.nodes.find((node)=>node.error)?.error??null,now(),Date.now()-started,executionId).run();
}

async function processGitHubEvent(env:Bindings,eventId:string){
  const event=await env.DB.prepare('SELECT * FROM webhook_events WHERE id=?').bind(eventId).first<Record<string,string>>();if(!event)return;
  const payload=parseJson<Record<string,unknown>>(event.payload_json??null,{}); const workflows=await env.DB.prepare("SELECT w.*,r.github_repository_id FROM workflows w LEFT JOIN repositories r ON r.id=w.repository_id WHERE w.enabled=1 AND w.trigger_type='trigger.github' AND w.trigger_event=? AND (w.trigger_action=? OR w.trigger_action='') AND (r.github_repository_id=? OR w.repository_id IS NULL)").bind(event.event??'',event.action??'',event.repository_id??'').all<Record<string,string>>();
  for(const workflow of workflows.results){await runWorkflow(env,{kind:'workflow-run',workflowId:String(workflow.id),userId:String(workflow.user_id),input:{github:payload,installationId:event.installation_id,event:event.event,action:event.action},mode:'LIVE'});}
  await env.DB.prepare("UPDATE webhook_events SET status='processed',processed_at=? WHERE id=?").bind(now(),eventId).run();
}

const handler:ExportedHandler<Bindings,QueueMessage>={
  fetch:app.fetch,
  async queue(batch,env){for(const message of batch.messages){try{if(message.body.kind==='github-event')await processGitHubEvent(env,message.body.eventId);else await runWorkflow(env,message.body);message.ack();}catch(error){console.error(JSON.stringify({event:'queue.error',messageId:message.id,error:error instanceof Error?error.message:'Unknown'}));message.retry();}}},
};
export default handler;
