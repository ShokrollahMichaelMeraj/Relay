/**
 * DAG (Directed Acyclic Graph) construction
 * Converts workflow definition into graph data structure
 */
import { WorkflowDefinition, TaskDefinition } from '@relay/types';
/**
 * DAG representation
 */
export interface DAG {
    nodes: Map<string, TaskNode>;
    edges: Map<string, string[]>;
    dependencies: Map<string, string[]>;
    roots: string[];
}
export interface TaskNode {
    id: string;
    name: string;
    task: TaskDefinition;
}
/**
 * Build DAG from workflow definition
 */
export declare function buildDAG(workflow: WorkflowDefinition): DAG;
/**
 * Get all downstream tasks (tasks that depend on this task)
 */
export declare function getDownstream(dag: DAG, taskId: string): string[];
/**
 * Get all upstream tasks (tasks this task depends on)
 */
export declare function getUpstream(dag: DAG, taskId: string): string[];
/**
 * Check if task has any dependencies
 */
export declare function isRoot(dag: DAG, taskId: string): boolean;
/**
 * Get all task IDs in the DAG
 */
export declare function getAllTaskIds(dag: DAG): string[];
//# sourceMappingURL=build.d.ts.map