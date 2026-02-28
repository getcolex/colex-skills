#!/bin/bash
# gemini_query.sh - Invoke Gemini CLI and extract the response text
# Usage: ./gemini_query.sh "prompt" [--yolo] [--all-files] [--model MODEL]
# Returns: Just the response text (or error message with non-zero exit)

set -euo pipefail

PROMPT=""
EXTRA_FLAGS=("-m" "gemini-3-pro-preview")

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yolo|-y) EXTRA_FLAGS+=("-y"); shift ;;
    --yolo-sandbox|-s) EXTRA_FLAGS+=("-y" "-s"); shift ;;
    --model|-m) EXTRA_FLAGS+=("-m" "$2"); shift 2 ;;
    *) PROMPT="$1"; shift ;;
  esac
done

if [[ -z "$PROMPT" ]]; then
  echo "Error: No prompt provided" >&2
  exit 1
fi

if ! command -v gemini &>/dev/null; then
  echo "Error: gemini CLI not found. Install with: npm install -g @google/gemini-cli" >&2
  exit 1
fi

OUTPUT=$(gemini ${EXTRA_FLAGS[@]+"${EXTRA_FLAGS[@]}"} -p "$PROMPT" --output-format json 2>/dev/null)
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  ERROR=$(echo "$OUTPUT" | jq -r '.error.message // "Unknown error"' 2>/dev/null || echo "Gemini CLI failed with exit code $EXIT_CODE")
  echo "Error: $ERROR" >&2
  exit $EXIT_CODE
fi

RESPONSE=$(echo "$OUTPUT" | jq -r '.response // empty' 2>/dev/null)

if [[ -z "$RESPONSE" ]]; then
  ERROR=$(echo "$OUTPUT" | jq -r '.error.message // "No response received"' 2>/dev/null)
  echo "Error: $ERROR" >&2
  exit 1
fi

echo "$RESPONSE"
