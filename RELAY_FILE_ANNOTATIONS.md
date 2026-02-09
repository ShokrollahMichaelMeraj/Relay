# Relay - File-by-File Annotations

## Infrastructure Layer

### infra/postgres/init.sql
**Purpose**: Database initialization script (empty file in uploads)
- Sets up initial PostgreSQL configuration
- Runs on container startup before migrations
- Currently empty - migrations handle all schema

**Relations**: 
- Executed before `infra/migrations/001_init.sql`
- Referenced by `infra/docker-compose.yml` volume mount

---

### infra/migrations/001_init.sql
**Purpose**: Core schema definition - the single source of truth for all data structures

**Tables Created**:

#### 1. `workflows`
**Purpose**: Store workflow definitions (from YAML files)
**Columns**:
- `id` (text, PK): Workflow identifier (e.g., "demo_prd")
- `name` (text): Human-readable name
- `definition` (jsonb): Full normalized workflow structure including tasks, dependencies, config
- `created_at` (timestamptz): When workflow was registered
- `updated_at` (timestamptz): Last modification time

**Inputs**: CLI uploads via `POST /workflows` (apps/api/src/routes/workflows.ts)
**Outputs**: Read by scheduler, CLI status commands, web UI
**Constraints**: 
- Unique workflow ID
- Valid JSONB structure
**Handoffs**: 
- Used by `apps/api/src/services/workflowService.ts` to create runs
- DAG built from definition in `packages/core/src/dag/build.ts`

---

#### 2. `runs`
**Purpose**: Track execution instances of workflows
**Columns**:
- `id` (text, PK): Run identifier (generated, e.g., "run_xyz123")
- `workflow_id` (text, FK → workflows): Which workflow is running
- `status` (text): RUNNING | SUCCESS | FAILED | CANCELLED
- `input` (jsonb): Runtime parameters passed to workflow
- `started_at` (timestamptz): Execution start time
- `finished_at` (timestamptz): Completion time (null if running)

**Inputs**: Created by `POST /runs` endpoint or CLI `run` command
**Outputs**: Polled by CLI `status`, displayed in web UI
**Constraints**:
- Status must be one of 4 valid states
- finished_at only set when terminal state reached
**State Transitions**:
- RUNNING → SUCCESS (all tasks succeed)
- RUNNING → FAILED (any task fails)
- RUNNING → CANCELLED (user cancels)
**Handoffs**:
- Creates N `task_runs` rows (one per task in workflow)
- Scheduler queries for `status = 'RUNNING'` to find active runs

---

#### 3. `tasks`
**Purpose**: Static task definitions extracted from workflows
**Columns**:
- `id` (text, PK): Task identifier (e.g., "research", "draft")
- `workflow_id` (text, FK → workflows): Parent workflow
- `name` (text): Human name
- `config` (jsonb): Task configuration (prompt template, model, params)
- `requires_approval` (boolean): Human-in-the-loop gate flag

**Inputs**: Extracted from workflow.definition when workflow is created
**Outputs**: Templates for creating task_runs
**Constraints**:
- Must reference valid workflow
- Config must include prompt, model, provider
**Handoffs**:
- Read by `packages/core/src/dag/build.ts` to construct DAG
- Cloned into `task_runs` for each run execution

---

#### 4. `dependencies`
**Purpose**: Define DAG edges (which tasks depend on which)
**Columns**:
- `id` (serial, PK): Auto-increment edge ID
- `workflow_id` (text, FK → workflows): Parent workflow
- `task_id` (text, FK → tasks): Downstream task (the one that waits)
- `depends_on_task_id` (text, FK → tasks): Upstream task (the one that must complete first)

**Inputs**: Extracted from workflow.definition.tasks[].depends_on arrays
**Outputs**: Used to build adjacency lists for DAG traversal
**Constraints**:
- Must form acyclic graph (validated by `packages/core/src/dag/validate.ts`)
- Both task IDs must exist in same workflow
**Handoffs**:
- Read by `packages/core/src/dag/topo.ts` for topological sort
- Used by `packages/core/src/engine/unlock.ts` to determine when tasks become READY

---

#### 5. `task_runs`
**Purpose**: Execution instances of individual tasks (the state machine core)
**Columns**:
- `id` (text, PK): Task run identifier (e.g., "tr_abc123")
- `run_id` (text, FK → runs): Parent run
- `task_id` (text, FK → tasks): Which task template
- `workflow_id` (text, FK → workflows): For easier queries
- `status` (text): PENDING | READY | QUEUED | RUNNING | SUCCESS | FAILED | BLOCKED | CANCELLED
- `attempt` (int, default 0): Retry counter
- `input` (jsonb): Resolved input data (after template rendering)
- `output` (text): Raw model output (nullable)
- `error` (text): Error message if failed (nullable)
- `started_at` (timestamptz): When worker claimed it
- `finished_at` (timestamptz): When terminal state reached
- `heartbeat_at` (timestamptz): Last worker health signal
- `created_at` (timestamptz): Row creation time

**Inputs**: 
- Created by `apps/api/src/services/runService.ts` when run starts
- Updated by `apps/worker/src/queue/consumer.ts` during execution
**Outputs**:
- Polled by scheduler to find READY tasks
- Read by CLI for status/logs
- Displayed in web UI graph
**Constraints**:
- Status must progress through valid state machine
- Attempt counter for retry policy
- Heartbeat required while RUNNING
**State Transitions** (critical!):
```
PENDING → READY     (all dependencies satisfied)
READY → QUEUED      (scheduler pushed to queue)
QUEUED → RUNNING    (worker claimed atomically)
RUNNING → SUCCESS   (output stored)
RUNNING → FAILED    (error after retries exhausted)
RUNNING → QUEUED    (retry on transient error)
READY → BLOCKED     (human approval required)
BLOCKED → READY     (approval granted)
```
**Handoffs**:
- Scheduler (`apps/api/src/orchestrator/scheduler.ts`) queries for READY tasks
- Worker (`apps/worker/src/queue/consumer.ts`) claims QUEUED tasks
- Reaper (`apps/api/src/orchestrator/reaper.ts`) detects stale heartbeats
- Event consumer (`apps/api/src/queue/eventConsumer.ts`) unlocks downstream tasks on SUCCESS

---

#### 6. `artifacts`
**Purpose**: Store task outputs separately from task_runs (future: object storage)
**Columns**:
- `id` (text, PK): Artifact identifier
- `task_run_id` (text, FK → task_runs): Which execution produced this
- `content` (text): Actual output data (JSON, markdown, code, etc.)
- `content_type` (text): MIME type or format hint
- `created_at` (timestamptz): When stored

**Inputs**: Written by worker after successful model API call
**Outputs**: Referenced in prompt templates via `{{ tasks.X.output }}`
**Constraints**:
- One artifact per successful task_run
- Content should be UTF-8 text in MVP
**Future**: Replace `content` with object storage URL for large outputs
**Handoffs**:
- Worker writes via `apps/worker/src/exec/resolveInputs.ts`
- Fetched by downstream tasks to resolve input templates

---

### Key Invariants (Database Level)

1. **Atomicity**: Task status updates must be atomic with artifact writes
2. **Acyclicity**: Dependencies table enforced by validation, not DB constraint
3. **Referential Integrity**: All FKs enforced via CASCADE on delete
4. **Monotonic States**: Tasks can only move forward in state machine (no RUNNING → PENDING)
5. **Heartbeat Contract**: RUNNING tasks must update heartbeat_at every N seconds

---

### Indexes (Critical for Performance)

**Missing but should add**:
```sql
CREATE INDEX idx_task_runs_status_run ON task_runs(status, run_id);
CREATE INDEX idx_task_runs_heartbeat ON task_runs(heartbeat_at) WHERE status = 'RUNNING';
CREATE INDEX idx_dependencies_lookup ON dependencies(workflow_id, task_id);
```

These would optimize:
- Scheduler queries: "find all READY tasks in RUNNING runs"
- Reaper queries: "find stale RUNNING tasks"
- DAG traversal: "get all dependencies for task X"

---


### infra/docker-compose.yml
**Purpose**: Local development orchestration - spin up all dependencies

**Services Defined**:

#### 1. `postgres`
- Image: postgres:15-alpine
- Purpose: Persistent state store for all workflow/run/task data
- Ports: 5432:5432
- Volumes: 
  - `./postgres/init.sql` → runs on first startup
  - `./migrations` → manual migration scripts
- Environment: POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD

**Inputs**: SQL files from infra/postgres/ and infra/migrations/
**Outputs**: Database connection on localhost:5432
**Handoffs**: 
- Used by apps/api/src/db/index.ts
- Used by apps/worker/src/db/index.ts

#### 2. `redis`
- Image: redis:7-alpine
- Purpose: Job queue for task execution (producer-consumer pattern)
- Ports: 6379:6379
- Config: ./redis/redis.conf mounted
- Persistence: Disabled in dev (appendonly no)

**Inputs**: Job payloads from API scheduler
**Outputs**: Jobs consumed by worker
**Handoffs**:
- Producer: apps/api/src/queue/producer.ts
- Consumer: apps/worker/src/queue/consumer.ts

#### 3. `api` (optional - if in compose)
- Build context: apps/api
- Depends on: postgres, redis
- Environment: DATABASE_URL, REDIS_URL, PORT

#### 4. `worker` (optional)
- Build context: apps/worker
- Depends on: postgres, redis
- Environment: DATABASE_URL, REDIS_URL, provider API keys

**Constraints**:
- Services must start in order: postgres → redis → api/worker
- Health checks should verify DB migrations ran
- API/worker should retry connections on startup

