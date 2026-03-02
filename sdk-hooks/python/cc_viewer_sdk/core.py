"""
Core functionality for CC-Viewer SDK integration.
"""

import atexit
import json
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
_sdk_patched = False


class CCViewerContext:
    """
    Context object for CC-Viewer SDK integration.

    Holds the active proxy configuration and provides cleanup.
    """

    def __init__(self, proxy_port: int, proxy_process: Optional[subprocess.Popen] = None):
        self.proxy_port = proxy_port
        self.proxy_process = proxy_process
        self._enabled = True
        self._original_build_command = None

    @property
    def proxy_url(self) -> str:
        """The proxy URL to use for ANTHROPIC_BASE_URL."""
        return f"http://127.0.0.1:{self.proxy_port}"

    def disable(self) -> None:
        """Disable CC-Viewer interception and stop the proxy."""
        global _sdk_patched

        if not self._enabled:
            return

        # Restore original SDK _build_command if we patched it
        if self._original_build_command is not None:
            try:
                from claude_agent_sdk._internal.transport.subprocess_cli import SubprocessCLITransport
                SubprocessCLITransport._build_command = self._original_build_command
                logger.debug("Restored original SubprocessCLITransport._build_command")
            except Exception as e:
                logger.debug(f"Failed to restore _build_command: {e}")

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
        _sdk_patched = False

    def __enter__(self) -> "CCViewerContext":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.disable()


def _patch_sdk_build_command(proxy_url: str, context: CCViewerContext) -> None:
    """
    Patch SubprocessCLITransport._build_command to inject --settings with proxy URL.

    This is necessary because the Claude Code CLI doesn't read ANTHROPIC_BASE_URL
    from environment variables - it only accepts it via --settings parameter.
    """
    global _sdk_patched

    if _sdk_patched:
        return

    try:
        from claude_agent_sdk._internal.transport.subprocess_cli import SubprocessCLITransport

        original_build_command = SubprocessCLITransport._build_command
        context._original_build_command = original_build_command

        def patched_build_command(self) -> list:
            """Patched _build_command that injects proxy settings."""
            cmd = original_build_command(self)

            # Build settings JSON with proxy URL
            settings_json = json.dumps({
                "env": {
                    "ANTHROPIC_BASE_URL": proxy_url
                }
            })

            # Insert --settings before other args (after the CLI path)
            # cmd[0] is the CLI path, so we insert after it
            cmd.insert(1, "--settings")
            cmd.insert(2, settings_json)

            logger.debug(f"Injected --settings with proxy URL: {proxy_url}")
            return cmd

        SubprocessCLITransport._build_command = patched_build_command
        _sdk_patched = True
        logger.debug("Patched SubprocessCLITransport._build_command")

    except ImportError:
        logger.warning("Could not import SubprocessCLITransport - SDK patching failed")
    except Exception as e:
        logger.warning(f"Failed to patch SDK: {e}")


def enable_cc_viewer(
    log_dir: Optional[Path | str] = None,
    proxy_port: Optional[int] = None,
    start_viewer: bool = False,
    ccv_path: Optional[str] = None,
    remote: bool = False,
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
        remote: Enable remote access by binding to 0.0.0.0 (default: False)

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

    # Set remote host if enabled
    if remote:
        os.environ["CC_VIEWER_HOST"] = "0.0.0.0"
        logger.info("Remote access enabled, binding to 0.0.0.0")

    # Start proxy
    proxy_manager = ProxyManager(ccv_path)
    proxy_port, proxy_process = proxy_manager.start(port=proxy_port)

    # Create context
    _context = CCViewerContext(proxy_port=proxy_port, proxy_process=proxy_process)

    # Save original ANTHROPIC_BASE_URL
    _context._original_base_url = os.environ.get("ANTHROPIC_BASE_URL")

    # Set environment variable for SDK to pick up (also useful as a signal)
    os.environ["ANTHROPIC_BASE_URL"] = _context.proxy_url
    os.environ["CC_VIEWER_ENABLED"] = "true"

    # Patch SDK to inject --settings parameter
    _patch_sdk_build_command(_context.proxy_url, _context)

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
