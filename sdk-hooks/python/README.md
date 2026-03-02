# CC-Viewer SDK (Python)

Python SDK integration for CC-Viewer, enabling seamless interception of Claude Agent SDK API requests.

## Installation

```bash
pip install cc-viewer-sdk
```

**Prerequisites:**
- Python 3.10+
- [cc-viewer](https://github.com/limin/cc-viewer) installed globally (`npm install -g cc-viewer`)

## Quick Start

```python
import asyncio
from cc_viewer_sdk import enable_cc_viewer

# Enable CC-Viewer interception with one line
enable_cc_viewer()

# Use Claude Agent SDK normally
from claude_agent_sdk import query

async def main():
    async for message in query(prompt="What is 2 + 2?"):
        print(message)

asyncio.run(main())
```

Visit `http://localhost:7008` to view the captured requests in the CC-Viewer Web UI.

## Usage

### Basic Usage

```python
from cc_viewer_sdk import enable_cc_viewer

# Enable interception
ctx = enable_cc_viewer()

# ... your SDK code ...

# Optional: explicit cleanup (automatic on exit)
ctx.disable()
```

### Context Manager

```python
from cc_viewer_sdk import enable_cc_viewer

with enable_cc_viewer() as ctx:
    # SDK requests are intercepted within this block
    from claude_agent_sdk import query
    # ...
# Proxy automatically stops when exiting the context
```

### Custom Configuration

```python
from cc_viewer_sdk import enable_cc_viewer

ctx = enable_cc_viewer(
    proxy_port=7010,        # Use specific port
    # start_viewer=True,    # Start web viewer (not yet implemented)
)
```

## How It Works

1. `enable_cc_viewer()` starts the CC-Viewer proxy server
2. Sets `ANTHROPIC_BASE_URL` environment variable to proxy URL
3. Claude Agent SDK (via bundled CLI) sends requests to proxy
4. Proxy forwards requests to Anthropic API and logs them
5. Logs appear in CC-Viewer Web UI at `http://localhost:7008`

## API Reference

### `enable_cc_viewer()`

```python
def enable_cc_viewer(
    log_dir: Path | str | None = None,
    proxy_port: int | None = None,
    start_viewer: bool = False,
    ccv_path: str | None = None,
) -> CCViewerContext
```

Enable CC-Viewer interception for Claude Agent SDK.

**Arguments:**
- `log_dir`: Custom log directory (default: `~/.claude/cc-viewer`)
- `proxy_port`: Specific proxy port (default: auto-assign)
- `start_viewer`: Whether to start the web viewer server (not yet implemented)
- `ccv_path`: Path to ccv executable (default: auto-detect)

**Returns:** `CCViewerContext` for cleanup and configuration

### `disable_cc_viewer()`

```python
def disable_cc_viewer() -> None
```

Disable CC-Viewer interception and stop the proxy.

### `CCViewerContext`

Context object returned by `enable_cc_viewer()`.

**Properties:**
- `proxy_port`: The port the proxy is running on
- `proxy_url`: The full proxy URL

**Methods:**
- `disable()`: Stop the proxy and restore original environment

## Troubleshooting

### "ccv not found in PATH"

Install cc-viewer globally:
```bash
npm install -g cc-viewer
```

### Requests not appearing in Web UI

1. Ensure CC-Viewer is running: visit `http://localhost:7008`
2. Check that `enable_cc_viewer()` was called before SDK usage
3. Verify the proxy started (check console output)

### Port Already in Use

Specify a different port:
```python
enable_cc_viewer(proxy_port=7011)
```

## License

MIT