**Relations**:
- Replaces need for installing postgres/redis locally
- Matches production architecture (separate services)
- Enables parallel development (backend team doesn't block frontend)

---

### infra/redis/redis.conf
**Purpose**: Redis configuration for job queue behavior

**Key Settings** (likely):
```
maxmemory-policy noeviction  # Never drop jobs due to memory
appendonly no                # No persistence in dev
save ""                      # Disable RDB snapshots
```

**Constraints**:
- Jobs are ephemeral in dev (ok to lose on restart)
- Production should enable persistence
- Maxmemory should match expected queue depth

**Relations**:
- Mounted into redis container
- Affects apps/api/src/queue/producer.ts retry behavior
- Affects apps/worker/src/queue/consumer.ts visibility timeout

---

## Shared Packages Layer

### packages/types/src/db.ts
**Purpose**: TypeScript types that mirror database schema exactly

**Exports** (expected):
```typescript
// Table row types
type Workflow = { id, name, definition, created_at, updated_at }
type Run = { id, workflow_id, status, input, started_at, finished_at }
type Task = { id, workflow_id, name, config, requires_approval }
type Dependency = { id, workflow_id, task_id, depends_on_task_id }
type TaskRun = { id, run_id, task_id, workflow_id, status, attempt, ... }
type Artifact = { id, task_run_id, content, content_type, created_at }

// Enums
type RunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED'
type TaskRunStatus = 'PENDING' | 'READY' | 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'BLOCKED' | 'CANCELLED'
```

**Inputs**: None (pure types)
**Outputs**: Imported by all apps/packages
**Constraints**:
- Must stay in sync with DB schema
- No runtime behavior
- Single source of truth for type contracts

**Relations**:
- Used by apps/api DB queries
- Used by apps/worker DB updates
- Used by packages/core state machine logic

---

### packages/types/src/api.ts
**Purpose**: API request/response types for HTTP layer

**Exports** (expected):
```typescript
// Request bodies
type CreateWorkflowRequest = { id, name, definition }
type CreateRunRequest = { workflow_id, input? }
type ApproveTaskRequest = { task_run_id }

// Response shapes
type WorkflowResponse = Workflow & { task_count, dependency_count }
type RunResponse = Run & { task_runs: TaskRun[] }
type TaskRunResponse = TaskRun & { artifacts?: Artifact[] }
```

**Inputs**: None (pure types)
**Outputs**: 
- Used by apps/api routes
- Used by apps/cli client
- Used by apps/web client

**Constraints**:
- Should match OpenAPI spec (if exists)
- Versioned if API changes

**Relations**:
- Builds on packages/types/src/db.ts
- Consumed by apps/cli/src/api/client.ts
- Consumed by apps/web/src/api/client.ts

---

### packages/core/src/workflow/types.ts
**Purpose**: In-memory workflow representation (parsed from YAML)

**Exports** (expected):
```typescript
type WorkflowDefinition = {
  name: string
  tasks: TaskDefinition[]
  config?: GlobalConfig
}

type TaskDefinition = {
  id: string
  name: string
  prompt: string
  model: string
  provider: 'openai' | 'anthropic'
  depends_on?: string[]
  requires_approval?: boolean
  config?: TaskConfig
}

type TaskConfig = {
  temperature?: number
  max_tokens?: number
  json_output?: boolean | JsonSchema
  retry_policy?: RetryConfig
}
```

**Inputs**: Raw YAML parsed by apps/cli/src/config/loadWorkflow.ts
**Outputs**: Normalized then stored in workflows.definition (jsonb)
**Constraints**:
- Task IDs must be unique within workflow
- depends_on must reference valid task IDs
- Model/provider must be supported

**Relations**:
- Validated by apps/cli/src/config/schema.ts
- Normalized by packages/core/src/workflow/normalize.ts
- Converted to DB tables by apps/api/src/services/workflowService.ts

---

### packages/core/src/workflow/normalize.ts
**Purpose**: Transform user-friendly YAML into canonical form

**Function**:
```typescript
function normalizeWorkflow(raw: any): WorkflowDefinition
```

**Inputs**: 
- Raw object from YAML parser
- May have shorthand syntax, defaults, references

**Outputs**: 
- Fully expanded WorkflowDefinition
- All defaults filled in
- All references resolved

**Transformations**:
- Convert `depends_on: "task1"` → `depends_on: ["task1"]`
- Fill in default model params
- Expand `extends` if supported
- Validate referenced task IDs exist

**Constraints**:
- Idempotent (normalize(normalize(x)) = normalize(x))
- Must preserve semantic meaning
- No I/O (pure function)

**Relations**:
- Called by apps/cli validate command
- Called before storing in DB
- Output validated by packages/core/src/dag/validate.ts

---

### packages/core/src/dag/build.ts
**Purpose**: Convert workflow definition into DAG data structure

**Function**:
```typescript
type DAG = {
  nodes: Map<TaskId, TaskNode>
  edges: Map<TaskId, TaskId[]>  // adjacency list
  roots: TaskId[]  // tasks with no dependencies
}

function buildDAG(workflow: WorkflowDefinition): DAG
```

**Inputs**: Normalized workflow definition
**Outputs**: In-memory graph structure

**Algorithm**:
1. Create nodes from tasks
2. Build adjacency list from depends_on
3. Find roots (nodes with in-degree = 0)
4. Reverse edges for topological sort

**Constraints**:
- Must detect cycles (see validate.ts)
- Must handle disconnected subgraphs
- Roots must exist (at least one task with no deps)

**Relations**:
- Called by packages/core/src/dag/validate.ts
- Used by packages/core/src/dag/topo.ts for ordering
- Used by apps/api/src/orchestrator/scheduler.ts to find READY tasks

---

### packages/core/src/dag/validate.ts
**Purpose**: Ensure workflow forms valid DAG (no cycles, valid refs)

**Function**:
```typescript
type ValidationError = { code: string, message: string, task_id?: string }
function validateDAG(dag: DAG): ValidationError[]
```

**Checks**:
1. **Acyclicity**: Run DFS, detect back edges
2. **Connectedness**: Warn if disconnected components
3. **Reference validity**: All depends_on IDs exist
4. **Root existence**: At least one task with no deps
5. **Reachability**: All tasks reachable from roots

**Algorithm** (cycle detection):
```
DFS with 3 colors:
- WHITE: unvisited
- GRAY: in current path (visiting)
- BLACK: fully processed
If we visit a GRAY node → cycle detected
```

**Inputs**: DAG from buildDAG
**Outputs**: Array of validation errors (empty = valid)

**Relations**:
- Called by apps/cli validate command
- Called before creating workflow in DB
- Prevents scheduler from getting stuck

---

### packages/core/src/dag/topo.ts
**Purpose**: Compute topological sort order for task execution

**Function**:
```typescript
function topoSort(dag: DAG): TaskId[]
```

**Algorithm** (Kahn's algorithm):
```
1. Start with roots (in-degree = 0)
2. Queue all roots
3. While queue not empty:
   - Dequeue task T
   - Append T to sorted list
   - For each child C of T:
     - Decrement in-degree of C
     - If in-degree becomes 0, enqueue C
4. If sorted.length != nodes.length → cycle exists
```

**Inputs**: DAG from buildDAG
**Outputs**: Array of task IDs in execution order
**Constraints**: 
- Only works on acyclic graphs (validate first!)
- Not unique (multiple valid orders possible)

**Relations**:
- Used by scheduler to determine execution phases
- Used by web UI to render graph left-to-right
- Not strictly required (READY state handles ordering)

---

### packages/core/src/engine/state.ts
**Purpose**: State machine logic for task status transitions

**Function**:
```typescript
function canTransition(from: TaskRunStatus, to: TaskRunStatus): boolean
function nextStatus(current: TaskRunStatus, event: TaskEvent): TaskRunStatus
```

**Valid Transitions**:
```
PENDING → READY      (dependencies satisfied)
READY → QUEUED       (scheduler action)
READY → BLOCKED      (approval required)
QUEUED → RUNNING     (worker claimed)
RUNNING → SUCCESS    (output stored)
RUNNING → FAILED     (error, retries exhausted)
RUNNING → QUEUED     (retry on transient error)
BLOCKED → READY      (approval granted)
* → CANCELLED        (user action)
```

**Events**:
```typescript
type TaskEvent = 
  | { type: 'DEPENDENCIES_MET' }
  | { type: 'SCHEDULED' }
  | { type: 'CLAIMED' }
  | { type: 'COMPLETED', output: string }
  | { type: 'ERRORED', error: string, retriable: boolean }
  | { type: 'APPROVED' }
  | { type: 'CANCELLED' }
```

**Constraints**:
- Transitions are monotonic (no backwards except retry)
- Terminal states: SUCCESS, FAILED, CANCELLED
- No escape from terminal states

**Relations**:
- Used by apps/worker to validate status updates
- Used by apps/api/src/orchestrator/scheduler.ts
- Enforces correctness of state machine

---

### packages/core/src/engine/unlock.ts
**Purpose**: Determine which downstream tasks become READY after a task succeeds

**Function**:
```typescript
type UnlockResult = {
  newly_ready: TaskId[]
  newly_blocked: TaskId[]  // if approval needed
}

function computeUnlocked(
  completed_task_id: TaskId,
  dag: DAG,
  current_task_statuses: Map<TaskId, TaskRunStatus>
): UnlockResult
```

**Algorithm**:
```
1. Find all children of completed task in DAG
2. For each child C:
   - Get all dependencies of C
   - Check if all dependencies are SUCCESS
   - If yes:
     - If C.requires_approval → add to newly_blocked
     - Else → add to newly_ready
```

**Inputs**:
- Task that just completed
- DAG structure
- Current status of all tasks in run

**Outputs**:
- List of task IDs to transition PENDING → READY
- List of task IDs to transition PENDING → BLOCKED

**Constraints**:
- Must be called after task status is durably set to SUCCESS
- Must be atomic with status update (or in transaction)
- Handles approval gates

**Relations**:
- Called by apps/api/src/queue/eventConsumer.ts on task completion
- Updates task_runs table via apps/api/src/services/taskRunService.ts
- Triggers scheduler to pick up newly READY tasks

---


## Worker Application (Execution Plane)

### apps/worker/src/config/env.ts
**Purpose**: Load and validate environment variables for worker

**Exports**:
```typescript
const env = {
  DATABASE_URL: string
  REDIS_URL: string
  OPENAI_API_KEY?: string
  ANTHROPIC_API_KEY?: string
  MAX_RETRIES: number
  HEARTBEAT_INTERVAL_MS: number
  REQUEST_TIMEOUT_MS: number
}
```

**Validation**:
- Throws if required vars missing
- Provides defaults for optional settings
- Validates URL formats

**Relations**:
- Used by apps/worker/src/main.ts on startup
- Used by apps/worker/src/connectors/* for API keys
- Used by apps/worker/src/queue/consumer.ts for timeouts

---

### apps/worker/src/main.ts
**Purpose**: Worker entrypoint - bootstrap and run consumer loop

**Execution Flow**:
```
1. Load env config
2. Connect to DB (src/db/index.ts)
3. Connect to Redis
4. Register signal handlers (SIGTERM, SIGINT)
5. Start consumer loop (src/queue/consumer.ts)
6. On shutdown:
   - Stop accepting new jobs
   - Finish current job
   - Close connections
   - Exit gracefully
```

**Inputs**: Environment variables, CLI args
**Outputs**: Logs to stdout/stderr
**Constraints**:
- Must handle graceful shutdown
- Should retry DB/Redis connections on startup
- Should not exit on transient errors

**Relations**:
- Entry point for worker container/process
- Orchestrates src/queue/consumer.ts
- Uses src/util/logger.ts

---

### apps/worker/src/db/index.ts
**Purpose**: Database connection pool for worker

**Exports**:
```typescript
const db: Pool  // pg.Pool instance
```

**Configuration**:
- Connection string from env.DATABASE_URL
- Pool size: 5-10 connections
- Idle timeout, connection timeout
- Auto-reconnect on disconnect

**Constraints**:
- Must use connection pooling (not new connection per query)
- Should log slow queries (>1s)
- Must close pool on shutdown

**Relations**:
- Used by src/queue/consumer.ts to update task_runs
- Writes to task_runs, artifacts tables
- Never reads workflows or tasks (static data)

---

### apps/worker/src/queue/consumer.ts
**Purpose**: Main job processing loop - the heart of the worker

**Function**:
```typescript
async function consumeLoop(): Promise<never>
```

**Loop**:
```
while (true) {
  1. Blocking pop from Redis queue (BLPOP with timeout)
  2. If job received:
     - Parse job payload { task_run_id, run_id, attempt }
     - Execute task (see below)
  3. If timeout:
     - Continue (heartbeat sent elsewhere)
  4. On error:
     - Log, continue (never crash loop)
}
```

**Task Execution Steps**:
```
A. Claim Task (ATOMIC)
   UPDATE task_runs 
   SET status = 'RUNNING', started_at = NOW(), heartbeat_at = NOW()
   WHERE id = task_run_id AND status = 'QUEUED'
   → If 0 rows updated: job already claimed or cancelled, abort

B. Start Heartbeat
   setInterval(() => UPDATE heartbeat_at = NOW() WHERE id = task_run_id)

C. Resolve Inputs
   - Fetch task config from DB
   - For each {{ tasks.X.output }} reference:
     - Query artifacts table for upstream task_run output
     - Substitute into prompt template
   - Validate all inputs resolved

D. Render Prompt
   - Apply template engine (Mustache/Handlebars)
   - Build final prompt string
   - Wrap in provider-specific envelope

E. Call Provider
   - Route to OpenAI or Anthropic connector
   - Apply retry policy (429, 5xx)
   - Stream or non-stream based on config
   - Respect timeout

F. Extract Output
   - If json_output=true: extract JSON from response
   - Validate against schema if provided
   - Store raw output

G. Store Results
   BEGIN TRANSACTION
     INSERT INTO artifacts (task_run_id, content, content_type)
     UPDATE task_runs SET status='SUCCESS', output=..., finished_at=NOW()
   COMMIT

H. Stop Heartbeat

I. Publish Completion Event
   PUBLISH "task_completed" { task_run_id, run_id, status }
   → Triggers unlock logic in API
```

**Error Handling**:
```
- Connection errors, DNS failures → retry if attempts < MAX
- 429 rate limit → exponential backoff, retry
- 401/403 auth → FAIL immediately (no retry)
- 5xx server error → retry
- Timeout → retry
- Invalid JSON output → retry if attempts < MAX, else FAIL
- Unhandled exception → FAIL, log stack trace
```

**Constraints**:
- Must claim task atomically (prevents double execution)
- Must update heartbeat every N seconds while RUNNING
- Must store artifact before setting status=SUCCESS
- Must publish event after DB commit
- Must stop heartbeat on any terminal state

**Inputs**: Job payload from Redis
**Outputs**: 
- DB updates (task_runs, artifacts)
- Redis events (task completion)
- Logs

**Relations**:
- Uses src/exec/resolveInputs.ts
- Uses src/exec/renderPrompt.ts
- Uses src/exec/promptEnvelope.ts
- Uses src/connectors/index.ts
- Uses src/exec/jsonExtract.ts
- Uses src/exec/retryPolicy.ts

---

### apps/worker/src/exec/resolveInputs.ts
**Purpose**: Fetch upstream task outputs and inject into prompt template

**Function**:
```typescript
async function resolveInputs(
  task_config: TaskConfig,
  run_id: string
): Promise<ResolvedInputs>
```

**Algorithm**:
```
1. Parse prompt template for {{ tasks.X.output }} references
2. Extract task IDs (X)
3. For each referenced task:
   SELECT tr.id, a.content
   FROM task_runs tr
   JOIN artifacts a ON a.task_run_id = tr.id
   WHERE tr.run_id = :run_id AND tr.task_id = :X
4. Build map: { task_id → output_content }
5. Return for template rendering
```

**Inputs**:
- Task config (with prompt template)
- Run ID (to scope artifact lookup)

**Outputs**:
- Map of task_id → output content
- Error if any upstream output missing

**Constraints**:
- Upstream tasks must be SUCCESS (scheduler ensures this)
- If artifact missing → hard error (shouldn't happen)
- Handles circular refs (validated at DAG level)

**Relations**:
- Called by src/queue/consumer.ts step C
- Queries task_runs, artifacts tables
- Output passed to src/exec/renderPrompt.ts

---

### apps/worker/src/exec/renderPrompt.ts
**Purpose**: Template rendering - substitute variables into prompt

**Function**:
```typescript
function renderPrompt(
  template: string,
  inputs: ResolvedInputs,
  runtime_params?: Record<string, any>
): string
```

**Algorithm**:
```
1. Parse template for {{ variable }} syntax
2. Replace {{ tasks.X.output }} with inputs[X]
3. Replace {{ input.Y }} with runtime_params[Y]
4. Return final UTF-8 string
```

**Template Syntax**:
```
{{ tasks.research.output }}         → upstream task output
{{ input.topic }}                    → workflow run input
{{ tasks.research.output.summary }}  → JSON path into output
```

**Constraints**:
- All variables must resolve (no partial renders)
- Output must be valid UTF-8
- No code execution (safe template engine only)

**Inputs**:
- Prompt template string
- Resolved inputs from resolveInputs
- Runtime parameters from run.input

**Outputs**: Final prompt string ready for API

**Relations**:
- Called by src/queue/consumer.ts step D
- Uses inputs from src/exec/resolveInputs.ts
- Output passed to src/exec/promptEnvelope.ts

---

### apps/worker/src/exec/promptEnvelope.ts
**Purpose**: Wrap rendered prompt in provider-specific message format

**Function**:
```typescript
function buildRequestBody(
  provider: 'openai' | 'anthropic',
  prompt: string,
  config: TaskConfig
): ProviderRequest
```

**OpenAI Format**:
```json
{
  "model": "gpt-4",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "<rendered prompt>" }
  ],
  "temperature": 0.7,
  "max_tokens": 2000
}
```

**Anthropic Format**:
```json
{
  "model": "claude-3-opus-20240229",
  "max_tokens": 4096,
  "messages": [
    { "role": "user", "content": "<rendered prompt>" }
  ],
  "temperature": 1.0
}
```

**JSON Output Mode**:
- OpenAI: Add `response_format: { type: "json_object" }`
- Anthropic: Append "Return only valid JSON" to prompt

**Constraints**:
- Must match provider's API spec exactly
- Must include required fields (model, max_tokens)
- Must validate config values (temp ∈ [0,2], etc.)

**Inputs**:
- Provider name
- Rendered prompt string
- Task config (model, temperature, etc.)

**Outputs**: Request body object for HTTP POST

**Relations**:
- Called by src/queue/consumer.ts step D
- Output passed to src/connectors/openai.ts or anthropic.ts

---

### apps/worker/src/connectors/index.ts
**Purpose**: Route task execution to correct provider connector

**Function**:
```typescript
async function executeTask(
  provider: 'openai' | 'anthropic',
  request: ProviderRequest
): Promise<ProviderResponse>
```

**Routing**:
```typescript
switch (provider) {
  case 'openai':
    return executeOpenAI(request)
  case 'anthropic':
    return executeAnthropic(request)
  default:
    throw new Error(`Unknown provider: ${provider}`)
}
```

**Inputs**: Provider name, request body
**Outputs**: Standardized response { text, usage, model }

**Relations**:
- Called by src/queue/consumer.ts step E
- Delegates to src/connectors/openai.ts or anthropic.ts
- Normalizes different provider response formats

---

### apps/worker/src/connectors/openai.ts
**Purpose**: OpenAI API client with retries and streaming

**Function**:
```typescript
async function executeOpenAI(request: OpenAIRequest): Promise<Response>
```

**HTTP Call**:
```
POST https://api.openai.com/v1/chat/completions
Headers:
  Authorization: Bearer <OPENAI_API_KEY>
  Content-Type: application/json
Body: <request>
```

**Response Handling**:
```
- 200 OK → extract completion text
- 429 → throw RetryableError
- 5xx → throw RetryableError
- 401/403 → throw FatalError
- Timeout → throw RetryableError
```

**Streaming** (if enabled):
```
Parse SSE stream:
data: {"choices":[{"delta":{"content":"..."}}]}

Accumulate chunks, return final text
```

**Constraints**:
- Must set timeout (default 60s)
- Must handle partial responses
- Must parse usage metadata

**Inputs**: OpenAI request body
**Outputs**: { text, usage: { prompt_tokens, completion_tokens }, model }

**Relations**:
- Called by src/connectors/index.ts
- Uses env.OPENAI_API_KEY
- Uses src/exec/retryPolicy.ts for error classification

---

### apps/worker/src/connectors/anthropic.ts
**Purpose**: Anthropic API client with retries

**Function**:
```typescript
async function executeAnthropic(request: AnthropicRequest): Promise<Response>
```

**HTTP Call**:
```
POST https://api.anthropic.com/v1/messages
Headers:
  x-api-key: <ANTHROPIC_API_KEY>
  anthropic-version: 2023-06-01
  Content-Type: application/json
Body: <request>
```

**Response Handling**:
```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "..." }],
  "usage": { "input_tokens": 100, "output_tokens": 200 }
}
```

**Constraints**:
- Must specify anthropic-version header
- Must extract text from content array
- Must handle multi-content responses

**Inputs**: Anthropic request body
**Outputs**: { text, usage, model }

**Relations**:
- Called by src/connectors/index.ts
- Uses env.ANTHROPIC_API_KEY
- Normalizes response to match OpenAI format

---

### apps/worker/src/exec/retryPolicy.ts
**Purpose**: Classify errors and determine retry strategy

**Function**:
```typescript
type RetryDecision = { should_retry: boolean, delay_ms: number }

function shouldRetry(
  error: Error,
  attempt: number,
  max_attempts: number
): RetryDecision
```

**Classification**:
```typescript
// Retriable errors
- Network timeout
- Connection refused
- 429 rate limit
- 500/502/503/504 server errors

// Fatal errors (no retry)
- 401/403 authentication
- 400 bad request (our bug)
- Invalid JSON schema (validation error)
```

**Backoff Strategy**:
```
Base delay: 1s
Exponential: delay = base * 2^attempt
Jitter: delay *= (0.5 + random(0, 0.5))
Max delay: 60s

Example:
  Attempt 1: ~1s
  Attempt 2: ~2s
  Attempt 3: ~4s
  Attempt 4: ~8s
```

**Constraints**:
- Max attempts from config (default 3)
- Must add jitter to prevent thundering herd
- Must return 0 delay for fatal errors

**Inputs**:
- Error object (with status code, message)
- Current attempt number
- Max attempts from task config

**Outputs**: Decision object { should_retry, delay_ms }

**Relations**:
- Called by src/queue/consumer.ts on error
- Used by src/connectors/* to classify HTTP errors
- Determines FAILED vs QUEUED transition

---

### apps/worker/src/exec/jsonExtract.ts
**Purpose**: Extract and validate JSON from model output

**Function**:
```typescript
function extractJSON(
  raw_output: string,
  schema?: JSONSchema
): { json: any, is_valid: boolean }
```

**Algorithm**:
```
1. Try parse entire output as JSON
2. If fails, look for JSON in markdown code blocks:
   ```json\n{...}\n```
3. If fails, look for first {...} or [...] balanced braces
4. If found, parse extracted substring
5. If schema provided, validate against it
6. Return { json, is_valid }
```

**Validation**:
```typescript
// If schema provided
import Ajv from 'ajv'
const ajv = new Ajv()
const valid = ajv.validate(schema, parsed_json)
if (!valid) {
  return { json: parsed_json, is_valid: false }
}
```

**Constraints**:
- Must handle models that wrap JSON in explanatory text
- Must validate schema if provided
- Must not throw on invalid JSON (return is_valid=false)

**Inputs**:
- Raw model output string
- Optional JSON schema for validation

**Outputs**: 
- Extracted JSON object (or null)
- Validation flag

**Relations**:
- Called by src/queue/consumer.ts step F
- Uses task.config.json_output schema
- Invalid JSON may trigger retry

---

### apps/worker/src/exec/validateJson.ts
**Purpose**: Strict JSON schema validation

**Function**:
```typescript
function validateJsonOutput(
  json: any,
  schema: JSONSchema
): ValidationResult
```

**Schema Example**:
```json
{
  "type": "object",
  "properties": {
    "summary": { "type": "string" },
    "key_points": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": ["summary", "key_points"]
}
```

**Validation Rules**:
- Type checking (string, number, boolean, array, object)
- Required fields
- Min/max length, min/max value
- Enum constraints
- Nested object validation

**Inputs**:
- Parsed JSON object
- JSON Schema definition

**Outputs**: 
```typescript
type ValidationResult = {
  valid: boolean
  errors?: string[]
}
```

**Relations**:
- Called by src/exec/jsonExtract.ts
- Uses Ajv library for validation
- Validation errors trigger retry or fail

---

### apps/worker/src/util/logger.ts
**Purpose**: Structured logging for worker

**Exports**:
```typescript
const logger = {
  info(msg: string, meta?: object): void
  warn(msg: string, meta?: object): void
  error(msg: string, error: Error, meta?: object): void
}
```

**Format** (JSON):
```json
{
  "timestamp": "2025-02-08T10:00:00.000Z",
  "level": "info",
  "message": "Task completed",
  "task_run_id": "tr_123",
  "run_id": "run_456",
  "duration_ms": 1234
}
```

**Constraints**:
- Always log as JSON (for log aggregation)
- Include context (task_run_id, run_id) in all messages
- Never log sensitive data (API keys, PII)

**Relations**:
- Used throughout worker codebase
- Logs to stdout (captured by Docker/K8s)
- Integrated with observability tools (Datadog, CloudWatch)

---


## API Application (Control Plane)

### apps/api/src/config/env.ts
**Purpose**: Load and validate environment variables for API server

**Exports**:
```typescript
const env = {
  PORT: number
  DATABASE_URL: string
  REDIS_URL: string
  API_KEY?: string  // for auth
  SCHEDULER_INTERVAL_MS: number
  REAPER_INTERVAL_MS: number
  MAX_PARALLEL_TASKS: number
}
```

**Validation**:
- Throws if required vars missing
- Provides sensible defaults
- Validates port range, URLs

**Relations**:
- Used by apps/api/src/main.ts
- Used by apps/api/src/orchestrator/*

---

### apps/api/src/main.ts
**Purpose**: API server entrypoint - HTTP + background jobs

**Execution Flow**:
```
1. Load env config
2. Connect to DB (src/db/index.ts)
3. Connect to Redis
4. Initialize HTTP server (Express)
5. Mount routes:
   - /workflows (src/routes/workflows.ts)
   - /runs (src/routes/runs.ts)
   - /task-runs (src/routes/taskRuns.ts)
6. Start background processes:
   - Scheduler loop (src/orchestrator/scheduler.ts)
   - Reaper loop (src/orchestrator/reaper.ts)
   - Event consumer (src/queue/eventConsumer.ts)
7. Start listening on PORT
8. On shutdown:
   - Stop accepting requests
   - Drain in-flight requests
   - Stop background jobs
   - Close connections
```

**HTTP Middleware**:
- JSON body parser
- Request logging
- Error handling
- Auth (src/middleware/auth.ts)

**Constraints**:
- Must handle graceful shutdown
- Background jobs must not block HTTP
- Must set request timeouts

**Relations**:
- Entry point for API container
- Orchestrates all routes and background processes
- Uses src/util/logger.ts

---

### apps/api/src/db/index.ts
**Purpose**: Database connection pool for API

**Exports**:
```typescript
const db: Pool  // pg.Pool instance
```

**Configuration**:
- Connection string from env.DATABASE_URL
- Pool size: 20 connections (higher than worker)
- Statement timeout: 30s
- Idle timeout: 10min

**Constraints**:
- Must use connection pooling
- Should monitor pool stats (active, idle, waiting)
- Must close pool on shutdown

**Relations**:
- Used by all src/routes/* handlers
- Used by src/services/* layer
- Used by src/orchestrator/* background jobs

---

### apps/api/src/middleware/auth.ts
**Purpose**: API authentication middleware

**Function**:
```typescript
function authMiddleware(req, res, next): void
```

**Authentication**:
```
1. Extract API key from header:
   Authorization: Bearer <API_KEY>
2. Compare against env.API_KEY
3. If match → next()
4. If mismatch/missing → 401 Unauthorized
```

**Constraints**:
- Applied to all routes except health check
- Should rate limit by IP/key
- Should log failed auth attempts

**Relations**:
- Used by apps/api/src/main.ts
- Protects all routes
- Could integrate with JWT/OAuth in future

---

### apps/api/src/routes/workflows.ts
**Purpose**: HTTP endpoints for workflow CRUD

**Endpoints**:

#### POST /workflows
**Purpose**: Register new workflow from YAML definition
**Request**:
```json
{
  "id": "demo_prd",
  "name": "PRD Generator",
  "definition": { /* normalized workflow */ }
}
```
**Process**:
1. Validate request body
2. Validate DAG (packages/core/src/dag/validate.ts)
3. Insert into workflows table
4. Extract tasks → insert into tasks table
5. Extract dependencies → insert into dependencies table
6. Return workflow response

**Response**: 201 Created
```json
{
  "id": "demo_prd",
  "name": "PRD Generator",
  "task_count": 5,
  "dependency_count": 4,
  "created_at": "..."
}
```

#### GET /workflows/:id
**Purpose**: Fetch workflow details
**Response**: 200 OK
```json
{
  "id": "demo_prd",
  "definition": { /* full workflow */ },
  "tasks": [ /* array of tasks */ ],
  "dependencies": [ /* array of edges */ ]
}
```

#### GET /workflows
**Purpose**: List all workflows
**Response**: 200 OK
```json
{
  "workflows": [
    { "id": "demo_prd", "name": "...", "task_count": 5 },
    { "id": "demo_content", "name": "...", "task_count": 3 }
  ]
}
```

**Relations**:
- Uses src/services/workflowService.ts
- Called by CLI `init` command
- Validates via packages/core/src/dag/validate.ts

---

### apps/api/src/routes/runs.ts
**Purpose**: HTTP endpoints for run lifecycle

**Endpoints**:

#### POST /runs
**Purpose**: Start new workflow execution
**Request**:
```json
{
  "workflow_id": "demo_prd",
  "input": {
    "topic": "AI coding assistant",
    "target_audience": "developers"
  }
}
```
**Process**:
1. Validate workflow exists
2. Generate run_id
3. Insert into runs table (status=RUNNING)
4. For each task in workflow:
   - Insert into task_runs (status=PENDING)
5. Compute initial READY tasks (those with no deps)
6. Mark those as READY
7. Trigger scheduler (or wait for next tick)
8. Return run response

**Response**: 201 Created
```json
{
  "id": "run_abc123",
  "workflow_id": "demo_prd",
  "status": "RUNNING",
  "started_at": "...",
  "task_runs": [
    { "id": "tr_1", "task_id": "research", "status": "READY" },
    { "id": "tr_2", "task_id": "draft", "status": "PENDING" }
  ]
}
```

#### GET /runs/:id
**Purpose**: Fetch run status and task progress
**Response**: 200 OK
```json
{
  "id": "run_abc123",
  "workflow_id": "demo_prd",
  "status": "RUNNING",
  "started_at": "...",
  "finished_at": null,
  "task_runs": [
    {
      "id": "tr_1",
      "task_id": "research",
      "status": "SUCCESS",
      "output": "...",
      "started_at": "...",
      "finished_at": "..."
    },
    {
      "id": "tr_2",
      "task_id": "draft",
      "status": "RUNNING",
      "started_at": "...",
      "finished_at": null
    }
  ]
}
```

#### DELETE /runs/:id
**Purpose**: Cancel running workflow
**Process**:
1. Set run.status = CANCELLED
2. Set all PENDING/READY/QUEUED task_runs to CANCELLED
3. RUNNING tasks will finish, but downstream won't start

**Response**: 200 OK

**Relations**:
- Uses src/services/runService.ts
- Called by CLI `run` and `status` commands
- Triggers src/orchestrator/scheduler.ts

---

### apps/api/src/routes/taskRuns.ts
**Purpose**: HTTP endpoints for individual task operations

**Endpoints**:

#### GET /task-runs/:id
**Purpose**: Fetch single task run details
**Response**: 200 OK
```json
{
  "id": "tr_123",
  "task_id": "research",
  "run_id": "run_abc",
  "status": "SUCCESS",
  "attempt": 1,
  "output": "...",
  "artifacts": [
    {
      "id": "art_xyz",
      "content": "...",
      "content_type": "application/json"
    }
  ],
  "started_at": "...",
  "finished_at": "..."
}
```

#### POST /task-runs/:id/approve
**Purpose**: Approve blocked task (human-in-the-loop)
**Request**: `{}`
**Process**:
1. Verify task_run.status = BLOCKED
2. Update status to READY
3. Trigger scheduler to pick it up
4. Return updated task_run

**Response**: 200 OK

#### GET /task-runs/:id/logs
**Purpose**: Fetch execution logs for task
**Response**: 200 OK
```json
{
  "task_run_id": "tr_123",
  "logs": [
    { "timestamp": "...", "level": "info", "message": "Task started" },
    { "timestamp": "...", "level": "info", "message": "Calling OpenAI API" },
    { "timestamp": "...", "level": "info", "message": "Task completed" }
  ]
}
```

**Relations**:
- Uses src/services/taskRunService.ts
- Called by CLI `approve` and `logs` commands
- Approval triggers src/orchestrator/scheduler.ts

---

### apps/api/src/services/workflowService.ts
**Purpose**: Business logic for workflow operations

**Functions**:

#### createWorkflow
```typescript
async function createWorkflow(
  id: string,
  name: string,
  definition: WorkflowDefinition
): Promise<Workflow>
```
**Process**:
```sql
BEGIN TRANSACTION;
  INSERT INTO workflows (id, name, definition) VALUES (...);
  
  FOR EACH task IN definition.tasks:
    INSERT INTO tasks (id, workflow_id, name, config) VALUES (...);
  
  FOR EACH task IN definition.tasks:
    FOR EACH dep IN task.depends_on:
      INSERT INTO dependencies (workflow_id, task_id, depends_on_task_id) 
      VALUES (workflow_id, task.id, dep);
