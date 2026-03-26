#!/usr/bin/env bash
# Fake agent script for testing the executor.
# Usage: fake-agent.sh [--exit-code N] [--mode json|stream-json] [--sleep]
# Writes known JSON to stdout and exits with the given code.

EXIT_CODE=0
MODE="json"
DO_SLEEP=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --exit-code) EXIT_CODE="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --sleep) DO_SLEEP=1; shift ;;
    *) shift ;; # ignore unknown args (like the prompt)
  esac
done

if [ "$DO_SLEEP" -eq 1 ]; then
  sleep 30
fi

if [ "$MODE" = "stream-json" ]; then
  echo '{"type":"assistant","data":{"text":"Hello"}}'
  echo '{"type":"tool_use","data":{"tool":"write","file":"test.ts"}}'
  echo '{"type":"result","session_id":"fake-session-123","usage":{"input_tokens":100,"output_tokens":50}}'
elif [ "$MODE" = "json" ]; then
  cat <<'JSON'
{"session_id":"fake-session-123","result":"Hello, world!","usage":{"input_tokens":100,"output_tokens":50}}
JSON
fi

if [ "$EXIT_CODE" -ne 0 ]; then
  echo "Error: simulated failure" >&2
fi

exit "$EXIT_CODE"
