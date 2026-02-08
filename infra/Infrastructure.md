# Relay Infrastructure

This directory contains the database schema, Docker configuration, and infrastructure setup for Relay.

## Components

### PostgreSQL Database
- **Purpose**: Persistent storage for workflows, runs, tasks, and state
- **Port**: 5432
- **Schema**: 6 tables (workflows, runs, tasks, dependencies, task_runs, artifacts)

### Redis
- **Purpose**: Job queue for task execution
- **Port**: 6379
- **Configuration**: Optimized for queue workload (no persistence in dev)

## Quick Start

```bash
# Start services
cd infra
docker-compose up -d

# Verify everything works
./test_infra.sh

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Stop and remove data
docker-compose down -v
```

## Database Schema

### Workflows
Stores workflow definitions from YAML files.
```sql
workflows (
  id TEXT PRIMARY KEY,
  name TEXT,
  definition JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
```

### Runs
Tracks workflow execution instances.
```sql
runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT REFERENCES workflows,
  status TEXT CHECK (status IN ('RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED')),
  input JSONB,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
)
```

### Tasks
Static task definitions from workflows.
```sql
tasks (
  id TEXT,
  workflow_id TEXT REFERENCES workflows,
  name TEXT,
  config JSONB,
  requires_approval BOOLEAN,
  PRIMARY KEY (id, workflow_id)
)
```

### Dependencies
DAG edges defining task dependencies.
```sql
dependencies (
  id SERIAL PRIMARY KEY,
  workflow_id TEXT REFERENCES workflows,
  task_id TEXT,
  depends_on_task_id TEXT,
  FOREIGN KEY (task_id, workflow_id) REFERENCES tasks,
  UNIQUE (workflow_id, task_id, depends_on_task_id)
)
```

### Task Runs (THE STATE MACHINE)
Individual task execution instances.
```sql
task_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs,
  task_id TEXT,
  workflow_id TEXT REFERENCES workflows,
  status TEXT CHECK (status IN ('PENDING', 'READY', 'QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'BLOCKED', 'CANCELLED')),
  attempt INTEGER,
  input JSONB,
  output TEXT,
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
```

### Artifacts
Task output storage.
```sql
artifacts (
  id TEXT PRIMARY KEY,
  task_run_id TEXT REFERENCES task_runs,
  content TEXT,
  content_type TEXT,
  created_at TIMESTAMPTZ
)
```

## State Machine

Task runs progress through these states:

```
PENDING → READY → QUEUED → RUNNING → SUCCESS
                                   → FAILED
          READY → BLOCKED → READY (after approval)
          * → CANCELLED
```

## Indexes

Critical indexes for performance:
- `idx_task_runs_status_run` - Scheduler queries for READY tasks
- `idx_task_runs_heartbeat` - Reaper queries for stuck tasks
- `idx_dependencies_task` - DAG traversal

## Manual Database Access

```bash
# Connect to PostgreSQL
docker-compose exec postgres psql -U relay -d relay

# Connect to Redis
docker-compose exec redis redis-cli

# View all workflows
docker-compose exec postgres psql -U relay -d relay -c "SELECT * FROM workflows;"

# View run status
docker-compose exec postgres psql -U relay -d relay -c "
  SELECT r.id, r.status, COUNT(tr.id) as total_tasks,
         COUNT(CASE WHEN tr.status = 'SUCCESS' THEN 1 END) as completed
  FROM runs r
  LEFT JOIN task_runs tr ON tr.run_id = r.id
  GROUP BY r.id, r.status;
"
```

## Troubleshooting

### Port already in use
```bash
# Check what's using port 5432
lsof -i :5432

# Or use different ports in docker-compose.yml
ports:
  - "5433:5432"  # Host:Container
```

### Migration issues
```bash
# Reset database completely
docker-compose down -v
docker-compose up -d

# Manually run migrations
docker-compose exec postgres psql -U relay -d relay < migrations/001_init.sql
```

### Redis connection issues
```bash
# Check Redis is running
docker-compose ps

# Test Redis directly
docker-compose exec redis redis-cli ping

# View Redis logs
docker-compose logs redis
```

## Next Steps

Once infrastructure tests pass:
1. Build shared packages (types, core logic)
2. Build API (control plane)
3. Build worker (execution engine)