COMMIT;
```

**Constraints**:
- Must be atomic (transaction)
- Must validate DAG before inserting
- Must normalize definition before storing

**Relations**:
- Called by src/routes/workflows.ts
- Uses packages/core/src/dag/validate.ts
- Uses packages/core/src/workflow/normalize.ts

#### getWorkflow
```typescript
async function getWorkflow(id: string): Promise<WorkflowWithDetails>
```
**Process**:
```sql
SELECT w.*, 
       json_agg(t.*) as tasks,
       json_agg(d.*) as dependencies
FROM workflows w
LEFT JOIN tasks t ON t.workflow_id = w.id
LEFT JOIN dependencies d ON d.workflow_id = w.id
WHERE w.id = :id
GROUP BY w.id
```

---

### apps/api/src/services/runService.ts
**Purpose**: Business logic for run operations

**Functions**:

#### createRun
```typescript
async function createRun(
  workflow_id: string,
  input?: Record<string, any>
): Promise<RunWithTaskRuns>
```
**Process**:
```sql
BEGIN TRANSACTION;
  -- Create run
  INSERT INTO runs (id, workflow_id, status, input, started_at)
  VALUES (generate_id(), :workflow_id, 'RUNNING', :input, NOW());
  
  -- Get all tasks for workflow
  SELECT * FROM tasks WHERE workflow_id = :workflow_id;
  
  -- Create task_run for each task
  FOR EACH task:
    INSERT INTO task_runs (
      id, run_id, task_id, workflow_id, status, created_at
    ) VALUES (
      generate_id(), :run_id, task.id, :workflow_id, 'PENDING', NOW()
    );
  
  -- Find tasks with no dependencies
  SELECT tr.id
  FROM task_runs tr
  WHERE tr.run_id = :run_id
    AND NOT EXISTS (
      SELECT 1 FROM dependencies d 
      WHERE d.task_id = tr.task_id
    );
  
  -- Mark root tasks as READY
  UPDATE task_runs
  SET status = 'READY'
  WHERE id IN (:root_task_run_ids);
