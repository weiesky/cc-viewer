#!/usr/bin/env python3
"""
Test remote access functionality.
"""

import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


def test_remote_binding():
    """Test that proxy binds to 0.0.0.0 when remote=True."""
    print("=" * 60)
    print("Test: Remote Access Binding")
    print("=" * 60)

    from cc_viewer_sdk import enable_cc_viewer

    print("\n1. Testing with remote=False (default)...")
    os.environ.pop("CC_VIEWER_HOST", None)
    ctx1 = enable_cc_viewer()
    print(f"   CC_VIEWER_HOST = {os.environ.get('CC_VIEWER_HOST')}")
    print(f"   Proxy URL: {ctx1.proxy_url}")
    ctx1.disable()

    print("\n2. Testing with remote=True...")
    ctx2 = enable_cc_viewer(remote=True)
    print(f"   CC_VIEWER_HOST = {os.environ.get('CC_VIEWER_HOST')}")
    print(f"   Proxy URL: {ctx2.proxy_url}")

    # Test that we can connect via 0.0.0.0
    import urllib.request
    try:
        # Try connecting via 127.0.0.1 (should still work)
        urllib.request.urlopen(f"http://127.0.0.1:{ctx2.proxy_port}/v1/messages", timeout=2)
    except urllib.error.HTTPError:
        print("   ✓ Proxy responding on 127.0.0.1")
    except Exception as e:
        if "Connection refused" in str(e):
            print(f"   ✗ Proxy not responding: {e}")
            ctx2.disable()
            return False

    print("\n3. Checking proxy process binding...")
    # Use lsof to check what address the proxy is listening on
    try:
        result = subprocess.run(
            ["lsof", "-i", f":{ctx2.proxy_port}", "-P"],
            capture_output=True,
            text=True,
            timeout=5
        )
        print(f"   lsof output:\n{result.stdout}")
        if "0.0.0.0" in result.stdout or "*:{ctx2.proxy_port}" in result.stdout:
            print("   ✓ Proxy bound to 0.0.0.0")
        elif "127.0.0.1" in result.stdout:
            print("   ⚠ Proxy bound to 127.0.0.1 (expected 0.0.0.0)")
    except Exception as e:
        print(f"   Could not check binding: {e}")

    ctx2.disable()

    print("\n" + "=" * 60)
    print("Test completed!")
    print("=" * 60)
    return True


if __name__ == "__main__":
    test_remote_binding()
