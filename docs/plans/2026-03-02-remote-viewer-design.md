# CC-Viewer Remote Access Design

**Branch**: `feature/remote-viewer`
**Started**: 2026-03-02

## Overview

Enable remote access to cc-viewer Web UI for monitoring SDK-based applications in enterprise intranet environments.

## Requirements

1. **Zero configuration** - User only needs `pip install your-sdk` and run `ccv`
2. **Remote access** - Developer can view user's request logs via `http://<user-ip>:7008`
3. **Trust intranet** - No additional authentication needed (enterprise network security)
4. **Seamless integration** - Works with existing cc-viewer UI

## Design

### Approach

Modify server.js to accept `CC_VIEWER_HOST` environment variable, defaulting to `127.0.0.1`. Python SDK passes `CC_VIEWER_HOST=0.0.0.0` when `remote=True`.

### Changes

#### 1. server.js

```javascript
// Before
const HOST = '127.0.0.1';

// After
const HOST = process.env.CC_VIEWER_HOST || '127.0.0.1';
```

#### 2. proxy.js (also needs to bind to 0.0.0.0 for remote access)

```javascript
// Before
server.listen(port, '127.0.0.1', () => {...});

// After
const PROXY_HOST = process.env.CC_VIEWER_HOST || '127.0.0.1';
server.listen(port, PROXY_HOST, () => {...});
```

#### 3. Python SDK - core.py

```python
def enable_cc_viewer(
    log_dir: Optional[Path | str] = None,
    proxy_port: Optional[int] = None,
    start_viewer: bool = False,
    ccv_path: Optional[str] = None,
    remote: bool = False,  # NEW
) -> CCViewerContext:
```

When `remote=True`:
- Set `CC_VIEWER_HOST=0.0.0.0` in environment
- Proxy and server will bind to all interfaces

#### 4. Python SDK - proxy.py

Pass `CC_VIEWER_HOST` environment variable to proxy process.

### User Experience

```python
from cc_viewer_sdk import enable_cc_viewer

# Enable with remote access
enable_cc_viewer(remote=True)

# Use Claude Agent SDK normally
from claude_agent_sdk import query
async for msg in query(prompt="Hello"):
    print(msg)
```

Developer accesses: `http://<user-ip>:7008`

## Tasks

- [x] Modify server.js to use CC_VIEWER_HOST env var
- [x] Modify proxy.js to use CC_VIEWER_HOST env var
- [x] Update Python SDK core.py with remote parameter
- [x] Update Python SDK proxy.py to pass env var (auto via os.environ.copy())
- [x] Test remote access locally
- [ ] Update README documentation
- [ ] Commit changes

## Progress Log

### 2026-03-02

- Created design document
- Modified server.js to use CC_VIEWER_HOST env var
- Modified proxy.js to use CC_VIEWER_HOST env var
- Added `remote` parameter to enable_cc_viewer()
- **Test passed**: Proxy correctly binds to 0.0.0.0 when remote=True

## Notes

- Security relies on enterprise intranet - no authentication added
- Default behavior unchanged (127.0.0.1 only)
- Remote mode explicitly opt-in via `remote=True`