COMMIT;
```

**Constraints**:
- Must be atomic
- Must create all task_runs upfront
- Must compute initial READY set

**Relations**:
- Called by src/routes/runs.ts
- Triggers src/orchestrator/scheduler.ts (async)
- Uses packages/core/src/dag/build.ts

#### getRun
```typescript
async function getRun(id: string): Promise<RunWithTaskRuns>
```
**Process**:
```sql
SELECT r.*,
       json_agg(tr.* ORDER BY tr.created_at) as task_runs
FROM runs r
LEFT JOIN task_runs tr ON tr.run_id = r.id
WHERE r.id = :id
GROUP BY r.id
```

#### cancelRun
```typescript
async function cancelRun(id: string): Promise<void>
```
**Process**:
```sql
BEGIN TRANSACTION;
  UPDATE runs SET status = 'CANCELLED' WHERE id = :id;
  
  UPDATE task_runs
  SET status = 'CANCELLED'
  WHERE run_id = :id
    AND status IN ('PENDING', 'READY', 'QUEUED');
COMMIT;
```

---

### apps/api/src/services/taskRunService.ts
**Purpose**: Business logic for task run operations

**Functions**:

#### getTaskRun
```typescript
async function getTaskRun(id: string): Promise<TaskRunWithArtifacts>
```
**Process**:
```sql
SELECT tr.*,
       a.* as artifact
