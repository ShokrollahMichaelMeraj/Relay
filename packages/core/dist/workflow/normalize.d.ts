/**
 * Workflow normalization
 * Transforms user-friendly YAML into canonical form
 */
import { WorkflowDefinition } from '@relay/types';
/**
 * Normalize a workflow definition
 * - Converts shorthand syntax to full form
 * - Fills in defaults
 * - Ensures all fields are present
 */
export declare function normalizeWorkflow(raw: any): WorkflowDefinition;
/**
 * Validate that all task IDs are unique
 */
export declare function validateUniqueTaskIds(workflow: WorkflowDefinition): void;
/**
 * Validate that all depends_on references exist
 */
export declare function validateTaskReferences(workflow: WorkflowDefinition): void;
//# sourceMappingURL=normalize.d.ts.map