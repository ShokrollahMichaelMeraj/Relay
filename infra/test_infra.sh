#!/bin/bash
# Test script for infrastructure layer

set -e

echo "=========================================="
echo "Relay Infrastructure Test"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Change to infra directory
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

# Test each table
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
-- Insert test workflow
INSERT INTO workflows (id, name, definition) 
VALUES (
    'test_workflow',
    'Test Workflow',
    '{"name": "Test", "tasks": []}'::jsonb
);

-- Verify insertion
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