FROM task_runs tr
LEFT JOIN artifacts a ON a.task_run_id = tr.id
WHERE tr.id = :id
```

#### approveTaskRun
```typescript
async function approveTaskRun(id: string): Promise<TaskRun>
```
**Process**:
```sql
UPDATE task_runs
SET status = 'READY'
WHERE id = :id
  AND status = 'BLOCKED'
RETURNING *
```

**Constraints**:
- Can only approve if status=BLOCKED
- Must trigger scheduler after approval

**Relations**:
- Called by src/routes/taskRuns.ts
- Triggers src/orchestrator/scheduler.ts

---

### apps/api/src/orchestrator/scheduler.ts
**Purpose**: Background job that queues READY tasks

**Function**:
```typescript
async function schedulerLoop(): Promise<never>
```

**Loop**:
```
while (true) {
  1. Query for READY tasks in RUNNING runs
  2. Limit to MAX_PARALLEL_TASKS (if needed)
  3. For each task:
     - Atomically update status READY → QUEUED
     - Push job to Redis queue
  4. Sleep for SCHEDULER_INTERVAL_MS
  5. Repeat
}
```

**SQL Query** (src/orchestrator/sql.ts):
```sql
SELECT tr.id, tr.run_id, tr.task_id, tr.attempt
FROM task_runs tr
JOIN runs r ON r.id = tr.run_id
WHERE tr.status = 'READY'
  AND r.status = 'RUNNING'
ORDER BY tr.created_at ASC
LIMIT :max_parallel
```

**Atomic Claim**:
```sql
UPDATE task_runs
SET status = 'QUEUED'
WHERE id = :task_run_id
  AND status = 'READY'
