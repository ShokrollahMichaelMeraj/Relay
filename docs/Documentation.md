
Whe does relay know a task is done:

- the worker receives a successful response from a model API call,
- persists the output,
- and atomically marks the TaskRun status as SUCCESS in the database.


Relay knows it failed when:
- it gets an error response/timeout,
- it can’t parse required output,
- or it exceeds retry limits.



## Database set up:

1) The state machine (source of truth)
Each task in a run has a status in DB:
PENDING (created, not eligible yet)
READY (all dependencies satisfied)
QUEUED (job placed on queue)
RUNNING (worker claimed it)
SUCCESS (output stored + status set)
FAILED (error stored + status set)
BLOCKED (waiting for human approval)
CANCELLED (optional)
A run has:
RUNNING, SUCCESS, FAILED, CANCELLED
Relay “knows” what’s happening by reading these statuses.



2) What happens when you click Run (deterministic)
Step A — Compile the workflow into tables
You already have a workflow definition (YAML). Relay turns it into:
tasks rows (one per task)
dependencies rows (edges)
runs row (one run)
task_runs rows (one per task, per run)
All task_runs start PENDING.
Then Relay computes which tasks have zero unmet dependencies → marks them READY.
3) Scheduling: how Relay decides what starts next
Scheduler loop (in API/orchestrator):
Query DB for task_runs where:
status = READY
and run.status = RUNNING
Take up to max_parallel tasks
For each:
set status to QUEUED
push a job into Redis queue
That’s it. Dependencies are handled by DB state, not vibes.
4) Execution: what the worker does
A worker pulls a job from Redis:
Job contains:
task_run_id
run_id
attempt number
Worker steps:
Step 1 — Claim the task (prevents double execution)
Worker runs an atomic DB update:
“Change status from QUEUED → RUNNING only if it’s currently QUEUED.”
If update affects 0 rows, someone else claimed it or it was cancelled → worker stops.
Step 2 — Resolve inputs
Task prompts can reference prior outputs, like:
{{ tasks.research.output }}
Worker fetches required upstream task outputs (artifacts) from DB.
If an upstream artifact is missing → error (this shouldn’t happen if scheduler is correct, but it’s a safety check).
Step 3 — Build the request
Worker renders the prompt template into a final string (UTF-8 bytes).
Also sets model params:
temperature, max_tokens, etc.
Step 4 — Call the model connector (OpenAI/Anthropic)
Worker makes an HTTPS request.
How it knows the “chat is done”
Because the model API call returns either:
an HTTP success response (e.g. 200) with a completion payload, or
an error response/timeout.
That API response boundary is the “done” signal.
Step 5 — Store output + mark success
Worker writes:
an artifact row containing output text (or pointer to object storage)
updates task_runs.status = SUCCESS
writes metadata: tokens, latency, model, prompt hash
This DB write is the durable record that it’s finished.
5) Error detection: all the ways a task can fail
Relay detects errors by explicit conditions:
A) Transport / network errors
DNS failure
TLS error
connection refused
request timeout
→ mark task FAILED, store error code and message.
B) Provider errors (HTTP status)
401 unauthorized (bad key)
429 rate limited
500/503 provider down
Policy:
429/5xx → retry with backoff up to N
401/403 → fail immediately (no point retrying)
C) Application-level errors
Even if HTTP 200 succeeds, you can still fail if you require a format.
Example: task requires JSON output:
if output isn’t valid JSON → FAILED or RETRY depending on policy
Same for:
required fields missing
output too long/empty
“schema validation” fails
D) Execution budget errors
exceeded max tokens
exceeded max wall-clock time
exceeded max retries
→ fail with a clear error reason.
6) How dependencies unlock downstream tasks
Whenever a task becomes SUCCESS, the orchestrator does:
For each downstream task D that depends on T:
Check if all dependencies of D are SUCCESS
If yes:
if D has a human gate → mark BLOCKED
else mark READY
This can be done either:
by the API server reacting to “task success” events, or
by a scheduler loop that continually scans for newly-unblocked tasks.
MVP easiest: scheduler loop + DB queries.
7) How Relay handles “stuck” tasks
A task can get stuck if a worker dies mid-run.
So we add:
heartbeat timestamp on task_runs
worker periodically updates heartbeat while RUNNING
A reaper process:
if status=RUNNING and heartbeat older than X:
set back to QUEUED (retry) or FAILED (if too many attempts)
This is exactly how reliable job systems work.
8) Byte-level: what is actually sent/stored
You said “down to byte level” — here’s the practical version (no hand-wavy stuff).
A) Workflow file (YAML)
stored as UTF-8 bytes
parsed into an in-memory structure
normalized into JSON for DB storage
B) Queue job payload (Redis)
Typically a JSON string (UTF-8), for example:
{"task_run_id":"tr_123","run_id":"r_88","attempt":1}
That’s literally bytes in Redis.
C) Model request
HTTPS request:
headers (ASCII)
body JSON (UTF-8)
Example body contains:
model id string
prompt string
numeric parameters
D) Model response
HTTPS response:
status code
JSON payload
output text (UTF-8)
Relay stores:
raw output bytes (as text) or compressed blob
metadata integers (token counts)
timestamps (usually 64-bit)
E) Artifacts
In MVP:
store in Postgres TEXT (UTF-8)
Later:
store in object storage, DB stores a URL/pointer.
9) The minimum “correctness contracts” to implement
If you implement these, the system is reliable:
Atomic claim: QUEUED → RUNNING only once
Durable output: store artifact before SUCCESS
Timeouts everywhere: request timeout + task wall-clock timeout
Retry policy: only retry 429/5xx/timeouts
Heartbeat + reaper: recover from worker death
Cycle detection: DAG must be acyclic
10) The simplest “end-to-end” example
Workflow:
A (no deps)
B depends on A
C depends on A
D depends on B and C
Run:
A READY → queued → RUNNING → SUCCESS
B and C become READY → run in parallel
Once both SUCCESS → D becomes READY → runs → done
Relay doesn’t “watch chats”. It watches status transitions backed by durable storage.


