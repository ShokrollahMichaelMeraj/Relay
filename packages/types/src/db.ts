/**
 * Database types - mirror the PostgreSQL schema exactly
 * These types represent rows in our database tables
 */

// =============================================================================
// ENUMS
// =============================================================================

export type RunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

export type TaskRunStatus =
  | 'PENDING'    // Created, dependencies not satisfied
  | 'READY'      // All dependencies satisfied, can be scheduled
  | 'QUEUED'     // Pushed to queue, waiting for worker
  | 'RUNNING'    // Worker claimed and executing
  | 'SUCCESS'    // Completed successfully
  | 'FAILED'     // Failed after retries
  | 'BLOCKED'    // Waiting for human approval
  | 'CANCELLED'; // Cancelled by user

// =============================================================================
// TABLE TYPES
// =============================================================================

export interface Workflow {
  id: string;                    // Workflow identifier (e.g., "demo_prd")
  name: string;                  // Human-readable name
  definition: WorkflowDefinition; // Full workflow structure (stored as JSONB)
  created_at: Date;
  updated_at: Date;
}

export interface Run {
  id: string;                    // Run identifier (e.g., "run_xyz123")
  workflow_id: string;           // Which workflow is running
  status: RunStatus;             // Current run state
  input: Record<string, any> | null; // Runtime parameters
  started_at: Date;
  finished_at: Date | null;      // NULL until terminal state
}

export interface Task {
  id: string;                    // Task identifier (e.g., "research")
  workflow_id: string;           // Parent workflow
  name: string;                  // Human-readable name
  config: TaskConfig;            // Task configuration (stored as JSONB)
  requires_approval: boolean;    // Human-in-the-loop gate
}

export interface Dependency {
  id: number;                    // Auto-increment
  workflow_id: string;
  task_id: string;               // Downstream task (waits)
  depends_on_task_id: string;    // Upstream task (must complete first)
}

export interface TaskRun {
  id: string;                    // Task run identifier (e.g., "tr_abc123")
  run_id: string;                // Parent run
  task_id: string;               // Which task template
  workflow_id: string;           // For easier queries
  status: TaskRunStatus;         // Current state (THE STATE MACHINE)
  attempt: number;               // Retry counter
  input: Record<string, any> | null; // Resolved input data
  output: string | null;         // Raw model output
  error: string | null;          // Error message if failed
  started_at: Date | null;       // When worker claimed it
  finished_at: Date | null;      // When terminal state reached
  heartbeat_at: Date | null;     // Last worker health signal
  created_at: Date;
}

export interface Artifact {
  id: string;                    // Artifact identifier
  task_run_id: string;           // Which execution produced this
  content: string;               // Actual output data
  content_type: string;          // MIME type or format hint
  created_at: Date;
}

// =============================================================================
// WORKFLOW DEFINITION TYPES (stored in workflows.definition)
// =============================================================================

export interface WorkflowDefinition {
  name: string;
  tasks: TaskDefinition[];
  config?: GlobalConfig;
}

export interface TaskDefinition {
  id: string;                    // Must be unique within workflow
  name: string;
  prompt: string;                // Template with {{ variables }}
  model: string;                 // e.g., "gpt-4", "claude-3-opus"
  provider: 'openai' | 'anthropic';
  depends_on?: string[];         // Task IDs this depends on
  requires_approval?: boolean;
  config?: TaskConfig;
}

export interface TaskConfig {
  temperature?: number;          // 0.0 - 2.0
  max_tokens?: number;
  json_output?: boolean | JsonSchema;
  retry_policy?: RetryConfig;
}

export interface GlobalConfig {
  max_parallel?: number;
  timeout_ms?: number;
}

export interface RetryConfig {
  max_attempts: number;
  backoff_ms: number;
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
  [key: string]: any;
}

// =============================================================================
// HELPER TYPES
// =============================================================================

// For queries that join tables
export interface WorkflowWithDetails extends Workflow {
  tasks: Task[];
  dependencies: Dependency[];
  task_count: number;
  dependency_count: number;
}

export interface RunWithTaskRuns extends Run {
  task_runs: TaskRun[];
}

export interface TaskRunWithArtifacts extends TaskRun {
  artifacts: Artifact[];
}
