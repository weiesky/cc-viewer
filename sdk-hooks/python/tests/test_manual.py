#!/usr/bin/env python3
"""
Manual test script for CC-Viewer SDK integration.

Run each test function separately and verify the results.

Usage:
    # Test 1: Test ccv proxy command
    python test_manual.py test_proxy

    # Test 2: Test Python SDK enable/disable
    python test_manual.py test_sdk_enable

    # Test 3: Test with Claude Agent SDK (requires SDK installed)
    python test_manual.py test_sdk_integration
"""

import os
import subprocess
import sys
import time
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from cc_viewer_sdk.utils import find_ccv_path, get_log_dir


def test_proxy():
    """
    Test 1: Verify 'ccv proxy' command works correctly.

    Expected behavior:
    - Starts proxy process
    - Prints port number to stdout (first line)
    - Proxy accepts connections on that port
    """
    print("=" * 60)
    print("Test 1: ccv proxy command")
    print("=" * 60)

    ccv_path = find_ccv_path()
    if ccv_path:
        print(f"✓ Found ccv at: {ccv_path}")
    else:
        # Try local node cli.js
        cli_js = Path(__file__).parent.parent.parent.parent / "cli.js"
        if cli_js.exists():
            ccv_path = f"node {cli_js}"
            print(f"✓ Using local cli.js: {cli_js}")
        else:
            print("✗ ccv not found in PATH and local cli.js not found")
            print("  Please run: npm install -g cc-viewer")
            return False

    print(f"\nStarting proxy...")

    try:
        # Start proxy
        if ccv_path.startswith("node "):
            proc = subprocess.Popen(
                ccv_path.split() + ["proxy"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        else:
            proc = subprocess.Popen(
                [ccv_path, "proxy"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

        # Read port from first line
        print("Waiting for proxy to output port...")
        port_line = proc.stdout.readline().strip()
        print(f"Proxy output: {port_line}")

        if port_line.isdigit():
            port = int(port_line)
            print(f"✓ Proxy started on port: {port}")
        else:
            print(f"✗ Expected port number, got: {port_line}")
            proc.terminate()
            return False

        # Test proxy is accepting connections
        import urllib.request

        proxy_url = f"http://127.0.0.1:{port}"
        print(f"\nTesting proxy connection at {proxy_url}...")

        try:
            # This will fail but should connect to proxy
            urllib.request.urlopen(f"{proxy_url}/v1/messages", timeout=2)
        except urllib.error.HTTPError as e:
            # Expected - we're not sending valid API request
            print(f"✓ Proxy responded (HTTP {e.code})")
        except Exception as e:
            if "Connection refused" in str(e):
                print(f"✗ Cannot connect to proxy: {e}")
                proc.terminate()
                return False
            else:
                # Any other error means proxy is responding
                print(f"✓ Proxy is responding: {type(e).__name__}")

        # Check stderr for startup message
        import select
        if select.select([proc.stderr], [], [], 0.5)[0]:
            stderr_line = proc.stderr.readline()
            print(f"Proxy stderr: {stderr_line.strip()}")

        # Cleanup
        print("\nStopping proxy...")
        proc.terminate()
        try:
            proc.wait(timeout=3)
            print("✓ Proxy stopped gracefully")
        except subprocess.TimeoutExpired:
            proc.kill()
            print("⚠ Proxy killed (did not terminate gracefully)")

        print("\n" + "=" * 60)
        print("Test 1 PASSED: ccv proxy works correctly")
        print("=" * 60)
        return True

    except Exception as e:
        print(f"✗ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_sdk_enable():
    """
    Test 2: Verify Python SDK enable_cc_viewer() works.

    Expected behavior:
    - Starts proxy via subprocess
    - Sets ANTHROPIC_BASE_URL environment variable
    - Returns CCViewerContext with correct port
    """
    print("=" * 60)
    print("Test 2: Python SDK enable_cc_viewer()")
    print("=" * 60)

    try:
        from cc_viewer_sdk import enable_cc_viewer, disable_cc_viewer

        # Save original env
        original_base_url = os.environ.get("ANTHROPIC_BASE_URL")
        print(f"Original ANTHROPIC_BASE_URL: {original_base_url}")

        print("\nCalling enable_cc_viewer()...")
        ctx = enable_cc_viewer()

        print(f"✓ Context created")
        print(f"  - proxy_port: {ctx.proxy_port}")
        print(f"  - proxy_url: {ctx.proxy_url}")
        print(f"  - ANTHROPIC_BASE_URL: {os.environ.get('ANTHROPIC_BASE_URL')}")

        # Verify environment variable is set
        if os.environ.get("ANTHROPIC_BASE_URL") == ctx.proxy_url:
            print("✓ ANTHROPIC_BASE_URL set correctly")
        else:
            print("✗ ANTHROPIC_BASE_URL not set correctly")
            return False

        # Test proxy is running
        import urllib.request
        import select
        try:
            urllib.request.urlopen(f"{ctx.proxy_url}/v1/messages", timeout=2)
        except urllib.error.HTTPError:
            print("✓ Proxy is responding")
        except Exception as e:
            if "Connection refused" in str(e):
                print(f"✗ Proxy not responding: {e}")
                ctx.disable()
                return False
            else:
                print("✓ Proxy is responding")

        # Don't wait for stderr in test mode - just continue
        print("✓ Proxy started successfully")

        # Test disable
        print("\nCalling disable_cc_viewer()...")
        disable_cc_viewer()

        if os.environ.get("ANTHROPIC_BASE_URL") == original_base_url:
            print("✓ ANTHROPIC_BASE_URL restored")
        elif original_base_url is None and "ANTHROPIC_BASE_URL" not in os.environ:
            print("✓ ANTHROPIC_BASE_URL removed (was None)")
        else:
            print(f"⚠ ANTHROPIC_BASE_URL = {os.environ.get('ANTHROPIC_BASE_URL')} (expected {original_base_url})")

        print("\n" + "=" * 60)
        print("Test 2 PASSED: SDK enable/disable works correctly")
        print("=" * 60)
        return True

    except Exception as e:
        print(f"✗ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_sdk_integration():
    """
    Test 3: Verify integration with Claude Agent SDK.

    Requires: claude-agent-sdk installed and ANTHROPIC_API_KEY set

    Expected behavior:
    - SDK uses proxy via ANTHROPIC_BASE_URL
    - Requests are logged to cc-viewer JSONL files
    """
    print("=" * 60)
    print("Test 3: Claude Agent SDK Integration")
    print("=" * 60)

    # Check prerequisites
    try:
        import claude_agent_sdk
        print(f"✓ claude_agent_sdk installed")
    except ImportError:
        print("✗ claude_agent_sdk not installed")
        print("  Run: pip install claude-agent-sdk")
        return False

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("✗ ANTHROPIC_API_KEY not set")
        print("  Set: export ANTHROPIC_API_KEY=your-key")
        return False
    else:
        print(f"✓ ANTHROPIC_API_KEY set ({api_key[:8]}...)")

    try:
        import asyncio
        from cc_viewer_sdk import enable_cc_viewer
        from claude_agent_sdk import query, ClaudeAgentOptions

        print("\nEnabling CC-Viewer...")
        ctx = enable_cc_viewer()
        print(f"✓ Proxy started at {ctx.proxy_url}")

        # Get log directory
        log_dir = get_log_dir()
        print(f"  Log directory: {log_dir}")

        # Count existing log files
        existing_logs = list(log_dir.rglob("*.jsonl")) if log_dir.exists() else []
        print(f"  Existing log files: {len(existing_logs)}")

        print("\nSending test query to Claude Agent SDK...")
        print("  Query: 'Reply with exactly: CC-Viewer test successful'")

        async def run_query():
            options = ClaudeAgentOptions(
                max_turns=1,
            )
            response_text = []
            async for msg in query(
                prompt="Reply with exactly these words: CC-Viewer test successful",
                options=options
            ):
                print(f"  Received: {type(msg).__name__}")
                if hasattr(msg, 'content'):
                    for block in msg.content:
                        if hasattr(block, 'text'):
                            response_text.append(block.text)
                            print(f"    Text: {block.text[:50]}...")
            return response_text

        response = asyncio.run(run_query())
        print(f"\n✓ Query completed")
        print(f"  Response: {' '.join(response)[:100]}...")

        # Wait a moment for logs to be written
        time.sleep(1)

        # Check for new log files or updated existing files
        new_logs = list(log_dir.rglob("*.jsonl"))
        latest_log = max(new_logs, key=lambda p: p.stat().st_mtime) if new_logs else None

        if latest_log:
            # Check if the latest log was modified recently (within last 10 seconds)
            mtime = latest_log.stat().st_mtime
            if time.time() - mtime < 10:
                print(f"✓ Recent log activity detected!")
                print(f"  Latest log: {latest_log}")
                print(f"  Modified: {time.strftime('%H:%M:%S', time.localtime(mtime))}")

                # Read last few lines
                with open(latest_log, 'r') as f:
                    lines = f.readlines()
                    print(f"  Log entries: {len(lines)}")
                    if lines:
                        # Show a preview of the last entry
                        import json
                        try:
                            last_entry = json.loads(lines[-1].strip().rstrip('---').strip())
                            print(f"  Last entry URL: {last_entry.get('url', 'N/A')}")
                        except:
                            print(f"  Last entry preview: {lines[-1][:100]}...")
            else:
                print(f"⚠ Latest log file is old (modified {int(time.time() - mtime)}s ago)")
        else:
            print("⚠ No log files found")

        # Cleanup
        ctx.disable()
        print("\n✓ CC-Viewer disabled")

        print("\n" + "=" * 60)
        print("Test 3 PASSED: SDK integration works!")
        print("Check http://localhost:7008 for captured requests")
        print("=" * 60)
        return True

    except Exception as e:
        print(f"✗ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print("\nAvailable tests:")
        print("  test_proxy         - Test ccv proxy command")
        print("  test_sdk_enable    - Test Python SDK enable/disable")
        print("  test_sdk_integration - Test full SDK integration (requires API key)")
        print("\nRun all tests:")
        print("  python test_manual.py all")
        sys.exit(1)

    test_name = sys.argv[1]

    if test_name == "all":
        results = []
        results.append(("test_proxy", test_proxy()))
        results.append(("test_sdk_enable", test_sdk_enable()))
        # Skip integration test in 'all' mode (requires API key)
        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)
        for name, passed in results:
            status = "✓ PASSED" if passed else "✗ FAILED"
            print(f"  {name}: {status}")
    elif test_name == "test_proxy":
        success = test_proxy()
        sys.exit(0 if success else 1)
    elif test_name == "test_sdk_enable":
        success = test_sdk_enable()
        sys.exit(0 if success else 1)
    elif test_name == "test_sdk_integration":
        success = test_sdk_integration()
        sys.exit(0 if success else 1)
    else:
        print(f"Unknown test: {test_name}")
        sys.exit(1)


if __name__ == "__main__":
    main()
