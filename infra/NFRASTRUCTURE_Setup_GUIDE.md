# Relay - Step 1: Infrastructure Setup Guide

## Files to Create

You need to create these 6 files in your project:

```
relay/
├── infra/
│   ├── docker-compose.yml
│   ├── migrations/
│   │   └── 001_init.sql
│   ├── postgres/
│   │   └── init.sql
│   ├── redis/
│   │   └── redis.conf
│   ├── test_infra.sh
│   └── README.md
```

---

## Step-by-Step Instructions

### 1. Create Project Directory

```bash
mkdir -p relay/infra/{migrations,postgres,redis}
cd relay/infra
```

---

### 2. Create `docker-compose.yml`

**File: `relay/infra/docker-compose.yml`**

```yaml
version: '3.8'

services:
  # PostgreSQL - State storage
  postgres:
    image: postgres:15-alpine
    container_name: relay-postgres
    environment:
      POSTGRES_DB: relay
      POSTGRES_USER: relay
      POSTGRES_PASSWORD: relay
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./migrations:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U relay"]
      interval: 5s
      timeout: 5s
      retries: 5

  # Redis - Job queue
  redis:
    image: redis:7-alpine
    container_name: relay-redis
    command: redis-server /usr/local/etc/redis/redis.conf
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
      - ./redis/redis.conf:/usr/local/etc/redis/redis.conf
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

---

### 3. Create `migrations/001_init.sql`

**File: `relay/infra/migrations/001_init.sql`**

```sql
-- Relay Database Schema v1
-- This migration creates all core tables for workflow orchestration

-- =============================================================================
-- 1. WORKFLOWS TABLE
-- Purpose: Store workflow definitions (from YAML files)
-- =============================================================================
CREATE TABLE workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    definition JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflows_created_at ON workflows(created_at DESC);

-- =============================================================================
-- 2. RUNS TABLE
-- Purpose: Track execution instances of workflows
-- =============================================================================
CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED')),
    input JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX idx_runs_workflow_id ON runs(workflow_id);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_runs_started_at ON runs(started_at DESC);

-- =============================================================================
-- 3. TASKS TABLE
-- Purpose: Static task definitions extracted from workflows
-- =============================================================================
CREATE TABLE tasks (
    id TEXT NOT NULL,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    config JSONB NOT NULL,
    requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (id, workflow_id)
);

CREATE INDEX idx_tasks_workflow_id ON tasks(workflow_id);

-- =============================================================================
-- 4. DEPENDENCIES TABLE
-- Purpose: Define DAG edges (which tasks depend on which)
-- =============================================================================
CREATE TABLE dependencies (
    id SERIAL PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    depends_on_task_id TEXT NOT NULL,
    FOREIGN KEY (task_id, workflow_id) REFERENCES tasks(id, workflow_id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on_task_id, workflow_id) REFERENCES tasks(id, workflow_id) ON DELETE CASCADE,
    UNIQUE (workflow_id, task_id, depends_on_task_id)
);

CREATE INDEX idx_dependencies_task ON dependencies(workflow_id, task_id);
CREATE INDEX idx_dependencies_depends_on ON dependencies(workflow_id, depends_on_task_id);

-- =============================================================================
-- 5. TASK_RUNS TABLE
-- Purpose: Execution instances of individual tasks (THE STATE MACHINE)
-- =============================================================================
CREATE TABLE task_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN (
        'PENDING',
        'READY',
        'QUEUED',
        'RUNNING',
        'SUCCESS',
        'FAILED',
        'BLOCKED',
        'CANCELLED'
    )),
    attempt INTEGER NOT NULL DEFAULT 0,
    input JSONB,
    output TEXT,
    error TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    heartbeat_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (task_id, workflow_id) REFERENCES tasks(id, workflow_id)
);

CREATE INDEX idx_task_runs_status_run ON task_runs(status, run_id);
CREATE INDEX idx_task_runs_run_id ON task_runs(run_id);
CREATE INDEX idx_task_runs_heartbeat ON task_runs(heartbeat_at) WHERE status = 'RUNNING';
CREATE INDEX idx_task_runs_task_workflow ON task_runs(task_id, workflow_id);

