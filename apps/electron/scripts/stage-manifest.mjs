// Build the package.json consumed by electron-builder from the publishable app
// metadata and the Electron workspace's runtime dependencies.
//
// Keep repository metadata here: with GH_TOKEN present, electron-builder uses it
// to resolve the implicit GitHub publish provider even when invoked with
// `--publish never` (it still writes updater metadata for NSIS/AppImage targets).
export function createStageManifest(appPkg, electronPkg) {
  return {
    name: appPkg.name,
    version: appPkg.version,
    description: appPkg.description,
    license: appPkg.license,
    author: appPkg.author,
    repository: appPkg.repository,
    bugs: appPkg.bugs,
    homepage: appPkg.homepage,
    main: 'electron/main.js',
    type: 'module',
    dependencies: { ...electronPkg.dependencies },
    optionalDependencies: { ...electronPkg.optionalDependencies },
  };
}
