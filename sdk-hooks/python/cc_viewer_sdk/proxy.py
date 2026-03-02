"""
Proxy management for CC-Viewer SDK integration.
"""

import logging
import subprocess
import time
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


class ProxyManager:
    """
    Manages the CC-Viewer proxy subprocess.
    """

    def __init__(self, ccv_path: str):
        """
        Initialize ProxyManager.

        Args:
            ccv_path: Path to the ccv executable
        """
        self.ccv_path = ccv_path
        self._process: Optional[subprocess.Popen] = None

    def start(
        self, port: Optional[int] = None, timeout: float = 10.0
    ) -> Tuple[int, subprocess.Popen]:
        """
        Start the CC-Viewer proxy.

        Args:
            port: Optional specific port (default: auto-assign)
            timeout: Timeout in seconds to wait for proxy to start

        Returns:
            Tuple of (port, process)

        Raises:
            RuntimeError: If proxy fails to start
        """
        cmd = [self.ccv_path, "proxy"]

        if port is not None:
            cmd.extend(["--port", str(port)])

        # Start proxy process
        try:
            self._process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,  # Line buffered
            )
        except FileNotFoundError:
            raise RuntimeError(f"ccv not found at {self.ccv_path}")
        except Exception as e:
            raise RuntimeError(f"Failed to start proxy: {e}")

        # Read port from stdout (first line)
        try:
            # Wait for proxy to output port
            start_time = time.time()
            while time.time() - start_time < timeout:
                line = self._process.stdout.readline()
                if line:
                    line = line.strip()
                    if line.isdigit():
                        proxy_port = int(line)
                        logger.debug(f"Proxy started on port {proxy_port}")
                        return proxy_port, self._process
                    else:
                        # Non-numeric output might be an error
                        logger.warning(f"Unexpected proxy output: {line}")

                # Check if process died
                if self._process.poll() is not None:
                    stderr = self._process.stderr.read()
                    raise RuntimeError(f"Proxy process died: {stderr}")

                time.sleep(0.1)

            raise RuntimeError(f"Proxy did not output port within {timeout}s")

        except Exception as e:
            # Clean up on failure
            if self._process and self._process.poll() is None:
                self._process.terminate()
                try:
                    self._process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self._process.kill()
            raise RuntimeError(f"Failed to start proxy: {e}")

    def stop(self, timeout: float = 5.0) -> None:
        """
        Stop the proxy process.

        Args:
            timeout: Timeout in seconds for graceful shutdown
        """
        if self._process is None:
            return

        if self._process.poll() is not None:
            # Already dead
            self._process = None
            return

        try:
            self._process.terminate()
            self._process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            logger.debug("Proxy did not terminate gracefully, killing")
            try:
                self._process.kill()
                self._process.wait(timeout=1)
            except Exception:
                pass
        except Exception as e:
            logger.debug(f"Error stopping proxy: {e}")
        finally:
            self._process = None
