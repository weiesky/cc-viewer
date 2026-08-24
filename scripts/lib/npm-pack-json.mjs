export function parseNpmPackFiles(output) {
  let result;
  try {
    result = JSON.parse(output);
  } catch (error) {
    throw new Error(`npm pack returned invalid JSON: ${error.message}`);
  }

  // npm <=11 returns an array; npm 12 returns an object keyed by package name.
  // Also accept a direct entry defensively, but require exactly one package.
  let entry = null;
  if (Array.isArray(result)) {
    entry = result[0];
  } else if (result && typeof result === 'object') {
    if (result.error) {
      const summary = result.error.summary || result.error.code || JSON.stringify(result.error);
      throw new Error(`npm pack failed: ${summary}`);
    }
    if (Array.isArray(result.files)) {
      entry = result;
    } else {
      const entries = Object.values(result).filter((value) => value && Array.isArray(value.files));
      if (entries.length === 1) entry = entries[0];
    }
  }
  if (!entry || !Array.isArray(entry.files)) {
    const shape = Array.isArray(result) ? `array(${result.length})` : typeof result;
    throw new Error(`npm pack returned no package file list (received ${shape})`);
  }

  return entry.files.map((file) => file?.path).filter((path) => typeof path === 'string').sort();
}
