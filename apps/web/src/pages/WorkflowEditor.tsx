import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import {
  ArrowLeft,
  Bot,
  Braces,
  Check,
  ChevronRight,
  CircleDot,
  Clock,
  Copy,
  Database,
  FileText,
  GitBranch,
  Github,
  Globe2,
  Mail,
  MessageSquare,
  Play,
  Plus,
  Save,
  Search,
  Settings2,
  Sparkles,
  Tags,
  Trash2,
  Webhook,
  Zap,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import {
  nodeRegistry,
  type NodeCategory,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@trigg/shared';
import { api } from '../lib/api';
import { useWorkflowStore } from '../lib/store';

const icons: Record<string, React.ComponentType<{ size?: number }>> = {
  Github,
  Webhook,
  Play,
  Sparkles,
  Tags,
  FileText,
  Bot,
  GitBranch,
  Braces,
  Clock,
  Mail,
  MessageSquare,
  CircleDot,
  Globe2,
  Database,
};
const colors: Record<NodeCategory, string> = {
  trigger: '#8b5cf6',
  ai: '#ff5a1f',
  logic: '#2dd4bf',
  action: '#3b82f6',
};
type FlowData = {
  label: string;
  subtitle: string;
  category: NodeCategory;
  icon: string;
  selected?: boolean;
};
type FlowNode = Node<FlowData, 'trigg'>;

function TriggNode({ data, selected }: NodeProps<FlowNode>) {
  const Icon = icons[data.icon] ?? Zap;
  return (
    <div
      className={`canvas-node node-${data.category} ${selected ? 'selected' : ''}`}
    >
      <Handle type="target" position={Position.Left} />
      <span className="node-icon">
        <Icon size={17} />
      </span>
      <div>
        <small>{data.category.toUpperCase()}</small>
        <b>{data.label}</b>
        <em>{data.subtitle}</em>
      </div>
      <span className="node-menu">•••</span>
      <Handle type="source" position={Position.Right} id="default" />
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        className="condition-handle"
      />
    </div>
  );
}

export function WorkflowEditor() {
  const { id } = useParams();
  const { draft, selectedNode, dirty, setDraft, select, update, markSaved } =
    useWorkflowStore();
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const query = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => api<WorkflowDefinition>(`/api/workflows/${id}`),
    enabled: Boolean(id),
  });
  useEffect(() => {
    if (query.data) setDraft(query.data);
  }, [query.data, setDraft]);
  const save = useMutation({
    mutationFn: (workflow: WorkflowDefinition) =>
      api<WorkflowDefinition>(`/api/workflows/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(workflow),
      }),
    onSuccess: (workflow) => {
      setDraft(workflow);
      markSaved();
      setNotice('Saved as an immutable version');
      setTimeout(() => setNotice(''), 2200);
    },
  });
  const test = useMutation({
    mutationFn: () =>
      api<{ queued: boolean }>(`/api/workflows/${id}/test`, {
        method: 'POST',
        body: JSON.stringify({
          manual: { message: 'Hello from Trigg', score: 82 },
          github: {
            repository: 'example/api',
            prNumber: 142,
            title: 'Improve webhook security',
            diff: '+ validate signature',
          },
        }),
      }),
    onSuccess: () => {
      setNotice('Test execution queued');
      setTimeout(() => setNotice(''), 2200);
    },
  });
  const nodeTypes = useMemo(() => ({ trigg: TriggNode }), []);
  const nodes = useMemo<FlowNode[]>(
    () =>
      draft?.nodes.map((node) => {
        const definition = nodeRegistry.get(node.type);
        return {
          id: node.id,
          type: 'trigg',
          position: node.position,
          data: {
            label: node.name,
            subtitle: definition?.description ?? node.type,
            category: node.category,
            icon: definition?.icon ?? 'Zap',
          },
        };
      }) ?? [],
    [draft],
  );
  const edges = useMemo<Edge[]>(
    () =>
      draft?.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
        animated: true,
        style: { stroke: '#4b5563', strokeWidth: 1.5 },
      })) ?? [],
    [draft],
  );
  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const changed = applyNodeChanges(changes, nodes);
    update((workflow) => ({
      ...workflow,
      nodes: workflow.nodes
        .map((node) => {
          const found = changed.find((item) => item.id === node.id);
          return found ? { ...node, position: found.position } : node;
        })
        .filter((node) => changed.some((item) => item.id === node.id)),
    }));
  };
  const onEdgesChange = (changes: EdgeChange<Edge>[]) => {
    const changed = applyEdgeChanges(changes, edges);
    update((workflow) => ({
      ...workflow,
      edges: changed.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.sourceHandle === 'true' || edge.sourceHandle === 'false'
          ? { sourceHandle: edge.sourceHandle }
          : {}),
      })),
    }));
  };
  const onConnect = (connection: Connection) => {
    const changed = addEdge({ ...connection, id: crypto.randomUUID() }, edges);
    update((workflow) => ({
      ...workflow,
      edges: changed.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.sourceHandle === 'true' || edge.sourceHandle === 'false'
          ? { sourceHandle: edge.sourceHandle }
          : {}),
      })),
    }));
  };
  const addNode = (type: string) => {
    const definition = nodeRegistry.get(type);
    if (!definition) return;
    const node: WorkflowNode = {
      id: `node_${crypto.randomUUID().slice(0, 8)}`,
      type,
      name: definition.title,
      category: definition.category,
      position: {
        x: 260 + (draft?.nodes.length ?? 0) * 25,
        y: 160 + (draft?.nodes.length ?? 0) * 25,
      },
      config: defaultConfig(type),
    };
    update((workflow) => ({ ...workflow, nodes: [...workflow.nodes, node] }));
    select(node.id);
  };
  const selected = draft?.nodes.find((node) => node.id === selectedNode);
  const definitions = nodeRegistry
    .list()
    .filter((definition) =>
      `${definition.title} ${definition.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  if (!draft)
    return <div className="editor-loading">Loading workflow canvas…</div>;
  return (
    <div className="workflow-editor">
      <header className="editor-header">
        <Link to="/workflows" aria-label="Back to workflows">
          <ArrowLeft />
        </Link>
        <div>
          <input
            aria-label="Workflow name"
            value={draft.name}
            onChange={(event) =>
              update((workflow) => ({ ...workflow, name: event.target.value }))
            }
          />
          <span>{dirty ? 'Unsaved changes' : `Version ${draft.version}`}</span>
        </div>
        <div className="editor-actions">
          <button
            className="button"
            onClick={() => test.mutate()}
            disabled={test.isPending}
          >
            <Play size={14} />
            Run test
          </button>
          <button
            className="button primary"
            onClick={() => save.mutate(draft)}
            disabled={!dirty || save.isPending}
          >
            <Save size={14} />
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) =>
                update((workflow) => ({
                  ...workflow,
                  enabled: event.target.checked,
                }))
              }
            />
            <span />
            Active
          </label>
        </div>
      </header>
      <aside className="node-palette">
        <header>
          <b>Nodes</b>
          <button aria-label="Collapse palette">
            <ChevronRight size={14} />
          </button>
        </header>
        <label className="node-search">
          <Search size={14} />
          <input
            placeholder="Search nodes…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {(['trigger', 'ai', 'logic', 'action'] as NodeCategory[]).map(
          (category) => {
            const list = definitions.filter(
              (definition) => definition.category === category,
            );
            return list.length ? (
              <section key={category}>
                <h3>
                  <i style={{ background: colors[category] }} />
                  {category === 'ai'
                    ? 'AI'
                    : `${category[0]?.toUpperCase()}${category.slice(1)}s`}
                </h3>
                {list.map((definition) => {
                  const Icon = icons[definition.icon] ?? Zap;
                  return (
                    <button
                      key={definition.type}
                      onClick={() => addNode(definition.type)}
                    >
                      <span style={{ color: colors[category] }}>
                        <Icon size={16} />
                      </span>
                      <div>
                        <b>{definition.title}</b>
                        <small>{definition.description}</small>
                      </div>
                      <Plus size={13} />
                    </button>
                  );
                })}
              </section>
            ) : null;
          },
        )}
      </aside>
      <main className="editor-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => select(node.id)}
          fitView
          minZoom={0.2}
          maxZoom={1.8}
          deleteKeyCode={['Backspace', 'Delete']}
        >
          <Background color="#25272d" gap={24} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) => colors[(node.data as FlowData).category]}
          />
          <Controls />
        </ReactFlow>
        <div className="desktop-hint">
          Workflow editing is best experienced on desktop.
        </div>
        {notice && (
          <div className="toast">
            <Check size={15} />
            {notice}
          </div>
        )}
      </main>
      {selected ? (
        <NodeInspector
          node={selected}
          onClose={() => select(null)}
          updateNode={(next) =>
            update((workflow) => ({
              ...workflow,
              nodes: workflow.nodes.map((node) =>
                node.id === next.id ? next : node,
              ),
            }))
          }
          duplicate={() => {
            const copy = {
              ...selected,
              id: `node_${crypto.randomUUID().slice(0, 8)}`,
              name: `${selected.name} copy`,
              position: {
                x: selected.position.x + 30,
                y: selected.position.y + 30,
              },
            };
            update((workflow) => ({
              ...workflow,
              nodes: [...workflow.nodes, copy],
            }));
            select(copy.id);
          }}
          remove={() => {
            update((workflow) => ({
              ...workflow,
              nodes: workflow.nodes.filter((node) => node.id !== selected.id),
              edges: workflow.edges.filter(
                (edge) =>
                  edge.source !== selected.id && edge.target !== selected.id,
              ),
            }));
            select(null);
          }}
        />
      ) : (
        <aside className="inspector empty-inspector">
          <Settings2 />
          <h3>Node settings</h3>
          <p>Select a node to configure it and inspect sample outputs.</p>
        </aside>
      )}
    </div>
  );
}

