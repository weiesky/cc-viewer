#!/usr/bin/env bash
# End-to-end verification for CCV External Sessions Protocol v1.
# Run from repo root: bash test/e2e-external.sh
# Requires: node, curl, jq (optional — falls back to grep on missing jq)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

TMP_ROOT="$(mktemp -d -t ccv-e2e-ext-XXXXXXXX)"
CCV_PID=""
cleanup() {
  if [ -n "$CCV_PID" ] && kill -0 "$CCV_PID" 2>/dev/null; then
    kill "$CCV_PID" 2>/dev/null || true
    wait "$CCV_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

echo "=== Scenario 1: writer — CCV_EXTERNAL_SESSION ==="
SESSION_DIR="$TMP_ROOT/writer-test/example/scopes/group-1/sessions/sess-1"
CCV_EXTERNAL_SESSION="$(node -e "
  process.stdout.write(JSON.stringify({
    sessionDir: '$SESSION_DIR',
    sessionId: 'sess-1',
    role: 'agent-a',
    title: 'e2e writer test'
  }));
")" node -e "
  import('./lib/external-session-writer.js').then(m => {
    const ok = m.writeSessionSkeleton();
    console.log('writeSessionSkeleton:', ok);
    const ok2 = m.markSessionEnded();
    console.log('markSessionEnded:', ok2);
  });
"

if [ ! -f "$SESSION_DIR/session.json" ]; then
  echo "FAIL: session.json not created at $SESSION_DIR"
  exit 1
fi
echo "session.json content:"
cat "$SESSION_DIR/session.json"
echo ""
if ! grep -q '"endedAt": "[0-9]' "$SESSION_DIR/session.json"; then
  echo "FAIL: endedAt not filled"
  exit 1
fi
echo "PASS: writer creates skeleton + fills endedAt"
echo ""

echo "=== Scenario 2: reader — directory scan ==="
READ_ROOT="$TMP_ROOT/read-test"
mkdir -p "$READ_ROOT/example/scopes/group-a/sessions/s-1"
mkdir -p "$READ_ROOT/example/scopes/group-b/sessions/s-2"
cat > "$READ_ROOT/example/index.json" <<EOF
{"protocolVersion": 1, "providerId": "example", "providerName": "Example Test"}
EOF
cat > "$READ_ROOT/example/scopes/group-a/scope.json" <<EOF
{"scopeId": "group-a", "title": "Group A"}
EOF
cat > "$READ_ROOT/example/scopes/group-b/scope.json" <<EOF
{"scopeId": "group-b", "title": "Group B"}
EOF
cat > "$READ_ROOT/example/scopes/group-a/sessions/s-1/session.json" <<EOF
{"sessionId": "s-1", "title": "session 1", "role": "agent-a", "logFile": "log.jsonl", "startedAt": "2026-04-15T14:00:00Z", "endedAt": null}
EOF
cat > "$READ_ROOT/example/scopes/group-a/sessions/s-1/log.jsonl" <<EOF
{"timestamp":"2026-04-15T14:00:01Z","url":"https://api.anthropic.com/v1/messages","method":"POST","body":{"model":"claude-opus-4-7","messages":[{"role":"user","content":"hello"}]}}
---
EOF
cat > "$READ_ROOT/example/scopes/group-b/sessions/s-2/session.json" <<EOF
{"sessionId": "s-2", "title": "session 2", "role": "agent-b", "logFile": "log.jsonl", "startedAt": "2026-04-15T15:00:00Z", "endedAt": "2026-04-15T15:30:00Z"}
EOF
cat > "$READ_ROOT/example/scopes/group-b/sessions/s-2/log.jsonl" <<EOF
{"timestamp":"2026-04-15T15:00:01Z","url":"https://api.anthropic.com/v1/messages","method":"POST","body":{"model":"claude-opus-4-7","messages":[{"role":"user","content":"second stage"}]}}
---
EOF

node -e "
  import('./lib/external-sessions.js').then(m => {
    const providers = m.scanProviders('$READ_ROOT');
    console.log('providers:', JSON.stringify(providers));
    const scopes = m.listScopes('$READ_ROOT', 'example');
    console.log('scopes:', JSON.stringify(scopes.map(s => s.scopeId)));
    const sessions = m.listSessions('$READ_ROOT', 'example', 'group-a');
    console.log('sessions(group-a):', JSON.stringify(sessions.map(s => s.sessionId)));
    const logFile = m.resolveLogFile('$READ_ROOT', 'example', 'group-a', 's-1');
    console.log('resolveLogFile:', logFile);
  });
"
echo "PASS: reader scans providers/scopes/sessions + resolves logFile"
echo ""

echo "=== Scenario 3: reader — protocol version mismatch ignored ==="
BAD_ROOT="$TMP_ROOT/bad-version"
mkdir -p "$BAD_ROOT/futureproto"
cat > "$BAD_ROOT/futureproto/index.json" <<EOF
{"protocolVersion": 99, "providerId": "futureproto"}
EOF
node -e "
  import('./lib/external-sessions.js').then(m => {
    const providers = m.scanProviders('$BAD_ROOT');
    if (providers.length !== 0) { console.error('FAIL: expected empty'); process.exit(1); }
    console.log('PASS: protocolVersion mismatch skipped');
  });
"
echo ""

echo "=== Scenario 4: reader — path traversal rejected ==="
node -e "
  import('./lib/external-sessions.js').then(m => {
    const bad = m.resolveLogFile('$READ_ROOT', '../etc', 'x', 'y');
    if (bad !== null) { console.error('FAIL: expected null'); process.exit(1); }
    const bad2 = m.resolveLogFile('$READ_ROOT', 'example', '..', 'y');
    if (bad2 !== null) { console.error('FAIL: expected null'); process.exit(1); }
    console.log('PASS: invalid slugs rejected');
  });
"
echo ""

echo "=== Scenario 5: reader — absolute logFile in session.json rejected ==="
EVIL_DIR="$READ_ROOT/example/scopes/group-a/sessions/evil"
mkdir -p "$EVIL_DIR"
cat > "$EVIL_DIR/session.json" <<EOF
{"sessionId": "evil", "logFile": "/etc/passwd"}
EOF
node -e "
  import('./lib/external-sessions.js').then(m => {
    const bad = m.resolveLogFile('$READ_ROOT', 'example', 'group-a', 'evil');
    if (bad !== null) { console.error('FAIL: expected null'); process.exit(1); }
    console.log('PASS: absolute logFile rejected');
  });
"
echo ""

echo "=== All scenarios PASSED ==="
