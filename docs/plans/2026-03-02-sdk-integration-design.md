# CC-Viewer SDK Integration - Implementation Progress

**Branch**: `feature/sdk-integration`
**Started**: 2026-03-02

## Overview

Enable CC-Viewer to intercept API requests from Claude Agent SDK (Python) applications.

## Design Doc

See [2026-03-02-sdk-integration-design.md](./2026-03-02-sdk-integration-design.md)

## Tasks

### Phase 1: Core Infrastructure

- [x] Create feature branch `feature/sdk-integration`
- [x] Add `ccv proxy` subcommand to CLI
  - [x] Modify `proxy.js` to accept optional port parameter
  - [x] Add `startProxyOnly()` function in `cli.js`
  - [x] Test standalone proxy mode

### Phase 2: Python SDK Package

- [x] Create `cc_viewer_sdk` Python package structure
  - [x] `__init__.py` - exports
  - [x] `core.py` - main `enable_cc_viewer()` function with SDK patching
  - [x] `proxy.py` - proxy management (start/stop via subprocess)
  - [x] `utils.py` - path helpers, logging
  - [x] `pyproject.toml` - package configuration
  - [x] `README.md` - usage documentation
  - [x] `py.typed` - PEP 561 marker

### Phase 3: Integration & Testing

- [x] Write unit tests for Python package
- [x] Write integration tests with Claude Agent SDK
- [x] Test on macOS
- [x] Test log files appear in cc-viewer Web UI
- [x] Test cleanup (no orphan processes)

### Phase 4: Documentation & Release

- [ ] Update main README.md with SDK integration instructions
- [ ] Add i18n entries for any new UI elements
- [ ] Create example code snippets
- [ ] Update history.md

## Progress Log

### 2026-03-02

- Created design document
- Started implementation of `ccv proxy` subcommand
- Created initial Python package structure
- Added manual test script and test plan
- **Key discovery**: Claude Code CLI doesn't read `ANTHROPIC_BASE_URL` from environment
  - Solution: Patch SDK's `SubprocessCLITransport._build_command` to inject `--settings`
- Fixed proxy URL forwarding to support custom API endpoints (e.g., GLM)
- **Integration test PASSED** - SDK requests now correctly logged to cc-viewer

## Test Instructions

See [sdk-hooks/python/tests/TEST_PLAN.md](../../../sdk-hooks/python/tests/TEST_PLAN.md)

Quick test:
```bash
cd sdk-hooks/python
python tests/test_manual.py test_proxy      # Test proxy command
python tests/test_manual.py test_sdk_enable # Test SDK enable/disable
python tests/test_manual.py all             # Run all basic tests
```

## Notes

- Using environment variable injection approach (not custom Transport)
- Reusing existing `proxy.js` via subprocess
- Logs written to standard cc-viewer JSONL format

## Blockers / Questions

- (None currently)