RETURNING *
```

**Redis Push**:
```typescript
await redis.lpush('task_queue', JSON.stringify({
  task_run_id: tr.id,
  run_id: tr.run_id,
  attempt: tr.attempt
}))
```

**Constraints**:
- Must be atomic (update then push, or neither)
- Must respect max parallel limit
- Must handle Redis connection errors
- Should use exponential backoff on errors

**Relations**:
- Queries task_runs table
- Pushes to Redis queue
- Worker consumes from same queue

---

### apps/api/src/orchestrator/reaper.ts
**Purpose**: Background job that recovers stuck tasks

**Function**:
```typescript
async function reaperLoop(): Promise<never>
```

**Loop**:
```
while (true) {
  1. Query for RUNNING tasks with stale heartbeat
  2. For each stuck task:
     - If attempt < max_retries:
       - Update status RUNNING → QUEUED (retry)
     - Else:
       - Update status RUNNING → FAILED
       - Store error: "Worker died, max retries exceeded"
  3. Sleep for REAPER_INTERVAL_MS
  4. Repeat
}
```

**SQL Query** (src/orchestrator/sql.ts):
```sql
SELECT tr.id, tr.attempt, t.config
FROM task_runs tr
JOIN tasks t ON t.id = tr.task_id
WHERE tr.status = 'RUNNING'
  AND tr.heartbeat_at < NOW() - INTERVAL '2 minutes'
```

**Recovery Logic**:
```sql
-- Retry if attempts remaining
UPDATE task_runs
SET status = 'QUEUED',
    attempt = attempt + 1,
    heartbeat_at = NULL
WHERE id = :task_run_id
  AND attempt < :max_retries

-- Fail if exhausted
UPDATE task_runs
SET status = 'FAILED',
    error = 'Worker died, max retries exceeded',
    finished_at = NOW()
WHERE id = :task_run_id
  AND attempt >= :max_retries
```

**Constraints**:
- Heartbeat threshold should be 2-3x worker interval
- Must respect retry limits
- Should log recovery actions
- Must handle failed tasks (unlock or fail run)

**Relations**:
- Monitors task_runs.heartbeat_at
- Updates task_runs.status
- Depends on worker updating heartbeat

---

### apps/api/src/orchestrator/dag.ts
**Purpose**: DAG operations for scheduler (in-memory cache)

**Exports**:
```typescript
class DAGCache {
  async getDAG(workflow_id: string): Promise<DAG>
  invalidate(workflow_id: string): void
}
```

**Implementation**:
```typescript
const cache = new Map<string, DAG>()

async getDAG(workflow_id: string): Promise<DAG> {
  if (cache.has(workflow_id)) {
    return cache.get(workflow_id)
  }
  
  // Load from DB
  const workflow = await db.query(
    'SELECT definition FROM workflows WHERE id = $1',
    [workflow_id]
  )
  
  // Build DAG
  const dag = buildDAG(workflow.definition)
  cache.set(workflow_id, dag)
  return dag
}
```

**Constraints**:
- Cache must be invalidated on workflow update
- Should have TTL or max size
- Must be safe for concurrent access

**Relations**:
- Used by src/orchestrator/scheduler.ts
- Uses packages/core/src/dag/build.ts
- Optimizes repeated DAG queries

---

### apps/api/src/orchestrator/sql.ts
**Purpose**: Centralize complex SQL queries used by scheduler/reaper

**Exports**:
```typescript
const SQL = {
  findReadyTasks: string
  findStaleRunningTasks: string
  findTaskDependencies: string
  updateRunStatus: string
}
```

**Example**:
```typescript
const findReadyTasks = `
  SELECT tr.id, tr.run_id, tr.task_id, tr.attempt,
         t.config
  FROM task_runs tr
  JOIN tasks t ON t.id = tr.task_id
  JOIN runs r ON r.id = tr.run_id
  WHERE tr.status = 'READY'
    AND r.status = 'RUNNING'
  ORDER BY tr.created_at ASC
  LIMIT $1
`
```

**Constraints**:
- All queries should be parameterized (prevent SQL injection)
- All queries should have EXPLAIN plans analyzed
- Should add indexes for slow queries

**Relations**:
- Used by src/orchestrator/scheduler.ts
- Used by src/orchestrator/reaper.ts
- Query performance critical for system scalability

---

### apps/api/src/queue/producer.ts
**Purpose**: Redis queue client for pushing jobs

**Exports**:
```typescript
class QueueProducer {
  async push(task_run_id: string, run_id: string, attempt: number): Promise<void>
}
```

**Implementation**:
```typescript
async push(task_run_id, run_id, attempt) {
  const job = JSON.stringify({ task_run_id, run_id, attempt })
  await redis.lpush('task_queue', job)
}
```

**Constraints**:
- Must serialize job payload consistently
- Should add retry on Redis connection error
- Should monitor queue depth

**Relations**:
- Used by src/orchestrator/scheduler.ts
- Worker consumes from same queue key
- Redis persistence must be configured

---

### apps/api/src/queue/eventConsumer.ts
**Purpose**: Listen for task completion events and unlock downstream tasks

**Function**:
```typescript
async function consumeEvents(): Promise<never>
```

**Loop**:
```
while (true) {
  1. Subscribe to Redis pubsub: "task_completed"
  2. On event received:
     - Parse { task_run_id, run_id, status }
     - If status = SUCCESS:
       - Run unlock logic (packages/core/src/engine/unlock.ts)
       - Update downstream tasks PENDING → READY or BLOCKED
     - If status = FAILED:
       - Check if run should fail
       - Update run status if needed
  3. Repeat
}
```

**Unlock Logic**:
```sql
-- Find downstream tasks
SELECT tr.id, tr.task_id, t.requires_approval
FROM task_runs tr
JOIN tasks t ON t.id = tr.task_id
JOIN dependencies d ON d.task_id = tr.task_id
WHERE d.depends_on_task_id = :completed_task_id
  AND tr.run_id = :run_id
  AND tr.status = 'PENDING'

-- For each downstream task, check if all deps satisfied
SELECT COUNT(*) = COUNT(CASE WHEN upstream.status = 'SUCCESS' THEN 1 END)
FROM dependencies d
JOIN task_runs upstream ON upstream.task_id = d.depends_on_task_id
WHERE d.task_id = :downstream_task_id
  AND upstream.run_id = :run_id

-- If all satisfied, unlock
UPDATE task_runs
SET status = CASE
  WHEN :requires_approval THEN 'BLOCKED'
  ELSE 'READY'
END
WHERE id = :downstream_task_run_id
```

**Run Completion**:
```sql
-- Check if all tasks terminal
SELECT COUNT(*) = 0
FROM task_runs
WHERE run_id = :run_id
  AND status NOT IN ('SUCCESS', 'FAILED', 'CANCELLED')

-- If all done, determine run status
UPDATE runs
SET status = CASE
  WHEN EXISTS (SELECT 1 FROM task_runs WHERE run_id = :run_id AND status = 'FAILED') THEN 'FAILED'
  ELSE 'SUCCESS'
END,
finished_at = NOW()
WHERE id = :run_id
```

**Constraints**:
- Must handle duplicate events (idempotent)
- Must be atomic (transaction per event)
- Must not block publisher (async processing)

**Relations**:
- Subscribes to Redis pubsub
- Updates task_runs table
- Uses packages/core/src/engine/unlock.ts
- Worker publishes events

---

### apps/api/src/util/errors.ts
**Purpose**: Custom error classes for API

**Exports**:
```typescript
class NotFoundError extends Error {
  statusCode = 404
}

class ValidationError extends Error {
  statusCode = 400
  errors: string[]
}

class ConflictError extends Error {
  statusCode = 409
}
```

**Relations**:
- Thrown by src/services/* layer
- Caught by error middleware in src/main.ts
- Mapped to HTTP status codes

---

### apps/api/src/util/ids.ts
**Purpose**: Generate unique identifiers

**Functions**:
```typescript
function generateRunId(): string      // "run_" + nanoid(12)
function generateTaskRunId(): string   // "tr_" + nanoid(12)
function generateArtifactId(): string  // "art_" + nanoid(12)
```

**Constraints**:
- Must be globally unique
- Should be URL-safe
- Should be sortable by time (optional)

**Relations**:
- Used by src/services/runService.ts
- Used by worker when creating artifacts

---

### apps/api/src/util/logger.ts
**Purpose**: Structured logging for API

**Exports**:
```typescript
const logger = {
  info(msg: string, meta?: object): void
  warn(msg: string, meta?: object): void
  error(msg: string, error: Error, meta?: object): void
  http(req: Request, res: Response, duration_ms: number): void
}
```

**HTTP Logging**:
```json
{
  "timestamp": "...",
  "level": "http",
  "method": "POST",
  "path": "/runs",
  "status": 201,
  "duration_ms": 45
}
```

**Relations**:
- Used throughout API codebase
- HTTP middleware logs all requests
- Logs to stdout (captured by container runtime)

---


## CLI Application (Developer Interface)

### apps/cli/src/main.ts
**Purpose**: CLI entrypoint - command router

**Execution Flow**:
```
1. Parse command and arguments (using commander or yargs)
2. Route to command handler:
   - init → src/commands/init.ts
   - validate → src/commands/validate.ts
   - run → src/commands/run.ts
   - status → src/commands/status.ts
   - logs → src/commands/logs.ts
   - approve → src/commands/approve.ts
3. Handle errors and exit codes
4. Exit with appropriate code
```

**Commands**:
```bash
relay init <workflow-file>      # Register workflow
relay validate <workflow-file>  # Validate DAG
relay run <workflow-id> [--input key=value]  # Start run
relay status <run-id>           # Check progress
relay logs <task-run-id>        # View logs
relay approve <task-run-id>     # Approve blocked task
```

**Relations**:
- Routes to src/commands/* handlers
- Uses src/util/exitCodes.ts
- Uses src/util/printer.ts for output

---

### apps/cli/src/api/client.ts
**Purpose**: HTTP client for Relay API

**Exports**:
```typescript
class RelayClient {
  async createWorkflow(id, name, definition): Promise<Workflow>
  async getWorkflow(id): Promise<Workflow>
  async createRun(workflow_id, input?): Promise<Run>
  async getRun(id): Promise<Run>
  async approveTask(task_run_id): Promise<TaskRun>
  async getTaskRun(id): Promise<TaskRun>
  async getTaskLogs(id): Promise<Log[]>
}
```

**Implementation**:
```typescript
class RelayClient {
  constructor(baseURL: string, apiKey?: string) {
    this.baseURL = baseURL
    this.headers = {
      'Content-Type': 'application/json',
      ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
    }
  }
  
