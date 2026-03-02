"""
Core functionality for CC-Viewer SDK integration.
"""

import atexit
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

from .proxy import ProxyManager
from .utils import get_log_dir, find_ccv_path

logger = logging.getLogger(__name__)

_context: Optional["CCViewerContext"] = None


class CCViewerContext:
    """
    Context object for CC-Viewer SDK integration.

    Holds the active proxy configuration and provides cleanup.
    """

    def __init__(self, proxy_port: int, proxy_process: Optional[subprocess.Popen] = None):
        self.proxy_port = proxy_port
        self.proxy_process = proxy_process
        self._enabled = True

    @property
    def proxy_url(self) -> str:
        """The proxy URL to use for ANTHROPIC_BASE_URL."""
        return f"http://127.0.0.1:{self.proxy_port}"

    def disable(self) -> None:
        """Disable CC-Viewer interception and stop the proxy."""
        if not self._enabled:
            return

        # Restore original ANTHROPIC_BASE_URL if we saved it
        if hasattr(self, "_original_base_url"):
            if self._original_base_url is None:
                os.environ.pop("ANTHROPIC_BASE_URL", None)
            else:
                os.environ["ANTHROPIC_BASE_URL"] = self._original_base_url

        # Stop proxy if we started it
        if self.proxy_process:
            try:
                self.proxy_process.terminate()
                self.proxy_process.wait(timeout=5)
            except Exception as e:
                logger.debug(f"Error stopping proxy: {e}")
                try:
                    self.proxy_process.kill()
                except Exception:
                    pass

        self._enabled = False

    def __enter__(self) -> "CCViewerContext":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.disable()


def enable_cc_viewer(
    log_dir: Optional[Path | str] = None,
    proxy_port: Optional[int] = None,
    start_viewer: bool = False,
    ccv_path: Optional[str] = None,
) -> CCViewerContext:
    """
    Enable CC-Viewer interception for Claude Agent SDK.

    This function:
    1. Starts the CC-Viewer proxy server
    2. Sets ANTHROPIC_BASE_URL environment variable to proxy URL
    3. Ensures cleanup on exit

    Args:
        log_dir: Custom log directory (default: ~/.claude/cc-viewer)
        proxy_port: Specific proxy port (default: auto-assign)
        start_viewer: Whether to start the web viewer server (not yet implemented)
        ccv_path: Path to ccv executable (default: auto-detect)

    Returns:
        CCViewerContext for cleanup and configuration

    Raises:
        RuntimeError: If ccv is not found or proxy fails to start

    Example:
        >>> from cc_viewer_sdk import enable_cc_viewer
        >>> ctx = enable_cc_viewer()
        >>> # Use Claude Agent SDK normally...
        >>> ctx.disable()  # Optional: explicit cleanup
    """
    global _context

    # Idempotent: if already enabled, return existing context
    if _context is not None and _context._enabled:
        logger.debug("CC-Viewer already enabled, returning existing context")
        return _context

    # Find ccv executable
    if ccv_path is None:
        ccv_path = find_ccv_path()
        if ccv_path is None:
            raise RuntimeError(
                "ccv (cc-viewer) not found in PATH. "
                "Please install cc-viewer: npm install -g cc-viewer"
            )

    # Start proxy
    proxy_manager = ProxyManager(ccv_path)
    proxy_port, proxy_process = proxy_manager.start(port=proxy_port)

    # Create context
    _context = CCViewerContext(proxy_port=proxy_port, proxy_process=proxy_process)

    # Save original ANTHROPIC_BASE_URL
    _context._original_base_url = os.environ.get("ANTHROPIC_BASE_URL")

    # Set environment variable for SDK to pick up
    os.environ["ANTHROPIC_BASE_URL"] = _context.proxy_url

    # Register cleanup on exit
    atexit.register(_cleanup_on_exit)

    logger.info(f"CC-Viewer enabled, proxy running at {_context.proxy_url}")

    # TODO: start web viewer if requested
    if start_viewer:
        logger.warning("start_viewer=True is not yet implemented")

    return _context


def disable_cc_viewer() -> None:
    """
    Disable CC-Viewer interception.

    Stops the proxy and restores the original ANTHROPIC_BASE_URL.
    """
    global _context
    if _context is not None:
        _context.disable()
        _context = None


def _cleanup_on_exit() -> None:
    """Internal cleanup handler for atexit."""
    global _context
    if _context is not None and _context._enabled:
        _context.disable()
