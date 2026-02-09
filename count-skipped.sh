#!/usr/bin/env bash
#
# Count skipped/flaky tests in wix-data-client and POST to the dashboard webhook.
#
# Usage:
#   ./count-skipped.sh <path-to-wix-data-client-repo> [webhook-url]
#
# Examples:
#   ./count-skipped.sh ../wix-data-client
#   ./count-skipped.sh ../wix-data-client https://my-dashboard.example.com/api/webhook
#
# In GitHub Actions:
#   ./count-skipped.sh . ${{ secrets.DASHBOARD_WEBHOOK_URL }}

set -euo pipefail

REPO_PATH="${1:?Usage: $0 <path-to-repo> [webhook-url]}"
WEBHOOK_URL="${2:-http://localhost:3000/api/webhook}"

# Resolve the branch name
if [ -n "${GITHUB_REF_NAME:-}" ]; then
  BRANCH="$GITHUB_REF_NAME"
else
  BRANCH=$(git -C "$REPO_PATH" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
fi

DATE=$(date +%Y-%m-%d)

# Count skipped tests: it.skip, test.skip, describe.skip, it.flaky, test.flaky, describe.flaky
SKIPPED_COUNT=$(grep -rE '\b(it|test|describe)\.(skip|flaky)\b' "$REPO_PATH" \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -l 2>/dev/null | xargs grep -cE '\b(it|test|describe)\.(skip|flaky)\b' 2>/dev/null \
  | awk -F: '{s+=$NF} END {print s+0}')

# Count total test definitions: it(, test(, describe(
TOTAL_TESTS=$(grep -rE '\b(it|test|describe)\s*\(' "$REPO_PATH" \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -l 2>/dev/null | xargs grep -cE '\b(it|test|describe)\s*\(' 2>/dev/null \
  | awk -F: '{s+=$NF} END {print s+0}')

echo "Date:          $DATE"
echo "Branch:        $BRANCH"
echo "Total tests:   $TOTAL_TESTS"
echo "Skipped/flaky: $SKIPPED_COUNT"
echo "Webhook:       $WEBHOOK_URL"
echo ""

PAYLOAD=$(cat <<EOF
{
  "date": "$DATE",
  "repo": "wix-data-client",
  "branch": "$BRANCH",
  "total_tests": $TOTAL_TESTS,
  "skipped_count": $SKIPPED_COUNT
}
EOF
)

echo "Payload: $PAYLOAD"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -1)

if [ "$HTTP_CODE" -eq 200 ]; then
  echo "OK — $BODY"
else
  echo "FAILED (HTTP $HTTP_CODE) — $BODY" >&2
  exit 1
fi
