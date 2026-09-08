import { nodeRegistry, workflowDefinitionSchema, type WorkflowDefinition, type WorkflowNode } from '@trigg/shared';

export type ExecutionContext = Record<string, unknown>;
export interface NodeRun { nodeId: string; status: 'success'|'failed'|'skipped'; input: unknown; output?: unknown; error?: string; durationMs: number }
export interface WorkflowRun { status: 'success'|'failed'; outputs: ExecutionContext; nodes: NodeRun[] }
export type NodeExecutor = (node: WorkflowNode, context: ExecutionContext) => Promise<unknown>;

const TOKEN = /{{\s*([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)\s*}}/g;

export function resolvePath(context: ExecutionContext, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, context);
}

export function interpolate(template: string, context: ExecutionContext): string {
  return template.replace(TOKEN, (_, path: string) => {
    const value = resolvePath(context, path);
    return value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  });
}

export function interpolateValue(value: unknown, context: ExecutionContext): unknown {
  if (typeof value === 'string') {
    const exact = value.match(/^{{\s*([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)\s*}}$/);
    return exact?.[1] ? resolvePath(context, exact[1]) : interpolate(value, context);
  }
  if (Array.isArray(value)) return value.map((item) => interpolateValue(item, context));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key, interpolateValue(item, context)]));
  return value;
}

const OPERATORS = ['>=','<=','==','!=','>','<'] as const;
export function evaluateCondition(expression: string, context: ExecutionContext): boolean {
  const operator = OPERATORS.find((candidate) => expression.includes(candidate));
  if (!operator) throw new Error('Condition must contain a supported comparison operator');
  const parts = expression.split(operator, 2).map((part) => part.trim());
  const leftRaw = parts[0] ?? '';
  const rightRaw = parts[1] ?? '';
  const parse = (raw: string): unknown => {
    const variable = raw.match(/^{{\s*([^}]+)\s*}}$/)?.[1]?.trim();
    if (variable) return resolvePath(context, variable);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    return raw.replace(/^['"]|['"]$/g, '');
  };
  const left = parse(leftRaw); const right = parse(rightRaw);
  if (operator === '==') return left === right;
  if (operator === '!=') return left !== right;
  if (typeof left !== 'number' || typeof right !== 'number') throw new Error('Ordering comparisons require numbers');
  if (operator === '>') return left > right;
  if (operator === '<') return left < right;
  if (operator === '>=') return left >= right;
  return left <= right;
}

export function validateWorkflow(input: WorkflowDefinition): { valid: boolean; errors: string[]; order: string[] } {
  const parsed = workflowDefinitionSchema.safeParse(input);
  if (!parsed.success) return { valid: false, errors: parsed.error.issues.map((issue) => issue.message), order: [] };
  const ids = new Set(input.nodes.map((node) => node.id));
  const errors: string[] = [];
  for (const node of input.nodes) {
    const definition = nodeRegistry.get(node.type);
    if (!definition) errors.push(`Unknown node type: ${node.type}`);
    else if (!definition.configSchema.safeParse(node.config).success) errors.push(`Invalid config for ${node.name}`);
  }
  for (const edge of input.edges) if (!ids.has(edge.source) || !ids.has(edge.target)) errors.push(`Edge ${edge.id} references a missing node`);
  const incoming = new Map(input.nodes.map((node) => [node.id, 0]));
  input.edges.forEach((edge) => incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1));
  const queue = [...incoming.entries()].filter(([,count]) => count === 0).map(([id]) => id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift(); if (!id) break;
    order.push(id);
    input.edges.filter((edge) => edge.source === id).forEach((edge) => {
      const next = (incoming.get(edge.target) ?? 1) - 1; incoming.set(edge.target, next); if (next === 0) queue.push(edge.target);
    });
  }
  if (order.length !== input.nodes.length) errors.push('Workflow contains a cycle');
  if (!input.nodes.some((node) => node.category === 'trigger')) errors.push('Workflow requires a trigger');
  return { valid: errors.length === 0, errors, order };
}

export async function executeWorkflow(workflow: WorkflowDefinition, initial: ExecutionContext, executors: Record<string, NodeExecutor>): Promise<WorkflowRun> {
  const validation = validateWorkflow(workflow);
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  const context: ExecutionContext = { ...initial };
  const runs: NodeRun[] = [];
  const skipped = new Set<string>();
  for (const id of validation.order) {
    const node = workflow.nodes.find((candidate) => candidate.id === id);
    if (!node) continue;
    if (skipped.has(id)) { runs.push({nodeId:id,status:'skipped',input:null,durationMs:0}); continue; }
    const input = interpolateValue(node.config, context); const started = Date.now();
    try {
      let output: unknown;
      if (node.type === 'logic.condition') output = { result: evaluateCondition(String((input as Record<string, unknown>).expression), context) };
      else if (node.category === 'trigger') output = context[node.id] ?? initial;
      else {
        const executor = executors[node.type];
        if (!executor) throw new Error(`No executor registered for ${node.type}`);
        output = await executor({...node,config: input as Record<string, unknown>}, context);
      }
      context[node.id] = output;
      const skippedByExecutor=Boolean(output&&typeof output==='object'&&(output as {skipped?:unknown}).skipped===true);
      runs.push({nodeId:id,status:skippedByExecutor?'skipped':'success',input,output,durationMs:Date.now()-started});
      if (node.type === 'logic.condition') {
        const result = Boolean((output as {result:boolean}).result);
        workflow.edges.filter((edge) => edge.source === id && edge.sourceHandle && edge.sourceHandle !== String(result)).forEach((edge) => skipped.add(edge.target));
      }
    } catch (error) {
      runs.push({nodeId:id,status:'failed',input,error:error instanceof Error ? error.message : 'Unknown error',durationMs:Date.now()-started});
      return { status:'failed',outputs:context,nodes:runs };
    }
  }
  return { status:'success',outputs:context,nodes:runs };
}
