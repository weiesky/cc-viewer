export function parseNpmPackFiles(output) {
  let result;
  try {
    result = JSON.parse(output);
  } catch (error) {
    throw new Error(`npm pack returned invalid JSON: ${error.message}`);
  }

  const entry = Array.isArray(result) ? result[0] : null;
  if (!entry || !Array.isArray(entry.files)) {
    const shape = Array.isArray(result) ? `array(${result.length})` : typeof result;
    throw new Error(`npm pack returned no package file list (received ${shape})`);
  }

  return entry.files.map((file) => file?.path).filter((path) => typeof path === 'string').sort();
}