function NodeInspector({
  node,
  onClose,
  updateNode,
  duplicate,
  remove,
}: {
  node: WorkflowNode;
  onClose: () => void;
  updateNode: (node: WorkflowNode) => void;
  duplicate: () => void;
  remove: () => void;
}) {
  const definition = nodeRegistry.get(node.type);
  const config = JSON.stringify(node.config, null, 2);
  return (
    <aside className="inspector">
      <header>
        <div>
          <small>{node.category.toUpperCase()}</small>
          <b>{definition?.title}</b>
        </div>
        <button onClick={onClose}>×</button>
      </header>
      <label>
        Node name
        <input
          value={node.name}
          onChange={(event) =>
            updateNode({ ...node, name: event.target.value })
          }
        />
      </label>
      <label>
        Configuration <small>JSON</small>
        <textarea
          rows={12}
          value={config}
          onChange={(event) => {
            try {
              updateNode({
                ...node,
                config: JSON.parse(event.target.value) as Record<
                  string,
                  unknown
                >,
              });
            } catch {
              /* Keep the last valid configuration while JSON is incomplete. */
            }
          }}
        />
      </label>
      <section className="sample-output">
        <header>
          <b>Sample output</b>
          <span>TEST DATA</span>
        </header>
        <pre>{JSON.stringify(sampleOutput(node.type), null, 2)}</pre>
      </section>
      <div className="inspector-actions">
        <button onClick={duplicate}>
          <Copy size={14} />
          Duplicate
        </button>
        <button className="danger" onClick={remove}>
          <Trash2 size={14} />
          Delete
        </button>
      </div>
    </aside>
  );
}
function defaultConfig(type: string): Record<string, unknown> {
  if (type === 'logic.condition')
    return { expression: '{{ai.riskScore}} >= 70' };
  if (type.startsWith('ai.'))
    return {
      prompt:
        'Analyze the incoming event and return a useful structured result.',
    };
  if (type === 'action.email')
    return {
      to: 'team@example.com',
      subject: 'Trigg alert',
      body: '{{ai.summary}}',
    };
  if (type === 'action.http')
    return {
      method: 'POST',
      url: 'https://example.com/webhook',
      timeout: 10000,
    };
  if (type === 'trigger.github')
    return { event: 'pull_request', action: 'opened' };
  if (type === 'trigger.webhook') return { auth: 'secret' };
  return {};
}
function sampleOutput(type: string) {
  if (type === 'ai.codeReview')
    return {
      summary: 'Potential error handling gap.',
      riskScore: 82,
      severity: 'high',
      recommendation: 'request_changes',
    };
  if (type === 'logic.condition') return { result: true };
  if (type.startsWith('trigger.github'))
    return { repository: 'example/api', prNumber: 142, action: 'opened' };
  return { success: true, id: 'sample_123' };
}
