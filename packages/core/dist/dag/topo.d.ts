/**
 * Topological sort
 * Compute execution order for tasks
 */
import { DAG } from './build';
/**
 * Topological sort using Kahn's algorithm
 * Returns array of task IDs in execution order
 * Throws error if cycle detected
 */
export declare function topoSort(dag: DAG): string[];
/**
 * Compute execution phases (levels) for parallel execution
 * Returns array of arrays, where each inner array contains tasks
 * that can run in parallel
 */
export declare function computeExecutionPhases(dag: DAG): string[][];
/**
 * Get the depth of each task (longest path from root)
 */
export declare function computeTaskDepths(dag: DAG): Map<string, number>;
//# sourceMappingURL=topo.d.ts.map