  async createWorkflow(id, name, definition) {
    const res = await fetch(`${this.baseURL}/workflows`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ id, name, definition })
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  }
  // ... other methods
}
```

**Constraints**:
- Must handle network errors gracefully
- Must parse API error responses
- Should retry on transient failures

**Relations**:
- Used by all src/commands/*
- Calls apps/api/src/routes/*
- Uses packages/types/src/api.ts for types

---

### apps/cli/src/commands/init.ts
**Purpose**: Register workflow with Relay

**Command**: `relay init <workflow-file>`

**Execution Flow**:
```
1. Load workflow file (src/config/loadWorkflow.ts)
2. Parse YAML
3. Normalize workflow (packages/core/src/workflow/normalize.ts)
4. Validate DAG (packages/core/src/dag/validate.ts)
5. If valid:
   - Call API: POST /workflows
   - Print success message with workflow ID
6. If invalid:
   - Print validation errors
   - Exit with error code
```

**Example**:
```bash
$ relay init workflows/demo_prd.yaml

✓ Workflow validated successfully
✓ Registered workflow: demo_prd
  Tasks: 5
  Dependencies: 4

Run with: relay run demo_prd
```

**Constraints**:
- Must validate before sending to API
- Must print clear error messages
- Should show DAG visualization (optional)

**Relations**:
- Uses src/config/loadWorkflow.ts
- Uses src/api/client.ts
- Uses packages/core/src/dag/validate.ts

---

### apps/cli/src/commands/validate.ts
**Purpose**: Validate workflow without registering

**Command**: `relay validate <workflow-file>`

**Execution Flow**:
```
1. Load workflow file
2. Parse YAML
3. Validate schema (src/config/schema.ts)
4. Normalize workflow
5. Validate DAG
6. Print validation report:
   - Schema errors
   - DAG errors (cycles, invalid refs)
   - Warnings (disconnected components)
7. Exit with 0 if valid, 1 if invalid
```

**Example Output**:
```bash
$ relay validate workflows/demo_prd.yaml

✓ Schema valid
✓ DAG valid
  
Tasks: 5
  - research (no dependencies)
  - outline (depends on: research)
  - draft (depends on: outline)
  - review (depends on: draft)
  - finalize (depends on: review, research)

Dependencies: 4
Execution phases: 5
```

**Relations**:
- Uses src/config/loadWorkflow.ts
- Uses src/config/schema.ts
- Uses packages/core/src/dag/validate.ts

---

### apps/cli/src/commands/run.ts
**Purpose**: Start workflow execution

**Command**: `relay run <workflow-id> [--input key=value]`

**Execution Flow**:
```
1. Parse workflow ID and input args
2. Build input object from --input flags
3. Call API: POST /runs
4. Print run ID and initial status
5. Optionally: watch progress (polling loop)
```

**Example**:
```bash
$ relay run demo_prd --input topic="AI coding assistant"

✓ Run started: run_abc123

Status: RUNNING
Tasks:
  ✓ research (READY)
  · outline (PENDING)
  · draft (PENDING)
  · review (PENDING)
  · finalize (PENDING)

Watch progress: relay status run_abc123
```

**Watch Mode** (optional):
```bash
$ relay run demo_prd --watch

⠋ Running...
  ✓ research (SUCCESS) - 12s
  ⠋ outline (RUNNING) - 3s
  · draft (PENDING)
  · review (PENDING)
  · finalize (PENDING)
```

**Relations**:
- Uses src/api/client.ts
- Can call src/commands/status.ts for watching
- Uses src/util/printer.ts for formatting

---

### apps/cli/src/commands/status.ts
**Purpose**: Check run progress

**Command**: `relay status <run-id> [--watch]`

**Execution Flow**:
```
1. Call API: GET /runs/:id
2. Print run status and task breakdown
3. If --watch:
   - Poll every 2s
   - Update display in place (clear + reprint)
   - Exit when terminal state reached
```

**Example Output**:
```bash
$ relay status run_abc123

Run: run_abc123
Workflow: demo_prd
Status: RUNNING
Started: 2 minutes ago

Tasks (3/5 complete):
  ✓ research (SUCCESS) - 12s - 45 tokens
  ✓ outline (SUCCESS) - 8s - 120 tokens
  ⠋ draft (RUNNING) - 15s so far
  · review (PENDING)
  ⊗ finalize (BLOCKED) - waiting for approval

Total tokens: 165
Estimated cost: $0.003
```

**Constraints**:
- Must format duration nicely (2m 34s)
- Must show progress indicator
- Watch mode should clear screen

**Relations**:
- Uses src/api/client.ts
- Uses src/util/printer.ts
- Displays data from apps/api

---

### apps/cli/src/commands/logs.ts
**Purpose**: View task execution logs

**Command**: `relay logs <task-run-id> [--follow]`

**Execution Flow**:
```
1. Call API: GET /task-runs/:id/logs
2. Print logs chronologically
3. If --follow:
   - Poll for new logs
   - Append to display
   - Exit when task terminal
```

**Example Output**:
```bash
$ relay logs tr_123

[2025-02-08 10:00:00] Task started
[2025-02-08 10:00:01] Resolving inputs...
[2025-02-08 10:00:01] Found upstream output from task 'research'
[2025-02-08 10:00:01] Rendering prompt template...
[2025-02-08 10:00:02] Calling OpenAI API (gpt-4)...
[2025-02-08 10:00:14] Received response (120 tokens)
[2025-02-08 10:00:14] Extracting JSON output...
[2025-02-08 10:00:14] Validation passed
[2025-02-08 10:00:14] Task completed successfully
```

**Relations**:
- Uses src/api/client.ts
- Reads logs from worker execution
- Uses src/util/printer.ts

---

### apps/cli/src/commands/approve.ts
**Purpose**: Approve blocked task (human-in-the-loop)

**Command**: `relay approve <task-run-id>`

**Execution Flow**:
```
1. Call API: GET /task-runs/:id
2. Verify status is BLOCKED
3. Show task details and prompt for confirmation
4. If confirmed:
   - Call API: POST /task-runs/:id/approve
   - Print success message
5. If cancelled:
   - Exit without approving
```

**Example**:
```bash
$ relay approve tr_456

Task: review (demo_prd)
Status: BLOCKED
Output from previous task:
  ---
  [draft content here]
  ---

Approve this task to continue? (y/n): y

✓ Task approved
  Status: READY → will execute shortly

Watch progress: relay status run_abc123
```

**Relations**:
- Uses src/api/client.ts
- Calls apps/api/src/routes/taskRuns.ts
- Triggers scheduler to pick up task

---

### apps/cli/src/config/loadWorkflow.ts
**Purpose**: Load and parse workflow YAML files

**Function**:
```typescript
async function loadWorkflow(filepath: string): Promise<WorkflowDefinition>
```

**Execution Flow**:
```
1. Read file from disk
2. Parse YAML (using js-yaml)
3. Return raw object
```

**Constraints**:
- Must handle file not found
- Must handle invalid YAML syntax
- Must preserve comments (for error messages)

**Relations**:
- Used by src/commands/init.ts
- Used by src/commands/validate.ts
- Output passed to src/config/schema.ts

---

### apps/cli/src/config/schema.ts
**Purpose**: JSON Schema for workflow YAML validation

**Exports**:
```typescript
const workflowSchema: JSONSchema = {
  type: 'object',
  required: ['name', 'tasks'],
  properties: {
    name: { type: 'string' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'prompt', 'model', 'provider'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9_]+$' },
          name: { type: 'string' },
          prompt: { type: 'string' },
          model: { type: 'string' },
          provider: { enum: ['openai', 'anthropic'] },
          depends_on: {
            type: 'array',
            items: { type: 'string' }
          },
          requires_approval: { type: 'boolean' },
          config: {
            type: 'object',
            properties: {
              temperature: { type: 'number', min: 0, max: 2 },
              max_tokens: { type: 'number', min: 1 },
              json_output: { type: ['boolean', 'object'] }
            }
          }
        }
      }
    }
  }
}

function validateWorkflowSchema(workflow: any): ValidationResult
```

**Constraints**:
- Schema must match packages/core/src/workflow/types.ts
- Should provide helpful error messages
- Should allow extra fields (forward compatibility)

**Relations**:
- Used by src/commands/validate.ts
- Validates before normalization
- Errors shown to user in CLI

---

### apps/cli/src/util/exitCodes.ts
**Purpose**: Standardized exit codes for CLI

**Exports**:
```typescript
const EXIT_CODES = {
  SUCCESS: 0,
  VALIDATION_ERROR: 1,
  API_ERROR: 2,
  NOT_FOUND: 3,
  CANCELLED: 4
}
```

**Relations**:
- Used by all src/commands/*
- Enables script integration (if status != 0 then ...)
- Follows POSIX conventions

---

### apps/cli/src/util/printer.ts
**Purpose**: Formatted console output

**Exports**:
```typescript
function printSuccess(message: string): void
function printError(message: string): void
function printWarning(message: string): void
function printTable(headers: string[], rows: string[][]): void
function printJSON(obj: any): void
function printProgress(current: number, total: number): void
```

**Implementation**:
```typescript
// Uses chalk for colors
printSuccess(msg) {
  console.log(chalk.green('✓'), msg)
}

printError(msg) {
  console.error(chalk.red('✗'), msg)
}

