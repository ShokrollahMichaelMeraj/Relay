-- Relay Database Schema v1
-- This migration creates all core tables for workflow orchestration

-- =============================================================================
-- 1. WORKFLOWS TABLE
-- Purpose: Store workflow definitions (from YAML files)
-- =============================================================================
CREATE TABLE workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    definition JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflows_created_at ON workflows(created_at DESC);

-- =============================================================================
-- 2. RUNS TABLE
-- Purpose: Track execution instances of workflows
-- =============================================================================
CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED')),
    input JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX idx_runs_workflow_id ON runs(workflow_id);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_runs_started_at ON runs(started_at DESC);

-- =============================================================================
-- 3. TASKS TABLE
-- Purpose: Static task definitions extracted from workflows
-- =============================================================================
CREATE TABLE tasks (
    id TEXT NOT NULL,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    config JSONB NOT NULL,
    requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (id, workflow_id)
);

CREATE INDEX idx_tasks_workflow_id ON tasks(workflow_id);

-- =============================================================================
-- 4. DEPENDENCIES TABLE
-- Purpose: Define DAG edges (which tasks depend on which)
-- =============================================================================
CREATE TABLE dependencies (
    id SERIAL PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    depends_on_task_id TEXT NOT NULL,
    FOREIGN KEY (task_id, workflow_id) REFERENCES tasks(id, workflow_id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on_task_id, workflow_id) REFERENCES tasks(id, workflow_id) ON DELETE CASCADE,
    UNIQUE (workflow_id, task_id, depends_on_task_id)
);

CREATE INDEX idx_dependencies_task ON dependencies(workflow_id, task_id);
CREATE INDEX idx_dependencies_depends_on ON dependencies(workflow_id, depends_on_task_id);

-- =============================================================================
-- 5. TASK_RUNS TABLE
-- Purpose: Execution instances of individual tasks (THE STATE MACHINE)
-- =============================================================================
CREATE TABLE task_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN (
        'PENDING', 'READY', 'QUEUED', 'RUNNING', 
        'SUCCESS', 'FAILED', 'BLOCKED', 'CANCELLED'
    )),
    attempt INTEGER NOT NULL DEFAULT 0,
    input JSONB,
    output TEXT,
    error TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    heartbeat_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (task_id, workflow_id) REFERENCES tasks(id, workflow_id)
);

CREATE INDEX idx_task_runs_status_run ON task_runs(status, run_id);
CREATE INDEX idx_task_runs_run_id ON task_runs(run_id);
CREATE INDEX idx_task_runs_heartbeat ON task_runs(heartbeat_at) WHERE status = 'RUNNING';
CREATE INDEX idx_task_runs_task_workflow ON task_runs(task_id, workflow_id);

-- =============================================================================
-- 6. ARTIFACTS TABLE
-- Purpose: Store task outputs separately
-- =============================================================================
CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    task_run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'text/plain',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_artifacts_task_run_id ON artifacts(task_run_id);

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workflows_updated_at
    BEFORE UPDATE ON workflows
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- VERIFICATION
-- =============================================================================
DO $$
BEGIN
    RAISE NOTICE 'Schema initialized successfully - 6 tables created';
END $$;