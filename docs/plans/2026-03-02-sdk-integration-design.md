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
- [ ] Add `ccv proxy` subcommand to CLI
  - [ ] Modify `proxy.js` to accept optional port parameter
  - [ ] Add `startProxyOnly()` function in `cli.js`
  - [ ] Test standalone proxy mode

### Phase 2: Python SDK Package

- [ ] Create `cc_viewer_sdk` Python package structure
  - [ ] `__init__.py` - exports
  - [ ] `core.py` - main `enable_cc_viewer()` function
  - [ ] `proxy.py` - proxy management (start/stop via subprocess)
  - [ ] `utils.py` - path helpers, logging
  - [ ] `pyproject.toml` - package configuration
  - [ ] `README.md` - usage documentation

### Phase 3: Integration & Testing

- [ ] Write unit tests for Python package
- [ ] Write integration tests with Claude Agent SDK
- [ ] Test on macOS
- [ ] Test log files appear in cc-viewer Web UI
- [ ] Test cleanup (no orphan processes)

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

## Notes

- Using environment variable injection approach (not custom Transport)
- Reusing existing `proxy.js` via subprocess
- Logs written to standard cc-viewer JSONL format

## Blockers / Questions

- (None currently)
