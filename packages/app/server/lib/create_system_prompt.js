// System-prompt template builder: resolves runtime variables, loads
// systemPromptModel.md + the presets, and renders/assembles system-prompt text.
// Consumed by server/lib/system-prompt-presets.js and runnable directly as a CLI.
//
// CLI usage (renders with missing variables blanked out):
//   node server/lib/create_system_prompt.js                 # base model template
//   node server/lib/create_system_prompt.js deepseek-v4-pro # a named preset
//   node server/lib/create_system_prompt.js --list          # list presets

import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import { delimiter, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const TEMPLATE_VARIABLE_PATTERN = /\$\{([^}]+)\}/g

export const DYNAMIC_BOUNDARY = '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'

const MODEL_TEMPLATE_URL = new URL('../system-prompt-templates/systemPromptModel.md', import.meta.url)
const PRESETS_DIR_URL = new URL('../system-prompt-templates/presets/', import.meta.url)
const PRESETS_INDEX_URL = new URL('index.json', PRESETS_DIR_URL)
const PRESET_ID_PATTERN = /^[A-Za-z0-9._-]+$/

function stringifyTemplateValue(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : ''
  }
  return ''
}

function stringOrEmpty(readValue) {
  try {
    const value = readValue()
    if (value === null || value === undefined) return ''
    return String(value)
  } catch {
    return ''
  }
}

function numberOrEmpty(readValue) {
  try {
    const value = Number(readValue())
    return Number.isFinite(value) ? value : ''
  } catch {
    return ''
  }
}

function envString(name) {
  return stringOrEmpty(() => process.env[name] ?? '')
}

function commandOutput(command, args, cwd) {
  return stringOrEmpty(() => {
    const result = spawnSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000, // 15s hard cap: hanging git (NFS / huge repo / broken index) must not block spawn
    })
    if (result.error || result.status !== 0) return ''
    return result.stdout.trim()
  })
}

function firstNonEmpty(...values) {
  return values.find(value => value.length > 0) ?? ''
}

function currentDate(timeZone, date) {
  if (timeZone.length > 0) {
    const formatted = stringOrEmpty(() =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date),
    )
    if (formatted.length > 0) return formatted
  }
  return stringOrEmpty(() => date.toISOString().slice(0, 10))
}

function mergeSystemPromptVariables(base, overrides) {
  return {
    environment: { ...base.environment, ...overrides.environment },
    git: { ...base.git, ...overrides.git },
    os: { ...base.os, ...overrides.os },
    runtime: { ...base.runtime, ...overrides.runtime },
    time: { ...base.time, ...overrides.time },
    permissions: { ...base.permissions, ...overrides.permissions },
    sandbox: { ...base.sandbox, ...overrides.sandbox },
    terminal: { ...base.terminal, ...overrides.terminal },
    filesystem: { ...base.filesystem, ...overrides.filesystem },
    model: { ...base.model, ...overrides.model },
    memory: { ...base.memory, ...overrides.memory },
    scratchpad: { ...base.scratchpad, ...overrides.scratchpad },
  }
}

function slugifyPath(value) {
  return value.replace(/[^A-Za-z0-9]/g, '-')
}

function directoryExists(dir) {
  if (dir.length === 0) return false
  try {
    return statSync(dir).isDirectory()
  } catch {
    return false
  }
}

function resolveMemory(home, cwd) {
  const overrideDir = firstNonEmpty(
    envString('CC_MEMORY_DIR'),
    envString('CLAUDE_MEMORY_DIR'),
  )
  const dir =
    overrideDir.length > 0
      ? overrideDir
      : home.length > 0
        ? join(home, '.claude', 'projects', slugifyPath(cwd), 'memory') + sep
        : ''
  const enabled = directoryExists(dir)
  const index = enabled
    ? stringOrEmpty(() => readFileSync(join(dir, 'MEMORY.md'), 'utf8'))
    : ''
  return { dir, index, enabled: enabled ? 'true' : 'false' }
}

