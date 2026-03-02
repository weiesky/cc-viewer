"""
CC-Viewer SDK Integration for Claude Agent SDK (Python)

Enables interception of API requests from Claude Agent SDK applications.

Usage:
    from cc_viewer_sdk import enable_cc_viewer
    enable_cc_viewer()

    # Then use Claude Agent SDK normally
    from claude_agent_sdk import query
    async for msg in query(prompt="Hello"):
        print(msg)
"""

__version__ = "0.1.0"

from .core import enable_cc_viewer, disable_cc_viewer, CCViewerContext

__all__ = ["enable_cc_viewer", "disable_cc_viewer", "CCViewerContext"]
