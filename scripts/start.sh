#!/bin/bash

# SmartGate one-click local startup

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}Starting SmartGate...${NC}"

if [ ! -f .env ]; then
    echo -e "${YELLOW}No .env found; creating defaults...${NC}"
    cat > .env <<'EOF'
ADMIN_TOKEN=admin123
ADDR=127.0.0.1:18765
DATABASE_URL=sqlite://smartgate.db?mode=rwc
EOF
    echo -e "${GREEN}Created .env (ADMIN_TOKEN=admin123, port 18765).${NC}"
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

echo -e "${BLUE}Starting backend (Rust)...${NC}"
cargo run &
BACKEND_PID=$!

if [ -d "web" ]; then
    (
        cd web || exit 1
        if [ ! -d "node_modules" ]; then
            echo -e "${YELLOW}Installing frontend dependencies...${NC}"
            npm install > /dev/null 2>&1
        fi
        echo -e "${BLUE}Admin UI: http://localhost:18764${NC}"
        npm run dev
    ) &
    FRONTEND_PID=$!
else
    FRONTEND_PID=""
fi

cleanup() {
    echo -e "${YELLOW}Stopping SmartGate...${NC}"
    kill "$BACKEND_PID" 2>/dev/null
    [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
    exit 0
}
trap cleanup INT TERM

wait
