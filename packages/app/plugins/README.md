# Bundled Plugins

This directory ships with cc-viewer. It is the default location for built-in plugins
that are loaded at server startup by the plugin loader. Add `.js` or `.mjs` files here
to ship plugins with the package without requiring users to populate their personal
`~/.claude/cc-viewer/plugins/` directory.

Two shapes are supported:

- **Hook plugins** — single `.js`/`.mjs` files (see the note below on docs).
- **Service plugins** — subdirectories containing a `plugin.json` manifest (main-process
  module + optional child-process service + optional React panel bundle). User plugins
  with the same name take priority over bundled ones, matching the single-file rule.

For detailed documentation on the plugin system, see the repository docs:
`docs/plugins.md` (hook plugins) and `docs/plugin-services.md` (service/panel plugins).