export function createSystemPromptVariables(overrides = {}, opts = {}) {
  // opts.cwd: resolve cwd-dependent variables (environment.cwd, git.*, memory.dir) against a
  // caller-supplied directory instead of process.cwd() — the spawn-time renderer passes the
  // workspace being launched, which is not necessarily where the ccv server itself runs.
  const cwd = (typeof opts.cwd === 'string' && opts.cwd) ? opts.cwd : stringOrEmpty(() => process.cwd())
  const now = new Date()
  const timeZone = stringOrEmpty(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  )
  const isGitRepository =
    commandOutput('git', ['rev-parse', '--is-inside-work-tree'], cwd) === 'true'
  const gitRoot = isGitRepository
    ? commandOutput('git', ['rev-parse', '--show-toplevel'], cwd)
    : ''
  const gitBranch = isGitRepository
    ? firstNonEmpty(
        commandOutput('git', ['branch', '--show-current'], cwd),
        commandOutput('git', ['rev-parse', '--short', 'HEAD'], cwd),
      )
    : ''
  const gitMainBranch = isGitRepository
    ? firstNonEmpty(
        commandOutput('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd).replace(/^origin\//, ''),
        commandOutput('git', ['config', '--get', 'init.defaultBranch'], cwd),
      )
    : ''

  const variables = {
    environment: {
      cwd,
      originalCwd: envString('PWD'),
      home: envString('HOME'),
      user: firstNonEmpty(envString('USER'), envString('USERNAME')),
      workspaceRoots: firstNonEmpty(
        envString('CODEX_WORKSPACE_ROOTS'),
        envString('CLAUDE_WORKSPACE_ROOTS'),
      ),
      path: envString('PATH'),
      lang: firstNonEmpty(envString('LANG'), envString('LC_ALL')),
    },
    git: {
      isRepository: isGitRepository ? 'true' : 'false',
      root: gitRoot,
      branch: gitBranch,
      mainBranch: gitMainBranch,
      userName: isGitRepository
        ? commandOutput('git', ['config', 'user.name'], cwd)
        : '',
      status: isGitRepository
        ? commandOutput('git', ['status', '--short'], cwd)
        : '',
      recentCommits: isGitRepository
        ? commandOutput('git', ['log', '--oneline', '-5'], cwd)
        : '',
    },
    os: {
      platform: stringOrEmpty(() => process.platform),
      type: stringOrEmpty(() => os.type()),
      arch: stringOrEmpty(() => os.arch()),
      shell: envString('SHELL'),
      version: stringOrEmpty(() => os.version()),
      release: stringOrEmpty(() => os.release()),
      hostname: stringOrEmpty(() => os.hostname()),
      availableParallelism: numberOrEmpty(() => os.availableParallelism()),
      totalMemory: numberOrEmpty(() => os.totalmem()),
      freeMemory: numberOrEmpty(() => os.freemem()),
      uptime: numberOrEmpty(() => os.uptime()),
    },
    runtime: {
      nodeVersion: stringOrEmpty(() => process.version),
      execPath: stringOrEmpty(() => process.execPath),
      pid: numberOrEmpty(() => process.pid),
      ppid: numberOrEmpty(() => process.ppid),
    },
    time: {
      current: stringOrEmpty(() => now.toString()),
      iso: stringOrEmpty(() => now.toISOString()),
      date: currentDate(timeZone, now),
      timezone: timeZone,
    },
    permissions: {
      mode: firstNonEmpty(
        envString('CLAUDE_PERMISSION_MODE'),
        envString('CODEX_PERMISSION_MODE'),
      ),
      approvalsReviewer: envString('CODEX_APPROVALS_REVIEWER'),
    },
    sandbox: {
      mode: firstNonEmpty(envString('SANDBOX_MODE'), envString('CODEX_SANDBOX_MODE')),
      networkAccess: firstNonEmpty(
        envString('NETWORK_ACCESS'),
        envString('CODEX_NETWORK_ACCESS'),
      ),
      writableRoots: firstNonEmpty(
        envString('WRITABLE_ROOTS'),
        envString('CODEX_WRITABLE_ROOTS'),
      ),
    },
    terminal: {
      term: envString('TERM'),
      colorTerm: envString('COLORTERM'),
      columns: numberOrEmpty(() => process.stdout.columns),
      rows: numberOrEmpty(() => process.stdout.rows),
    },
    filesystem: {
      tmpdir: stringOrEmpty(() => os.tmpdir()),
      pathSeparator: sep,
      pathDelimiter: delimiter,
    },
    model: {
      name: firstNonEmpty(envString('CLAUDE_MODEL'), envString('ANTHROPIC_MODEL')),
      knowledgeCutoff: envString('CLAUDE_KNOWLEDGE_CUTOFF'),
    },
    memory: resolveMemory(envString('HOME'), cwd),
    scratchpad: {
      dir: firstNonEmpty(
        envString('CC_SCRATCHPAD_DIR'),
        envString('CLAUDE_SCRATCHPAD_DIR'),
      ),
    },
  }

  return mergeSystemPromptVariables(variables, overrides)
}

function readDottedPath(path, variables) {
  const normalizedPath = path.trim()
  if (Object.prototype.hasOwnProperty.call(variables, normalizedPath)) {
    return variables[normalizedPath]
  }

  return normalizedPath.split('.').reduce((current, key) => {
    if (
      current === null ||
      current === undefined ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, key)
    ) {
      return undefined
    }
    return current[key]
  }, variables)
}