printTable(headers, rows) {
  // Uses cli-table3 or similar
}
```

**Relations**:
- Used by all src/commands/*
- Provides consistent UX
- Respects NO_COLOR env var

---

## Web Application (Visualization)

### apps/web/src/pages/index.tsx
**Purpose**: Homepage - list all runs

**Component**:
```typescript
export default function Home() {
  const [runs, setRuns] = useState<Run[]>([])
  
  useEffect(() => {
    // Fetch runs from API
    client.listRuns().then(setRuns)
  }, [])
  
  return (
    <div>
      <h1>Relay Runs</h1>
      <RunList runs={runs} />
    </div>
  )
}
```

**Layout**:
```
+-----------------------------------+
| Relay                             |
+-----------------------------------+
| Recent Runs                       |
|                                   |
| run_abc123  demo_prd   RUNNING   |
| run_def456  demo_code  SUCCESS   |
| run_ghi789  demo_prd   FAILED    |
+-----------------------------------+
```

**Relations**:
- Uses src/api/client.ts
- Links to src/pages/runs/[runId].tsx
- Uses src/components/StatusPill.tsx

---

### apps/web/src/pages/runs/[runId].tsx
**Purpose**: Run detail page - DAG visualization and task status

**Component**:
```typescript
export default function RunPage() {
  const { runId } = useRouter().query
  const [run, setRun] = useState<Run | null>(null)
  
  useEffect(() => {
    const interval = setInterval(() => {
      client.getRun(runId).then(setRun)
    }, 2000)
    return () => clearInterval(interval)
  }, [runId])
  
  if (!run) return <div>Loading...</div>
  
  return (
    <div>
      <RunHeader run={run} />
      <RunGraph taskRuns={run.task_runs} />
      <TaskPanel taskRuns={run.task_runs} />
    </div>
  )
}
```

**Layout**:
```
+-----------------------------------+
| Run: run_abc123                   |
| Workflow: demo_prd                |
| Status: RUNNING                   |
+-----------------------------------+
|                                   |
|  [DAG Visualization]              |
|                                   |
|  research → outline → draft       |
|      ↓                   ↓        |
|  finalize ←────────── review      |
|                                   |
+-----------------------------------+
| Task Details                      |
|                                   |
| [Expandable list of tasks]        |
+-----------------------------------+
```

**Relations**:
- Uses src/api/client.ts
- Uses src/components/RunGraph.tsx
- Uses src/components/TaskPanel.tsx
- Polls for updates every 2s

---

### apps/web/src/components/RunGraph.tsx
**Purpose**: DAG visualization using React Flow or D3

**Component**:
```typescript
export function RunGraph({ taskRuns }: { taskRuns: TaskRun[] }) {
  const nodes = taskRuns.map(tr => ({
    id: tr.task_id,
    data: { label: tr.task_id, status: tr.status },
    position: computePosition(tr.task_id)
  }))
  
  const edges = buildEdges(taskRuns)
  
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={customNodeTypes}
    />
  )
}
```

**Node Styling**:
```
Status colors:
- PENDING: gray
- READY: blue
- QUEUED: yellow
- RUNNING: orange (pulsing animation)
- SUCCESS: green
- FAILED: red
- BLOCKED: purple
```

**Layout Algorithm**:
- Layered graph layout (Sugiyama)
- Or force-directed layout (D3)
- Topological ordering left-to-right

**Relations**:
- Uses packages/core/src/dag/topo.ts for ordering
- Visualizes task_runs data
- Interactive (click node → show details)

---

### apps/web/src/components/StatusPill.tsx
**Purpose**: Styled status badge

**Component**:
```typescript
export function StatusPill({ status }: { status: TaskRunStatus }) {
  const colors = {
    PENDING: 'gray',
    READY: 'blue',
    QUEUED: 'yellow',
    RUNNING: 'orange',
    SUCCESS: 'green',
    FAILED: 'red',
    BLOCKED: 'purple',
    CANCELLED: 'gray'
  }
  
  return (
    <span className={`pill pill-${colors[status]}`}>
      {status}
    </span>
  )
}
```

**Styling** (Tailwind):
```css
.pill {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}

.pill-green { background: #D1FAE5; color: #065F46; }
.pill-red { background: #FEE2E2; color: #991B1B; }
/* ... etc */
```

**Relations**:
- Used by src/pages/index.tsx
- Used by src/components/TaskPanel.tsx
- Used by src/components/RunGraph.tsx

---

### apps/web/src/components/TaskPanel.tsx
**Purpose**: Expandable task details

**Component**:
```typescript
export function TaskPanel({ taskRuns }: { taskRuns: TaskRun[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  
  return (
    <div className="task-panel">
      {taskRuns.map(tr => (
        <TaskRow
          key={tr.id}
          taskRun={tr}
          expanded={expanded === tr.id}
          onToggle={() => setExpanded(tr.id)}
        />
      ))}
    </div>
  )
}

function TaskRow({ taskRun, expanded, onToggle }) {
  return (
    <div className="task-row">
      <div className="task-header" onClick={onToggle}>
        <StatusPill status={taskRun.status} />
        <span>{taskRun.task_id}</span>
        <span>{taskRun.duration}</span>
      </div>
      {expanded && (
        <div className="task-details">
          <pre>{taskRun.output}</pre>
          {taskRun.status === 'BLOCKED' && (
            <button onClick={() => approveTask(taskRun.id)}>
              Approve
            </button>
          )}
        </div>
      )}
    </div>
  )
}
```

**Relations**:
- Uses src/components/StatusPill.tsx
- Uses src/api/client.ts for approval
- Shows artifacts when expanded

---

### apps/web/src/api/client.ts
**Purpose**: API client for web app (same as CLI)

**Exports**: Same as apps/cli/src/api/client.ts

**Implementation**: 
- Uses fetch API
- Handles auth token from localStorage
- SWR or React Query for caching (optional)

**Relations**:
- Used by all pages and components
- Shares types with packages/types/src/api.ts
- Identical logic to CLI client

---

## Supporting Files

### .env.example
**Purpose**: Template for environment variables

**Contents**:
```bash
# Database
DATABASE_URL=postgresql://relay:relay@localhost:5432/relay

# Redis
REDIS_URL=redis://localhost:6379

# API
PORT=3000
API_KEY=your_secret_key_here

# Provider API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Worker Config
MAX_RETRIES=3
HEARTBEAT_INTERVAL_MS=30000
REQUEST_TIMEOUT_MS=60000

# Scheduler Config
SCHEDULER_INTERVAL_MS=1000
REAPER_INTERVAL_MS=60000
MAX_PARALLEL_TASKS=10
```

---

### pnpm-workspace.yaml
**Purpose**: Define pnpm monorepo workspaces

**Contents**:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

**Relations**:
- Enables `pnpm -r` commands
- Enables workspace protocol (workspace:*)
- Hoists shared dependencies

---

### tsconfig.base.json
**Purpose**: Shared TypeScript config for all packages

**Contents**:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true
  }
}
```

**Relations**:
- Extended by all apps/*/tsconfig.json
- Extended by all packages/*/tsconfig.json
- Ensures consistent compilation

---

### scripts/dev.sh
**Purpose**: Start all services in dev mode

**Contents**:
```bash
#!/bin/bash
set -e

# Start infrastructure
docker-compose -f infra/docker-compose.yml up -d postgres redis

# Wait for postgres
until pg_isready -h localhost -p 5432; do sleep 1; done

# Run migrations
./scripts/migrate.sh

# Start services in parallel
pnpm --filter api dev &
pnpm --filter worker dev &
pnpm --filter web dev &

wait
```

**Relations**:
- Starts infra/docker-compose.yml
- Runs scripts/migrate.sh
- Starts all apps in watch mode

---

### scripts/migrate.sh
**Purpose**: Run database migrations

**Contents**:
```bash
#!/bin/bash
set -e

DATABASE_URL=${DATABASE_URL:-postgresql://relay:relay@localhost:5432/relay}

for migration in infra/migrations/*.sql; do
  echo "Running $migration..."
  psql $DATABASE_URL < $migration
done

echo "Migrations complete"
```

**Relations**:
- Runs infra/migrations/*.sql in order
- Called by scripts/dev.sh
- Should track applied migrations (future: use migrate tool)

---

## Summary: File Relationships

**Data Flow (Happy Path)**:
```
1. User runs: relay init workflow.yaml
   → CLI loads/validates/normalizes workflow
   → API stores in workflows/tasks/dependencies tables
   
2. User runs: relay run workflow_id
   → API creates run + task_runs (all PENDING)
   → API marks root tasks as READY
   → Scheduler finds READY tasks → pushes to queue
   
3. Worker pulls from queue
   → Claims task (QUEUED → RUNNING)
   → Resolves inputs from artifacts table
   → Renders prompt
   → Calls OpenAI/Anthropic
   → Stores output in artifacts
   → Updates task_run (RUNNING → SUCCESS)
   → Publishes completion event
   
4. Event consumer receives event
   → Runs unlock logic
   → Marks downstream tasks as READY
   → Scheduler picks them up
   → Repeat step 3
   
5. When all tasks done:
   → Event consumer marks run as SUCCESS/FAILED
   → User runs: relay status run_id
   → CLI fetches and displays results
```

**Critical Invariants**:
- Task can only move forward in state machine (except retry)
- Artifact write must be atomic with status=SUCCESS
- Downstream tasks only unlock when ALL deps are SUCCESS
- Scheduler only queues tasks in READY state
- Worker must claim atomically (prevent double execution)
- Heartbeat must update while RUNNING
- Reaper only acts on stale heartbeats

**Key Files by Concern**:

State Machine:
- packages/core/src/engine/state.ts (transitions)
- packages/core/src/engine/unlock.ts (dependency resolution)
- apps/worker/src/queue/consumer.ts (execution)
- apps/api/src/queue/eventConsumer.ts (unlocking)

DAG Processing:
- packages/core/src/dag/build.ts (graph construction)
- packages/core/src/dag/validate.ts (cycle detection)
- packages/core/src/dag/topo.ts (ordering)

Task Execution:
- apps/worker/src/exec/resolveInputs.ts (fetch upstream outputs)
- apps/worker/src/exec/renderPrompt.ts (template rendering)
- apps/worker/src/exec/promptEnvelope.ts (provider formatting)
- apps/worker/src/connectors/* (API calls)
- apps/worker/src/exec/jsonExtract.ts (output parsing)

Scheduling:
- apps/api/src/orchestrator/scheduler.ts (queue READY tasks)
- apps/api/src/orchestrator/reaper.ts (recover stuck tasks)
- apps/api/src/orchestrator/sql.ts (queries)

---

