#!/usr/bin/env python3
"""
Debug test to trace proxy behavior.
"""

import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from cc_viewer_sdk.utils import find_ccv_path


def debug_proxy():
    """Start proxy and print all output."""
    print("=" * 60)
    print("Debug: Starting proxy with verbose output")
    print("=" * 60)

    ccv_path = find_ccv_path()
    if ccv_path:
        print(f"ccv path: {ccv_path}")
    else:
        cli_js = Path(__file__).parent.parent.parent.parent / "cli.js"
        if cli_js.exists():
            ccv_path = f"node {cli_js}"
            print(f"Using local cli.js: {cli_js}")
        else:
            print("ERROR: ccv not found")
            return

    env = os.environ.copy()
    env["CC_VIEWER_ORIGINAL_BASE_URL"] = "https://api.anthropic.com"
    env["CC_VIEWER_PROJECT_CWD"] = os.getcwd()

    print(f"Environment:")
    print(f"  CC_VIEWER_ORIGINAL_BASE_URL: {env.get('CC_VIEWER_ORIGINAL_BASE_URL')}")
    print(f"  CC_VIEWER_PROJECT_CWD: {env.get('CC_VIEWER_PROJECT_CWD')}")
    print()

    cmd = ccv_path.split() + ["proxy"]
    print(f"Command: {' '.join(cmd)}")
    print()

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
        bufsize=1,
    )

    # Read port
    print("Waiting for port...")
    port_line = proc.stdout.readline()
    print(f"Port line: {repr(port_line)}")

    if port_line.strip().isdigit():
        port = int(port_line.strip())
        print(f"Proxy port: {port}")

    # Read stderr in a loop for a few seconds
    print("\nReading stderr for 3 seconds...")
    import select
    start = time.time()
    while time.time() - start < 3:
        if select.select([proc.stderr], [], [], 0.5)[0]:
            line = proc.stderr.readline()
            if line:
                print(f"STDERR: {line.rstrip()}")

        # Check if process is still alive
        if proc.poll() is not None:
            print(f"Process exited with code: {proc.returncode}")
            break

    # Send a test request
    print("\nSending test request to proxy...")
    import urllib.request
    import json

    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/v1/messages",
        data=json.dumps({
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 10,
            "messages": [{"role": "user", "content": "hi"}]
        }).encode(),
        headers={
            "Content-Type": "application/json",
            "x-api-key": os.environ.get("ANTHROPIC_API_KEY", "test"),
            "anthropic-version": "2023-06-01"
        }
    )

    try:
        resp = urllib.request.urlopen(req, timeout=10)
        print(f"Response status: {resp.status}")
        print(f"Response: {resp.read().decode()[:200]}")
    except urllib.error.HTTPError as e:
        print(f"HTTP Error: {e.code}")
        print(f"Response: {e.read().decode()[:500]}")
    except Exception as e:
        print(f"Error: {e}")

    # Read more stderr
    print("\nReading more stderr...")
    while select.select([proc.stderr], [], [], 0.5)[0]:
        line = proc.stderr.readline()
        if line:
            print(f"STDERR: {line.rstrip()}")
        else:
            break

    # Check log files
    print("\nChecking log files...")
    log_dir = Path.home() / ".claude" / "cc-viewer"
    project_name = Path(env["CC_VIEWER_PROJECT_CWD"]).name
    import re
    safe_project_name = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', project_name) if project_name else "unknown"
    project_dir = log_dir / safe_project_name

    print(f"Log directory: {log_dir}")
    print(f"Project directory: {project_dir}")

    if log_dir.exists():
        all_logs = list(log_dir.rglob("*.jsonl"))
        print(f"Total log files: {len(all_logs)}")
        for log in sorted(all_logs, key=lambda p: p.stat().st_mtime, reverse=True)[:5]:
            mtime = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(log.stat().st_mtime))
            print(f"  {log.name} ({mtime})")

    # Cleanup
    print("\nStopping proxy...")
    proc.terminate()
    proc.wait(timeout=5)
    print("Done.")


if __name__ == "__main__":
    debug_proxy()