function replaceTemplateVariable(rawMatch, rawName, variables, missingVariableMode) {
  const value = readDottedPath(rawName, variables)
  if (value !== undefined) {
    return stringifyTemplateValue(value)
  }

  if (missingVariableMode === 'keep') return rawMatch
  if (missingVariableMode === 'throw') {
    throw new Error(`Missing system prompt template variable: ${rawName.trim()}`)
  }
  return ''
}

export function listTemplateVariables(markdownTemplate) {
  const names = new Set()
  for (const match of markdownTemplate.matchAll(TEMPLATE_VARIABLE_PATTERN)) {
    names.add(match[1].trim())
  }
  return Array.from(names).sort()
}

export function createSystemPrompt(markdownTemplate, options) {
  const variables = options.variables
  const missingVariableMode = options.missingVariableMode ?? 'throw'

  return markdownTemplate.replace(TEMPLATE_VARIABLE_PATTERN, (match, name) =>
    replaceTemplateVariable(match, name, variables, missingVariableMode),
  )
}

function isTrue(value) {
  return value === 'true'
}

// Ordered header -> key mapping. Section prose lives only in
// systemPromptModel.md (parsed at runtime), never duplicated here.
export const SYSTEM_PROMPT_SECTIONS = [
  { key: 'preamble', header: null },
  { key: 'environment', header: '# Environment' },
  { key: 'operatingSystem', header: '# Operating system' },
  { key: 'runtime', header: '# Runtime' },
  { key: 'time', header: '# Time' },
  { key: 'permissionsSandbox', header: '# Permissions and sandbox' },
  { key: 'terminal', header: '# Terminal' },
  { key: 'filesystem', header: '# Filesystem' },
  { key: 'model', header: '# Model' },
  { key: 'git', header: '# Git' },
  {
    key: 'memory',
    header: '# Memory',
    includeWhen: variables => isTrue(variables.memory.enabled),
  },
  {
    key: 'scratchpad',
    header: '# Scratchpad Directory',
    includeWhen: variables => variables.scratchpad.dir.length > 0,
  },
  { key: 'contextManagement', header: '# Context management' },
]

// Splits a model template into its preamble and a header -> raw-section-text map.
// Level-1 headers (`# `) inside fenced code blocks are ignored so fenced
// examples (e.g. the memory frontmatter) do not start new sections.
function splitTemplate(markdownTemplate) {
  const parts = markdownTemplate.split(DYNAMIC_BOUNDARY)
  if (parts.length !== 2) {
    throw new Error(
      `System prompt template must contain exactly one ${DYNAMIC_BOUNDARY} marker (found ${parts.length - 1})`,
    )
  }
  const preamble = parts[0].trim()
  const sectionsByHeader = new Map()
  const lines = parts[1].split('\n')
  let currentHeader = null
  let buffer = []
  let inFence = false

  const flush = () => {
    if (currentHeader !== null) {
      sectionsByHeader.set(currentHeader, buffer.join('\n').trim())
    }
  }

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence
    }
    if (!inFence && line.startsWith('# ')) {
      flush()
      currentHeader = line.trim()
      buffer = [line]
      continue
    }
    if (currentHeader !== null) buffer.push(line)
  }
  flush()
  return { preamble, sectionsByHeader }
}

export function assembleSystemPrompt(markdownTemplate, options) {
  const { variables, missingVariableMode, sections } = options
  const known = new Set(SYSTEM_PROMPT_SECTIONS.map(section => section.key))
  if (sections) {
    for (const key of sections) {
      if (!known.has(key)) {
        throw new Error(`Unknown system prompt section key: ${key}`)
      }
    }
  }
  const selected = sections ? new Set(sections) : known
  const { preamble, sectionsByHeader } = splitTemplate(markdownTemplate)

  const rendered = []
  for (const section of SYSTEM_PROMPT_SECTIONS) {
    if (!selected.has(section.key)) continue
    if (section.includeWhen && !section.includeWhen(variables)) continue

    let raw
    if (section.header === null) {
      raw = preamble
    } else {
      const found = sectionsByHeader.get(section.header)
      // A template may legitimately include only a subset of sections (e.g. the
      // presets omit git and most environment blocks); skip any that are absent.
      if (found === undefined) continue
      raw = found
    }
    rendered.push(createSystemPrompt(raw, { variables, missingVariableMode }))
  }

  // The MEMORY.md contents are runtime data, not authored prose, and they are
  // already self-titled ("# Memory index"). Append them verbatim as a trailing
  // block whenever the memory section is present, without re-templating (the
  // index may legitimately contain literal ${...} text).
  if (
    selected.has('memory') &&
    isTrue(variables.memory.enabled) &&
    variables.memory.index.trim().length > 0
  ) {
    rendered.push(variables.memory.index)
  }

  return rendered.map(part => part.trim()).filter(Boolean).join('\n\n')
}

