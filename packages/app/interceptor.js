// Re-export shim — physical implementation lives at server/interceptor.js.
//
// Why a root shim:
//   1. Older @anthropic-ai/claude-code/cli.js installs may still carry the
//      pre-1.6.273 INJECT marker `import '../../cc-viewer/interceptor.js';`.
//      Removing this shim would crash those existing claude installs on startup
//      until the user re-runs `ccv -logger` to rewrite the marker.
//   2. Cheap insurance — single re-export costs negligible runtime overhead.
// New code should `import 'cc-viewer/interceptor.js'` via package.json exports
// instead of the relative `../../cc-viewer/interceptor.js` form.
export * from './server/interceptor.js';
