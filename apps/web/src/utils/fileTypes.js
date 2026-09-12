/**
 * fileTypes.js — file-type classification for the project file browser.
 *
 * Pure logic (no JSX): maps (name, type) to a small set of icon category keys,
 * so it can be unit-tested directly with node:test. Rendering lives in
 * fileIcons.jsx, which consumes these categories to pick a glyph + color.
 *
 * Categories: directory | code | markup | data | document | image | video |
 * audio | archive | pdf | office | font | binary | plain
 */

// Extension → category. Languages all map to the shared 'code' glyph and are
// differentiated by color in fileIcons.jsx (EXT_COLORS), not by shape.
const EXT_CATEGORY = {
  // code
  js: 'code', jsx: 'code', ts: 'code', tsx: 'code', py: 'code', go: 'code',
  rs: 'code', rb: 'code', java: 'code', c: 'code', cpp: 'code', cc: 'code',
  cxx: 'code', h: 'code', hpp: 'code', php: 'code', sql: 'code', vue: 'code',
  svelte: 'code', kt: 'code', swift: 'code', lua: 'code', r: 'code',
  sh: 'code', bash: 'code', zsh: 'code',
  // markup / styles
  html: 'markup', htm: 'markup', xml: 'markup',
  css: 'markup', scss: 'markup', sass: 'markup', less: 'markup',
  // data / config
  json: 'data', yml: 'data', yaml: 'data', toml: 'data',
  ini: 'data', env: 'data', conf: 'data', lock: 'data', map: 'data',
  // document / text
  md: 'document', markdown: 'document', txt: 'document', rst: 'document', log: 'document',
  // image
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image',
  bmp: 'image', ico: 'image', icns: 'image', webp: 'image', avif: 'image',
  // video
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video',
  // audio
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio',
  // archive
  zip: 'archive', tar: 'archive', gz: 'archive', tgz: 'archive',
  bz2: 'archive', xz: 'archive', '7z': 'archive', rar: 'archive',
  // pdf
  pdf: 'pdf',
  // office
  doc: 'office', docx: 'office', odt: 'office',
  xls: 'office', xlsx: 'office', ods: 'office',
  ppt: 'office', pptx: 'office', odp: 'office',
  // font
  woff: 'font', woff2: 'font', ttf: 'font', otf: 'font', eot: 'font',
  // binary / executable
  exe: 'binary', dll: 'binary', so: 'binary', dylib: 'binary', bin: 'binary',
  class: 'binary', jar: 'binary', wasm: 'binary', db: 'binary', sqlite: 'binary',
};

// Well-known extension-less files that carry build/config semantics.
const SPECIAL_FILENAMES = {
  makefile: 'data', dockerfile: 'data', license: 'data', readme: 'data',
  'docker-compose.yml': 'data', 'docker-compose.yaml': 'data',
};

/**
 * Classify a file-browser item into an icon category.
 * @param {string} name  file or directory name (may include a path)
 * @param {string} [type]  'directory' | 'file' | undefined
 * @returns {string} category key
 */
export function getFileType(name, type) {
  // Directory branch first: GitChanges calls getFileIcon('', 'directory'), so
  // this must return before any string handling on an empty name.
  if (type === 'directory') return 'directory';
  const base = String(name || '').split('/').pop();
  // dot > 0 (not >= 0): a leading dot with no other dot (".gitignore", ".env")
  // yields no extension, so dotfiles are not misread as "<name>" extensions.
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  if (ext && EXT_CATEGORY[ext]) return EXT_CATEGORY[ext];
  // Extension-less: special build/config filenames, else plain.
  const special = SPECIAL_FILENAMES[base.toLowerCase()];
  if (special) return special;
  return 'plain';
}

/**
 * Extract the lowercased extension the same way getFileType does — exposed so
 * fileIcons.jsx colors the exact same token it classified (no double logic).
 */
export function getExt(name) {
  const base = String(name || '').split('/').pop();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}
