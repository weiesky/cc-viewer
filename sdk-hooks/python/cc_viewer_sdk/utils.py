"""
Utility functions for CC-Viewer SDK integration.
"""

import os
import shutil
from pathlib import Path
from typing import Optional


def get_log_dir() -> Path:
    """
    Get the CC-Viewer log directory.

    Returns:
        Path to ~/.claude/cc-viewer
    """
    return Path.home() / ".claude" / "cc-viewer"


def find_ccv_path() -> Optional[str]:
    """
    Find the ccv executable in PATH.

    Returns:
        Path to ccv or None if not found
    """
    return shutil.which("ccv")


def find_cc_viewer_package_dir() -> Optional[Path]:
    """
    Find the cc-viewer npm package directory.

    Returns:
        Path to cc-viewer package or None if not found
    """
    # Check common locations
    candidates = [
        # Global npm install
        Path("/usr/local/lib/node_modules/cc-viewer"),
        Path("/usr/lib/node_modules/cc-viewer"),
        # Homebrew on Apple Silicon
        Path("/opt/homebrew/lib/node_modules/cc-viewer"),
        # User's npm global
        Path.home() / ".npm-global/lib/node_modules/cc-viewer",
        # nvm locations
        Path.home() / ".nvm/versions/node/*/lib/node_modules/cc-viewer",
    ]

    for candidate in candidates:
        if "*" in str(candidate):
            # Handle glob patterns
            import glob
            matches = glob.glob(str(candidate))
            for match in matches:
                if Path(match).exists():
                    return Path(match)
        elif candidate.exists():
            return candidate

    return None


def is_sdk_available() -> bool:
    """
    Check if Claude Agent SDK is available.

    Returns:
        True if claude_agent_sdk can be imported
    """
    try:
        import claude_agent_sdk
        return True
    except ImportError:
        return False


def get_project_name() -> str:
    """
    Get the current project name from working directory.

    Returns:
        Project name (directory name, sanitized for filesystem)
    """
    cwd = Path.cwd()
    # Sanitize: replace non-alphanumeric chars with underscore
    name = cwd.name
    sanitized = "".join(c if c.isalnum() or c in "_-." else "_" for c in name)
    return sanitized or "unknown"


def generate_log_file_path() -> Path:
    """
    Generate a new log file path for the current session.

    Returns:
        Path to the new log file
    """
    from datetime import datetime

    log_dir = get_log_dir()
    project_name = get_project_name()

    # Create project subdirectory
    project_dir = log_dir / project_name
    project_dir.mkdir(parents=True, exist_ok=True)

    # Generate timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    # Create filename
    filename = f"{project_name}_{timestamp}.jsonl"

    return project_dir / filename
