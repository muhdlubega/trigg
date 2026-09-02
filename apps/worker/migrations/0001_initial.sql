PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY, firebase_uid TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
  display_name TEXT, photo_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE github_installations (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL UNIQUE, account_login TEXT NOT NULL, account_type TEXT NOT NULL DEFAULT 'User',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE repositories (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id TEXT REFERENCES github_installations(id) ON DELETE CASCADE, github_repository_id TEXT NOT NULL,
  full_name TEXT NOT NULL, private INTEGER NOT NULL DEFAULT 0, default_branch TEXT NOT NULL DEFAULT 'main',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id, github_repository_id)
);
CREATE TABLE workflows (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repository_id TEXT REFERENCES repositories(id) ON DELETE SET NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0, current_version INTEGER NOT NULL DEFAULT 1, trigger_type TEXT NOT NULL,
  trigger_event TEXT, trigger_action TEXT, webhook_id TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE workflow_versions (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, definition_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(workflow_id, version)
);
CREATE TABLE workflow_nodes (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, config_json TEXT NOT NULL, position_json TEXT NOT NULL
);
CREATE TABLE workflow_edges (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, source_node_id TEXT NOT NULL, target_node_id TEXT NOT NULL, source_handle TEXT
);
CREATE TABLE workflow_executions (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, workflow_version INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, webhook_event_id TEXT, status TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'LIVE', trigger_json TEXT NOT NULL, outputs_json TEXT, error TEXT,
  started_at TEXT NOT NULL, completed_at TEXT, duration_ms INTEGER
);
CREATE TABLE node_executions (
  id TEXT PRIMARY KEY, execution_id TEXT NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL, status TEXT NOT NULL, input_json TEXT, output_json TEXT, error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL, started_at TEXT NOT NULL
);
CREATE TABLE integration_connections (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, status TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL UNIQUE, event TEXT NOT NULL, action TEXT,
  installation_id TEXT, repository_id TEXT, payload_json TEXT NOT NULL, status TEXT NOT NULL, received_at TEXT NOT NULL, processed_at TEXT
);
CREATE TABLE ai_usage (
  id TEXT PRIMARY KEY, execution_id TEXT NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL, duration_ms INTEGER NOT NULL, estimated_cost REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE email_logs (
  id TEXT PRIMARY KEY, execution_id TEXT NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  recipient_masked TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX idx_workflows_user ON workflows(user_id);
CREATE INDEX idx_workflows_trigger ON workflows(enabled, trigger_event, trigger_action, repository_id);
CREATE INDEX idx_executions_user ON workflow_executions(user_id, started_at DESC);
CREATE INDEX idx_webhook_route ON webhook_events(installation_id, repository_id, event, action);
