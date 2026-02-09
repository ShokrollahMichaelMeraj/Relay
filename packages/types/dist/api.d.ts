/**
 * API types - HTTP request/response shapes
 */
import { Workflow, WorkflowDefinition, WorkflowWithDetails, RunWithTaskRuns, TaskRunWithArtifacts } from './db';
export interface CreateWorkflowRequest {
    id: string;
    name: string;
    definition: WorkflowDefinition;
}
export interface CreateRunRequest {
    workflow_id: string;
    input?: Record<string, any>;
}
export interface ApproveTaskRequest {
    task_run_id: string;
}
export interface WorkflowResponse extends Workflow {
    task_count: number;
    dependency_count: number;
}
export interface WorkflowDetailsResponse extends WorkflowWithDetails {
}
export interface ListWorkflowsResponse {
    workflows: WorkflowResponse[];
}
export interface RunResponse extends RunWithTaskRuns {
}
export interface TaskRunResponse extends TaskRunWithArtifacts {
}
export interface TaskRunLogsResponse {
    task_run_id: string;
    logs: LogEntry[];
}
export interface LogEntry {
    timestamp: Date;
    level: 'info' | 'warn' | 'error';
    message: string;
    metadata?: Record<string, any>;
}
export interface ErrorResponse {
    error: string;
    message: string;
    details?: any;
}
export interface ValidationErrorResponse extends ErrorResponse {
    errors: string[];
}
//# sourceMappingURL=api.d.ts.map