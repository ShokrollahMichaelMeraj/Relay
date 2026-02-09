/**
 * DAG (Directed Acyclic Graph) construction
 * Converts workflow definition into graph data structure
 */

import { WorkflowDefinition, TaskDefinition } from '@relay/types';

/**
 * DAG representation
 */
export interface DAG {
  // All nodes (tasks)
  nodes: Map<string, TaskNode>;
  
  // Adjacency list: task_id -> array of dependent task_ids
  // (edges point FROM upstream TO downstream)
  edges: Map<string, string[]>;
  
  // Reverse adjacency list: task_id -> array of dependency task_ids
  // (edges point FROM downstream TO upstream)
  dependencies: Map<string, string[]>;
  
  // Tasks with no dependencies (entry points)
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
export function buildDAG(workflow: WorkflowDefinition): DAG {
  const nodes = new Map<string, TaskNode>();
  const edges = new Map<string, string[]>();
  const dependencies = new Map<string, string[]>();

  // Step 1: Create nodes
  for (const task of workflow.tasks) {
    nodes.set(task.id, {
      id: task.id,
      name: task.name,
      task,
    });
    
    // Initialize empty edge lists
    edges.set(task.id, []);
    dependencies.set(task.id, []);
  }

  // Step 2: Build edges
  for (const task of workflow.tasks) {
    if (task.depends_on) {
      for (const depId of task.depends_on) {
        // Add edge: depId → task.id
        edges.get(depId)!.push(task.id);
        
        // Add reverse edge: task.id ← depId
        dependencies.get(task.id)!.push(depId);
      }
    }
  }

  // Step 3: Find roots (tasks with no dependencies)
  const roots: string[] = [];
  for (const [taskId, deps] of dependencies) {
    if (deps.length === 0) {
      roots.push(taskId);
    }
  }

  return { nodes, edges, dependencies, roots };
}

/**
 * Get all downstream tasks (tasks that depend on this task)
 */
export function getDownstream(dag: DAG, taskId: string): string[] {
  return dag.edges.get(taskId) || [];
}

/**
 * Get all upstream tasks (tasks this task depends on)
 */
export function getUpstream(dag: DAG, taskId: string): string[] {
  return dag.dependencies.get(taskId) || [];
}

/**
 * Check if task has any dependencies
 */
export function isRoot(dag: DAG, taskId: string): boolean {
  const deps = dag.dependencies.get(taskId);
  return !deps || deps.length === 0;
}

/**
 * Get all task IDs in the DAG
 */
export function getAllTaskIds(dag: DAG): string[] {
  return Array.from(dag.nodes.keys());
}
