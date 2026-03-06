# CC-Viewer SDK (Python)

Python SDK for integrating [CC-Viewer](https://github.com/weiesky/cc-viewer) with applications built on [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk). Capture, inspect, and debug all API requests between your application and Claude API in real-time.

## Features

- 🔄 **Zero-config interception** - One line of code to enable monitoring
- 📊 **Real-time visualization** - View requests in the CC-Viewer Web UI
- 🔍 **Raw request/response logging** - See complete, unredacted API data
- 📁 **Automatic log management** - Logs organized by project with timestamp
- 🌐 **Remote access support** - Monitor applications on remote machines
- 🧩 **Context manager support** - Automatic cleanup with `with` statement

## Installation

### Prerequisites

- Python 3.10+
- Node.js 20+ (for cc-viewer)
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) installed

### Install cc-viewer

```bash
npm install -g cc-viewer
```

### Install Python SDK

```bash
pip install cc-viewer-sdk
```

Or install from source:

```bash
cd /path/to/cc-viewer/sdk-hooks/python
pip install -e .
```

## Quick Start

```python
import asyncio
from cc_viewer_sdk import enable_cc_viewer

# Enable CC-Viewer with one line
enable_cc_viewer()

# Use Claude Agent SDK normally
from claude_agent_sdk import query

async def main():
    async for message in query(prompt="Hello, Claude!"):
        if hasattr(message, 'content'):
            for block in message.content:
                if hasattr(block, 'text'):
                    print(block.text)

asyncio.run(main())
```

Then visit **http://localhost:7008** to view captured requests.

## Usage Examples

### Basic Usage

```python
from cc_viewer_sdk import enable_cc_viewer

# Enable interception
ctx = enable_cc_viewer()

print(f"Proxy running at: {ctx.proxy_url}")

# ... your Claude Agent SDK code ...

# Optional: explicit cleanup (happens automatically on exit)
ctx.disable()
```

### Context Manager

Use as a context manager for automatic cleanup:

```python
from cc_viewer_sdk import enable_cc_viewer

with enable_cc_viewer() as ctx:
    # All SDK requests within this block are intercepted
    from claude_agent_sdk import query
    
    async for msg in query(prompt="What is 2 + 2?"):
        print(msg)

# Proxy automatically stops when exiting the context
```

### Async Application

```python
import asyncio
from cc_viewer_sdk import enable_cc_viewer
from claude_agent_sdk import query, ClaudeAgentOptions

async def main():
    # Enable monitoring
    ctx = enable_cc_viewer()
    
    options = ClaudeAgentOptions(max_turns=3)
    
    async for msg in query(prompt="Tell me a joke", options=options):
        if hasattr(msg, 'content'):
            for block in msg.content:
                if hasattr(block, 'text'):
                    print(block.text)
    
    # Keep monitoring active while you view logs
    print(f"\nView logs at: http://localhost:7008")
    await asyncio.sleep(60)  # Wait to view logs
    
    ctx.disable()

asyncio.run(main())
```

### Remote Access

For monitoring applications running on another machine (e.g., in enterprise intranet):

```python
from cc_viewer_sdk import enable_cc_viewer

# Enable with remote access - binds to 0.0.0.0
ctx = enable_cc_viewer(remote=True)

print(f"Access from another machine: http://<your-ip>:7008")
```

> ⚠️ **Security Note:** Remote access binds to all network interfaces. Ensure your network is secure. No additional authentication is provided.

### Custom Configuration

```python
from cc_viewer_sdk import enable_cc_viewer

ctx = enable_cc_viewer(
    proxy_port=7010,        # Use specific proxy port (default: auto-assign)
    remote=True,            # Enable remote access
    ccv_path="/custom/path/to/ccv",  # Custom ccv path
)
```

### Using with Environment Variable

You can specify a custom ccv path via environment variable:

```bash
export CC_VIEWER_PATH="node /path/to/cc-viewer/cli.js"
python your_app.py
```

This is useful for:
- Development/testing with local cc-viewer source
- Using a specific cc-viewer version

## How It Works

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Your Python    │     │  CC-Viewer      │     │   Anthropic     │
│  Application    │────▶│  Proxy          │────▶│   API           │
│  (Claude Agent  │     │  (logs all      │     │                 │
│   SDK)          │     │   requests)     │     │                 │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  CC-Viewer      │
                        │  Web UI         │
                        │  (:7008)        │
                        └─────────────────┘