export function loadModelTemplate() {
  return readFileSync(MODEL_TEMPLATE_URL, 'utf8')
}

// Locales with a translated systemPromptVariables.<locale>.md sibling. Mirrors the
// UI's LANG_OPTIONS (src/i18n.js) minus 'en', which is the base file itself.
export const VARIABLES_DOC_LOCALES = [
  'zh', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da',
  'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk',
]

// The human-readable reference for the ${...} template variables (rendered in the
// "Edit System Prompt" modal's parameter-docs popup). `lang` is whitelisted against
// VARIABLES_DOC_LOCALES; 'en', unknown values, and a missing localized file all fall
// back to the English base document.
export function loadVariablesDoc(lang) {
  if (typeof lang === 'string' && VARIABLES_DOC_LOCALES.includes(lang)) {
    try {
      return readFileSync(
        new URL(`../system-prompt-templates/systemPromptVariables.${lang}.md`, import.meta.url),
        'utf8',
      )
    } catch (e) {
      // A whitelisted locale should always have a shipped translation file, so a
      // read failure here is diagnostic — log it, then fall back to the English base.
      console.warn(`[CC Viewer] localized variables doc unreadable for ${lang}:`, e.message)
    }
  }
  return readFileSync(new URL('../system-prompt-templates/systemPromptVariables.md', import.meta.url), 'utf8')
}

function assertSafePresetId(id) {
  if (typeof id !== 'string' || !PRESET_ID_PATTERN.test(id) || id.includes('..')) {
    throw new Error(`Invalid preset id: ${JSON.stringify(id)}`)
  }
  return id
}

export function loadPreset(id) {
  // Accept an optional `.md` suffix so `... deepseek-v4-pro.md` resolves too.
  const normalized = typeof id === 'string' ? id.replace(/\.md$/i, '') : id
  const safeId = assertSafePresetId(normalized)
  return readFileSync(new URL(`${safeId}.md`, PRESETS_DIR_URL), 'utf8')
}

export function listPresets() {
  const manifest = JSON.parse(readFileSync(PRESETS_INDEX_URL, 'utf8'))
  return manifest
}

// Strips HTML editor comments (`<!-- ... -->`) that document the preset file but
// must not leak into the rendered prompt.
function stripEditorComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s+/, '')
}

// Normalizes a preset into a full template. Two shapes are supported:
//   - Self-contained (what the shipped presets use): the preset already has its
//     own DYNAMIC_BOUNDARY + dynamic sections, so it is returned as-is.
//   - Preamble-only (no boundary): composed with systemPromptModel.md's shared
//     dynamic tail, so environment snippets can stay unified. None of the shipped
//     presets currently use this path.
function toFullTemplate(presetSource) {
  const source = stripEditorComments(presetSource)
  if (source.includes(DYNAMIC_BOUNDARY)) return source
  const modelParts = loadModelTemplate().split(DYNAMIC_BOUNDARY)
  return `${source.trim()}\n\n${DYNAMIC_BOUNDARY}\n${modelParts[1]}`
}

export function renderModel(options) {
  return assembleSystemPrompt(loadModelTemplate(), options)
}

export function renderPreset(id, options) {
  return assembleSystemPrompt(toFullTemplate(loadPreset(id)), options)
}

// Returns a preset composed into a full template with the dynamic-boundary marker
// removed and `${...}` placeholders left LITERAL (no variable substitution). This
// is the raw text used to pre-fill the "Edit System Prompt" editor, where the user
// tweaks it before saving.
export function renderPresetTemplate(id) {
  return toFullTemplate(loadPreset(id))
    .split(DYNAMIC_BOUNDARY)
    .map(part => part.trim())
    .filter(Boolean)
    .join('\n\n')
}

function runCli() {
  const arg = process.argv[2]
  if (arg === '--list' || arg === '-l') {
    process.stdout.write(JSON.stringify(listPresets(), null, 2) + '\n')
    return
  }
  const variables = createSystemPromptVariables()
  const output = arg
    ? renderPreset(arg, { variables, missingVariableMode: 'empty' })
    : renderModel({ variables, missingVariableMode: 'empty' })
  process.stdout.write(output + '\n')
}

// Guard against `process.argv[1]` being undefined (e.g. under `node --test`,
// where importing this module must not run the CLI).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
}
