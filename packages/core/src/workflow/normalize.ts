/**
 * Workflow normalization
 * Transforms user-friendly YAML into canonical form
 */

import { WorkflowDefinition, TaskDefinition } from '@relay/types';

/**
 * Normalize a workflow definition
 * - Converts shorthand syntax to full form
 * - Fills in defaults
 * - Ensures all fields are present
 */
export function normalizeWorkflow(raw: any): WorkflowDefinition {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Workflow must be an object');
  }

  if (!raw.name || typeof raw.name !== 'string') {
    throw new Error('Workflow must have a name');
  }

  if (!Array.isArray(raw.tasks) || raw.tasks.length === 0) {
    throw new Error('Workflow must have at least one task');
  }

  return {
    name: raw.name,
    tasks: raw.tasks.map(normalizeTask),
    config: raw.config || {},
  };
}

/**
 * Normalize a task definition
 */
function normalizeTask(raw: any, index: number): TaskDefinition {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Task at index ${index} must be an object`);
  }

  // Required fields
  if (!raw.id || typeof raw.id !== 'string') {
    throw new Error(`Task at index ${index} must have an id`);
  }

  if (!raw.name || typeof raw.name !== 'string') {
    throw new Error(`Task ${raw.id} must have a name`);
  }

  if (!raw.prompt || typeof raw.prompt !== 'string') {
    throw new Error(`Task ${raw.id} must have a prompt`);
  }

  if (!raw.model || typeof raw.model !== 'string') {
    throw new Error(`Task ${raw.id} must have a model`);
  }

  if (!raw.provider || !['openai', 'anthropic'].includes(raw.provider)) {
    throw new Error(`Task ${raw.id} must have provider: openai or anthropic`);
  }

  // Normalize depends_on
  let depends_on: string[] = [];
  if (raw.depends_on) {
    if (typeof raw.depends_on === 'string') {
      // Single string → array
      depends_on = [raw.depends_on];
    } else if (Array.isArray(raw.depends_on)) {
      depends_on = raw.depends_on;
    } else {
      throw new Error(`Task ${raw.id}: depends_on must be string or array`);
    }
  }

  return {
    id: raw.id,
    name: raw.name,
    prompt: raw.prompt,
    model: raw.model,
    provider: raw.provider,
    depends_on: depends_on.length > 0 ? depends_on : undefined,
    requires_approval: raw.requires_approval || false,
    config: raw.config || {},
  };
}

/**
 * Validate that all task IDs are unique
 */
export function validateUniqueTaskIds(workflow: WorkflowDefinition): void {
  const ids = new Set<string>();
  const duplicates: string[] = [];

  for (const task of workflow.tasks) {
    if (ids.has(task.id)) {
      duplicates.push(task.id);
    }
    ids.add(task.id);
  }

  if (duplicates.length > 0) {
    throw new Error(`Duplicate task IDs: ${duplicates.join(', ')}`);
  }
}

/**
 * Validate that all depends_on references exist
 */
export function validateTaskReferences(workflow: WorkflowDefinition): void {
  const taskIds = new Set(workflow.tasks.map((t) => t.id));
  const errors: string[] = [];

  for (const task of workflow.tasks) {
    if (task.depends_on) {
      for (const depId of task.depends_on) {
        if (!taskIds.has(depId)) {
          errors.push(`Task ${task.id} depends on non-existent task: ${depId}`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
}
