/**
 * Database types - mirror the PostgreSQL schema exactly
 * These types represent rows in our database tables
 */
export type RunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
export type TaskRunStatus = 'PENDING' | 'READY' | 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'BLOCKED' | 'CANCELLED';
export interface Workflow {
    id: string;
    name: string;
    definition: WorkflowDefinition;
    created_at: Date;
    updated_at: Date;
}
export interface Run {
    id: string;
    workflow_id: string;
    status: RunStatus;
    input: Record<string, any> | null;
    started_at: Date;
    finished_at: Date | null;
}
export interface Task {
    id: string;
    workflow_id: string;
    name: string;
    config: TaskConfig;
    requires_approval: boolean;
}
export interface Dependency {
    id: number;
    workflow_id: string;
    task_id: string;
    depends_on_task_id: string;
}
export interface TaskRun {
    id: string;
    run_id: string;
    task_id: string;
    workflow_id: string;
    status: TaskRunStatus;
    attempt: number;
    input: Record<string, any> | null;
    output: string | null;
    error: string | null;
    started_at: Date | null;
    finished_at: Date | null;
    heartbeat_at: Date | null;
    created_at: Date;
}
export interface Artifact {
    id: string;
    task_run_id: string;
    content: string;
    content_type: string;
    created_at: Date;
}
export interface WorkflowDefinition {
    name: string;
    tasks: TaskDefinition[];
    config?: GlobalConfig;
}
export interface TaskDefinition {
    id: string;
    name: string;
    prompt: string;
    model: string;
    provider: 'openai' | 'anthropic';
    depends_on?: string[];
    requires_approval?: boolean;
    config?: TaskConfig;
}
export interface TaskConfig {
    temperature?: number;
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
//# sourceMappingURL=db.d.ts.map