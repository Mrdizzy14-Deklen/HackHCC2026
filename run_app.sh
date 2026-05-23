#!/usr/bin/env bash
# Start the HackHCC composer app
# Usage: ./run_app.sh [port]
set -e
PORT=${1:-5000}
cd "$(dirname "$0")"
echo "Starting HackHCC Composer on http://127.0.0.1:$PORT"
venv/bin/uvicorn composer-app.app:app --reload --port "$PORT"