-- =============================================================================
-- 6. ARTIFACTS TABLE
-- Purpose: Store task outputs separately (future: object storage)
-- =============================================================================
CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    task_run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'text/plain',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_artifacts_task_run_id ON artifacts(task_run_id);

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workflows_updated_at
    BEFORE UPDATE ON workflows
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- INITIAL DATA VALIDATION
-- =============================================================================

COMMENT ON TABLE workflows IS 'Workflow definitions from YAML files';
COMMENT ON TABLE runs IS 'Workflow execution instances';
COMMENT ON TABLE tasks IS 'Task definitions within workflows';
COMMENT ON TABLE dependencies IS 'DAG edges defining task dependencies';
COMMENT ON TABLE task_runs IS 'Individual task execution instances - THE STATE MACHINE';
COMMENT ON TABLE artifacts IS 'Task output storage';

DO $$
BEGIN
    ASSERT (SELECT COUNT(*) FROM information_schema.tables 
            WHERE table_name IN ('workflows', 'runs', 'tasks', 'dependencies', 'task_runs', 'artifacts')) = 6,
        'All 6 tables must be created';
    
    RAISE NOTICE 'Schema initialized successfully';
END $$;
```

---

### 4. Create `postgres/init.sql`

**File: `relay/infra/postgres/init.sql`**

```sql
-- This file runs before migrations on first container startup
-- Currently empty - all schema in migrations/001_init.sql

SELECT 'Relay database initialization starting...' as message;
```

---

### 5. Create `redis/redis.conf`

**File: `relay/infra/redis/redis.conf`**

```conf
# Redis configuration for Relay job queue

# Networking
bind 0.0.0.0
port 6379

# Memory
maxmemory 256mb
maxmemory-policy noeviction

# Persistence - DISABLED for dev (jobs are ephemeral)
save ""
appendonly no

# Performance
tcp-backlog 511
timeout 0
tcp-keepalive 300

# Logging
loglevel notice
logfile ""

# Security (no password in dev)
protected-mode no
```

---

### 6. Create `test_infra.sh`

**File: `relay/infra/test_infra.sh`**

```bash
#!/bin/bash
# Test script for infrastructure layer

set -e

echo "=========================================="
echo "Relay Infrastructure Test"
echo "=========================================="
echo ""

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

cd "$(dirname "$0")"

echo "Step 1: Starting Docker services..."
docker-compose up -d

echo ""
echo "Step 2: Waiting for PostgreSQL..."
until docker-compose exec -T postgres pg_isready -U relay > /dev/null 2>&1; do
    echo -n "."
    sleep 1
done
echo -e "${GREEN}✓ PostgreSQL ready${NC}"

echo ""
echo "Step 3: Waiting for Redis..."
until docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; do
    echo -n "."
    sleep 1
done
echo -e "${GREEN}✓ Redis ready${NC}"

