/**
 * DAG validation
 * Ensures workflow forms valid DAG (no cycles, valid references)
 */
import { WorkflowDefinition } from '@relay/types';
export interface ValidationError {
    code: string;
    message: string;
    task_id?: string;
}
/**
 * Validate that DAG has no cycles using DFS
 */
export declare function validateDAG(workflow: WorkflowDefinition): ValidationError[];
/**
 * Quick validation check - returns true if valid
 */
export declare function isValidDAG(workflow: WorkflowDefinition): boolean;
//# sourceMappingURL=validate.d.ts.map