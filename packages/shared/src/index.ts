import { z } from 'zod';

export const nodeCategorySchema = z.enum(['trigger', 'ai', 'logic', 'action']);
export type NodeCategory = z.infer<typeof nodeCategorySchema>;

export const workflowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().min(1),
  category: nodeCategorySchema,
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const workflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.enum(['default', 'true', 'false']).optional(),
});

export const workflowDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  enabled: z.boolean().default(false),
  version: z.number().int().positive().default(1),
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
});

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type ExecutionStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'waiting';
export type NodeStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface NodePort { id: string; label: string; dataType: string }
export interface NodeDefinition {
  type: string;
  category: NodeCategory;
  title: string;
  description: string;
  icon: string;
  inputs: NodePort[];
  outputs: NodePort[];
  configSchema: z.ZodType;
}

export interface ApiResponse<T> { data: T; error?: never }
export interface ApiError { data?: never; error: { code: string; message: string } }

const empty = z.object({});
const expression = z.object({ expression: z.string().min(1) });
const prompt = z.object({ prompt: z.string().min(1), model: z.string().optional() });
const definitions: NodeDefinition[] = [
  ['trigger.manual', 'trigger', 'Manual trigger', 'Run on demand or in test mode', 'Play', empty],
  ['trigger.webhook', 'trigger', 'Webhook', 'Receive a signed HTTP event', 'Webhook', z.object({ webhookId: z.string().optional(), auth: z.enum(['none','secret','bearer']).default('none') })],
  ['trigger.github', 'trigger', 'GitHub event', 'Listen for repository events', 'Github', z.object({ event: z.string().default('pull_request'), action: z.string().default('opened'), repositoryId: z.string().optional() })],
  ['ai.prompt', 'ai', 'AI prompt', 'Generate a response from event context', 'Sparkles', prompt],
  ['ai.classifier', 'ai', 'AI classifier', 'Classify input into defined categories', 'Tags', prompt.extend({ categories: z.array(z.string()).min(2) })],
  ['ai.extract', 'ai', 'AI extract', 'Extract structured information', 'ScanText', prompt],
  ['ai.summarize', 'ai', 'AI summarize', 'Create a concise summary', 'FileText', prompt],
  ['ai.codeReview', 'ai', 'AI code review', 'Review a pull request for material risks', 'Bot', prompt.partial()],
  ['ai.agent', 'ai', 'AI agent', 'Use bounded registered tools', 'BrainCircuit', prompt.extend({ maxSteps: z.number().int().min(1).max(5).default(3) })],
  ['logic.condition', 'logic', 'Condition', 'Branch using a safe expression', 'GitBranch', expression],
  ['logic.transform', 'logic', 'Transform', 'Map values into a new object', 'Braces', z.object({ mapping: z.record(z.string(), z.string()) })],
  ['logic.delay', 'logic', 'Delay', 'Pause before continuing', 'Clock', z.object({ seconds: z.number().int().min(1).max(86400) })],
  ['action.email', 'action', 'Send email', 'Send with Resend or log-only mode', 'Mail', z.object({ to: z.string(), subject: z.string(), body: z.string() })],
  ['action.githubComment', 'action', 'GitHub comment', 'Comment on a pull request or issue', 'MessageSquare', z.object({ repository: z.string(), issueNumber: z.union([z.string(),z.number()]), body: z.string() })],
  ['action.githubIssue', 'action', 'Create GitHub issue', 'Create an issue with an installation token', 'CircleDot', z.object({ repository: z.string(), title: z.string(), body: z.string(), labels: z.array(z.string()).optional() })],
  ['action.http', 'action', 'HTTP request', 'Call an external HTTPS endpoint', 'Globe2', z.object({ method: z.enum(['GET','POST','PUT','PATCH','DELETE']), url: z.string().url(), headers: z.record(z.string(), z.string()).optional(), body: z.string().optional(), timeout: z.number().max(30000).default(10000) })],
  ['action.save', 'action', 'Save result', 'Persist an execution result', 'Database', z.object({ value: z.unknown() })],
].map(([type, category, title, description, icon, configSchema]) => ({
  type: type as string,
  category: category as NodeCategory,
  title: title as string,
  description: description as string,
  icon: icon as string,
  inputs: category === 'trigger' ? [] : [{ id: 'input', label: 'Input', dataType: 'unknown' }],
  outputs: category === 'logic' && type === 'logic.condition' ? [{id:'true',label:'True',dataType:'boolean'},{id:'false',label:'False',dataType:'boolean'}] : [{ id: 'output', label: 'Output', dataType: 'unknown' }],
  configSchema: configSchema as z.ZodType,
}));

export class NodeRegistry {
  private readonly nodes = new Map<string, NodeDefinition>();
  register(definition: NodeDefinition) { this.nodes.set(definition.type, definition); return this; }
  get(type: string) { return this.nodes.get(type); }
  list() { return [...this.nodes.values()]; }
}

export const nodeRegistry = definitions.reduce((registry, definition) => registry.register(definition), new NodeRegistry());

export const WORKFLOW_TEMPLATES: WorkflowDefinition[] = [
  {
    id: 'template-pr-review', name: 'AI Pull Request Reviewer', description: 'Review risky pull requests and notify the team', enabled: false, version: 1,
    nodes: [
      {id:'github',type:'trigger.github',name:'PR Opened',category:'trigger',position:{x:0,y:120},config:{event:'pull_request',action:'opened'}},
      {id:'review',type:'ai.codeReview',name:'AI Review',category:'ai',position:{x:280,y:120},config:{}},
      {id:'risk',type:'logic.condition',name:'Risk ≥ 70',category:'logic',position:{x:560,y:120},config:{expression:'{{review.riskScore}} >= 70'}},
      {id:'comment',type:'action.githubComment',name:'Comment on PR',category:'action',position:{x:840,y:50},config:{repository:'{{github.repository}}',issueNumber:'{{github.prNumber}}',body:'{{review.summary}}'}},
      {id:'email',type:'action.email',name:'Send email',category:'action',position:{x:840,y:210},config:{to:'team@example.com',subject:'Risky PR #{{github.prNumber}}',body:'{{review.summary}}'}},
    ],
    edges: [
      {id:'e1',source:'github',target:'review'},{id:'e2',source:'review',target:'risk'},
      {id:'e3',source:'risk',target:'comment',sourceHandle:'true'},{id:'e4',source:'risk',target:'email',sourceHandle:'true'},
    ],
  },
];