echo ""
echo "Step 4: Verifying database schema..."
TABLES=$(docker-compose exec -T postgres psql -U relay -d relay -t -c "
    SELECT COUNT(*) FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name IN ('workflows', 'runs', 'tasks', 'dependencies', 'task_runs', 'artifacts');
")

if [ "$(echo $TABLES | tr -d ' ')" = "6" ]; then
    echo -e "${GREEN}✓ All 6 tables created${NC}"
else
    echo -e "${RED}✗ Expected 6 tables, found: $TABLES${NC}"
    exit 1
fi

echo ""
echo "Step 5: Testing table structure..."
for table in workflows runs tasks dependencies task_runs artifacts; do
    COUNT=$(docker-compose exec -T postgres psql -U relay -d relay -t -c "
        SELECT COUNT(*) FROM information_schema.columns WHERE table_name = '$table';
    ")
    echo "  - $table: $(echo $COUNT | tr -d ' ') columns"
done

echo ""
echo "Step 6: Testing Redis connection..."
PONG=$(docker-compose exec -T redis redis-cli ping)
if [ "$PONG" = "PONG" ]; then
    echo -e "${GREEN}✓ Redis responding${NC}"
else
    echo -e "${RED}✗ Redis not responding${NC}"
    exit 1
fi

echo ""
echo "Step 7: Testing Redis queue operations..."
docker-compose exec -T redis redis-cli LPUSH test_queue '{"test": "data"}' > /dev/null
ITEM=$(docker-compose exec -T redis redis-cli RPOP test_queue)
if [[ "$ITEM" == *"test"* ]]; then
    echo -e "${GREEN}✓ Redis queue working${NC}"
else
    echo -e "${RED}✗ Redis queue failed${NC}"
    exit 1
fi

echo ""
echo "Step 8: Creating test data..."
docker-compose exec -T postgres psql -U relay -d relay <<EOF
INSERT INTO workflows (id, name, definition) 
VALUES (
    'test_workflow',
    'Test Workflow',
    '{"name": "Test", "tasks": []}'::jsonb
);

SELECT COUNT(*) as workflow_count FROM workflows WHERE id = 'test_workflow';
EOF

echo ""
echo "Step 9: Cleaning up test data..."
docker-compose exec -T postgres psql -U relay -d relay -c "DELETE FROM workflows WHERE id = 'test_workflow';" > /dev/null

echo ""
echo "=========================================="
echo -e "${GREEN}✓ All infrastructure tests passed!${NC}"
echo "=========================================="
echo ""
echo "Services running:"
echo "  PostgreSQL: localhost:5432"
echo "  Redis:      localhost:6379"
echo ""
echo "Connect to PostgreSQL:"
echo "  docker-compose exec postgres psql -U relay -d relay"
echo ""
echo "Connect to Redis:"
echo "  docker-compose exec redis redis-cli"
echo ""
echo "Stop services:"
echo "  docker-compose down"
echo ""
```

**After creating this file, make it executable:**

```bash
chmod +x relay/infra/test_infra.sh
```

---

## Commands to Run

### First Time Setup

```bash
# 1. Navigate to the infra directory
cd relay/infra

# 2. Start the services
docker-compose up -d

# 3. Run the test script
./test_infra.sh
```

### Expected Output

If everything works, you'll see:

```
==========================================
Relay Infrastructure Test
==========================================

Step 1: Starting Docker services...
Step 2: Waiting for PostgreSQL...
✓ PostgreSQL ready

Step 3: Waiting for Redis...
✓ Redis ready

Step 4: Verifying database schema...
✓ All 6 tables created

Step 5: Testing table structure...
  - workflows: 5 columns
  - runs: 6 columns
  - tasks: 5 columns
  - dependencies: 4 columns
  - task_runs: 13 columns
  - artifacts: 5 columns

Step 6: Testing Redis connection...
✓ Redis responding

Step 7: Testing Redis queue operations...
✓ Redis queue working

Step 8: Creating test data...
Step 9: Cleaning up test data...

==========================================
✓ All infrastructure tests passed!
==========================================

Services running:
  PostgreSQL: localhost:5432
  Redis:      localhost:6379
```

---

## Useful Commands

### View running containers
```bash
docker-compose ps
```

### View logs
```bash
docker-compose logs -f postgres
docker-compose logs -f redis
```

### Connect to PostgreSQL
```bash
docker-compose exec postgres psql -U relay -d relay
```

### Connect to Redis
```bash
docker-compose exec redis redis-cli
```

### View tables in database
```bash
docker-compose exec postgres psql -U relay -d relay -c "\dt"
```

### Stop services
```bash
docker-compose down
```

### Stop and remove data
```bash
docker-compose down -v
```

---

## Troubleshooting

### Port 5432 already in use
```bash
# Check what's using the port
lsof -i :5432

# Or change the port in docker-compose.yml
ports:
  - "5433:5432"  # Use 5433 on your host instead
```

### Permission denied on test_infra.sh
```bash
chmod +x test_infra.sh
```

### Docker not running
```bash
# Start Docker Desktop (on Mac/Windows)
# Or start Docker daemon (on Linux)
sudo systemctl start docker
```

---

## Next Steps

Once `./test_infra.sh` passes all tests, we'll move to **Step 2: Shared Packages**

This will include:
- TypeScript type definitions
- DAG algorithms
- State machine logic
- All pure functions (no database or network calls)