```

1. `enable_cc_viewer()` starts the CC-Viewer proxy server
2. Sets `ANTHROPIC_BASE_URL` environment variable to proxy URL
3. Patches Claude Agent SDK's subprocess transport to inject proxy settings
4. All API requests flow through the proxy
5. Proxy logs requests and forwards to Anthropic API
6. View logs in real-time at http://localhost:7008

## API Reference

### `enable_cc_viewer()`

```python
def enable_cc_viewer(
    log_dir: Path | str | None = None,
    proxy_port: int | None = None,
    start_viewer: bool = False,
    ccv_path: str | None = None,
    remote: bool = False,
) -> CCViewerContext
```

Enable CC-Viewer interception for Claude Agent SDK.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `log_dir` | `Path \| str \| None` | `~/.claude/cc-viewer` | Custom log directory |
| `proxy_port` | `int \| None` | auto-assign | Specific proxy port |
| `start_viewer` | `bool` | `False` | Start web viewer (not yet implemented) |
| `ccv_path` | `str \| None` | auto-detect | Path to ccv executable |
| `remote` | `bool` | `False` | Enable remote access (bind to 0.0.0.0) |

**Returns:** [`CCViewerContext`](#ccviewercontext)

### `disable_cc_viewer()`

```python
def disable_cc_viewer() -> None
```

Disable CC-Viewer interception globally. Stops the proxy and restores original environment.

### `CCViewerContext`

Context object returned by `enable_cc_viewer()`.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `proxy_port` | `int` | Port the proxy is running on |
| `proxy_url` | `str` | Full proxy URL (e.g., `http://127.0.0.1:58625`) |

**Methods:**

| Method | Description |
|--------|-------------|
| `disable()` | Stop the proxy and restore original environment |

**Context Manager Support:**

```python
with enable_cc_viewer() as ctx:
    print(ctx.proxy_url)
# Automatic cleanup on exit
```

## Viewing Logs

### Option 1: CC-Viewer Web UI

1. Visit **http://localhost:7008**
2. Click **CC-Viewer** menu → **Import Local Logs**
3. Select your project from the dropdown
4. Click on a log file to view

### Option 2: Direct URL

```
http://localhost:7008/?logfile=your_project/your_project_20260305_120000.jsonl
```

### Option 3: Start CC-Viewer Separately

```bash
# In a separate terminal
ccv

# Or with CLI mode (runs Claude in PTY with auto-browser)
ccv -c
```

## Log File Location

Logs are stored in `~/.claude/cc-viewer/<project_name>/`:

```
~/.claude/cc-viewer/
├── my_project/
│   ├── my_project_20260305_120000.jsonl
│   ├── my_project_20260305_130000.jsonl
│   └── my_project.json  # Stats cache
├── another_project/
│   └── ...
└── preferences.json
```

The project name is derived from your working directory.

## Troubleshooting

### "ccv not found in PATH"

Install cc-viewer globally:

```bash
npm install -g cc-viewer
```

Or specify a custom path:

```python
enable_cc_viewer(ccv_path="/path/to/ccv")
```

Or use environment variable:

```bash
export CC_VIEWER_PATH="node /path/to/cc-viewer/cli.js"
```

### "Proxy process died"

This usually means ccv doesn't support the `proxy` subcommand. Ensure you have the latest version:

```bash
npm update -g cc-viewer
```

### Requests Not Appearing in Web UI

1. Ensure CC-Viewer web server is running: visit http://localhost:7008
2. Check that `enable_cc_viewer()` was called **before** any SDK usage
3. Verify proxy started successfully (check console output)
4. Refresh the log list in the UI (close and reopen the import modal)

### Port Already in Use

Specify a different port:

```python
enable_cc_viewer(proxy_port=7011)
```

### API Key Issues

Make sure you have set your API key:

```bash
# For Anthropic API
export ANTHROPIC_API_KEY=your-api-key

# For custom endpoints (e.g., 智谱)
export ANTHROPIC_AUTH_TOKEN=your-token
```

## Development

### Running Tests

```bash
cd sdk-hooks/python
pip install -e ".[dev]"
pytest
```

### Running Demo

```bash
export ANTHROPIC_API_KEY=your-api-key
python demo/chat_demo.py
```

## Requirements

- Python >= 3.10
- Node.js >= 20
- cc-viewer >= 1.4.0
- claude-agent-sdk

## License

MIT

## Related

- [CC-Viewer](https://github.com/weiesky/cc-viewer) - The main project
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) - Anthropic's official SDK
