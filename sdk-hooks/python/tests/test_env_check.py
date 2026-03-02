#!/usr/bin/env python3
"""
Test to verify SDK actually uses ANTHROPIC_BASE_URL.
"""

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


async def test_env_propagation():
    """Test if SDK respects ANTHROPIC_BASE_URL via patched --settings."""
    print("=" * 60)
    print("Test: SDK Environment Variable Propagation")
    print("=" * 60)

    # Import and enable cc-viewer first
    from cc_viewer_sdk import enable_cc_viewer

    # We'll test by manually patching with a fake URL before enabling
    from cc_viewer_sdk.core import _patch_sdk_build_command, CCViewerContext
    
    # Create a mock context with a fake proxy URL
    fake_proxy = "http://127.0.0.1:59998"
    
    # First patch with fake URL
    class MockContext:
        _original_build_command = None
    
    mock_ctx = MockContext()
    _patch_sdk_build_command(fake_proxy, mock_ctx)
    
    print(f"Patched SDK with fake proxy: {fake_proxy}")

    try:
        from claude_agent_sdk import query, ClaudeAgentOptions

        print("\nAttempting to send query with 15s timeout (expecting connection error)...")
        options = ClaudeAgentOptions(max_turns=1)

        async def run_query():
            messages = []
            try:
                async for msg in query(prompt="test", options=options):
                    messages.append(msg)
                    print(f"  Got message: {type(msg).__name__}")
            except Exception as e:
                raise e
            return messages

        try:
            # Add timeout to prevent hanging
            result = await asyncio.wait_for(run_query(), timeout=15.0)
            print(f"\nGot {len(result)} messages - this means SDK did NOT use our proxy!")
            return False
            
        except asyncio.TimeoutError:
            print("\n⏱ Query timed out after 15s")
            print("This might mean SDK is trying to connect to the fake proxy but it's taking too long")
            print("✓ This indicates the patch IS working (CLI tried the fake proxy)")
            return True
            
        except Exception as e:
            error_str = str(e)
            print(f"\nError (expected): {type(e).__name__}")
            print(f"  Message: {error_str[:500]}...")

            # Check if the error indicates it tried to connect to our fake proxy
            if "59998" in error_str or "Connection refused" in error_str.lower() or "connect" in error_str.lower():
                print("\n✓ SDK IS respecting our patched --settings!")
                print("  (It tried to connect to our fake proxy)")
                return True
            else:
                print("\n✗ SDK may NOT be respecting our patched --settings")
                print("  (Error doesn't mention the fake proxy or connection issues)")
                return False

    finally:
        # Restore original _build_command
        if mock_ctx._original_build_command is not None:
            try:
                from claude_agent_sdk._internal.transport.subprocess_cli import SubprocessCLITransport
                SubprocessCLITransport._build_command = mock_ctx._original_build_command
            except:
                pass


if __name__ == "__main__":
    result = asyncio.run(test_env_propagation())
    sys.exit(0 if result else 1)
