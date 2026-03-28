#!/usr/bin/env zx

// ralph.mjs — autonomous coding loop
// Runs from any project directory. Not a project dependency.

$.verbose = false

// ── Constants ──────────────────────────────────────────────────────────────

const RALPH_DIR = 'docs/ralph-loop'
const COMMIT_MSG_FILE = path.join(RALPH_DIR, '.ralph-commit-msg')
const COMPLETION_SIGIL = '<promise>COMPLETE</promise>'
const TOOL_PROBE_TIMEOUT = 3000
const TOOL_EXEC_TIMEOUT = 0 // 0 = no timeout
const LOG_DIR = path.join(RALPH_DIR, 'logs')
// Resolve through symlink: ~/bin/ralph → /opt/ralph/ralph.mjs
// zx clobbers __filename/__dirname and import.meta.url follows the symlink,
// so we resolve the real path of the script via the shell.
// Falls back to import.meta.url for direct invocation (e.g. zx src/ralph.mjs).
let SCRIPT_REAL_DIR
try {
  const resolved = (await $`dirname $(readlink -f $(which ralph) 2>/dev/null)`).stdout.trim()
  await fs.access(path.join(resolved, 'prompts'))
  SCRIPT_REAL_DIR = resolved
} catch {
  SCRIPT_REAL_DIR = path.dirname(new URL(import.meta.url).pathname)
}
const PROMPTS_DIR = path.join(SCRIPT_REAL_DIR, 'prompts')

const TOOLS_TO_PROBE = [
  'grep', 'rg', 'ag', 'awk', 'sed', 'jq', 'yq', 'fzf',
  'find', 'fd', 'tree', 'ls', 'cat', 'head', 'tail', 'wc', 'sort', 'uniq', 'xargs', 'rsync',
  'git', 'gh', 'delta',
  'node', 'npm', 'pnpm', 'yarn', 'bun', 'npx', 'tsx', 'python3', 'pip', 'make', 'cmake',
  'docker', 'docker-compose', 'kubectl', 'terraform',
  'curl', 'wget', 'httpie', 'ssh', 'scp',
  'bat', 'less', 'vim', 'nano', 'code',
  'tar', 'gzip', 'zip', 'unzip', '7z',
  'ps', 'top', 'htop', 'df', 'du', 'lsof', 'kill', 'uname',
]

// ── CLI ────────────────────────────────────────────────────────────────────

const command = argv._[0]
const cliOpts = {
  prompt: argv.prompt ? [].concat(argv.prompt) : undefined,
  status: argv.status,
  tool: argv.tool,
  max: argv.max ? Number(argv.max) : undefined,
  dryRun: argv['dry-run'] || false,
  verbose: argv.verbose || false,
  configPath: argv.config || path.join(RALPH_DIR, 'ralph.config.yml'),
}

// ── Logger ─────────────────────────────────────────────────────────────────
// Per-run log file in tmp/ relative to CWD. Each ralph invocation gets its own.

let logFile = null

async function initLog() {
  await fs.mkdir(LOG_DIR, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  logFile = path.join(LOG_DIR, `ralph-${ts}.log`)
  await fs.writeFile(logFile, `# ralph log — ${new Date().toISOString()}\n# CWD: ${process.cwd()}\n# command: ${command || '(help)'}\n\n`)
  return logFile
}

function log(level, msg) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`
  if (logFile) fs.appendFileSync(logFile, line)
}

// ── Helpers ────────────────────────────────────────────────────────────────
/**
 * Attempt to execute a function and return the result or the error.
 * Reduces nested error paths, error hoisting, and nested try/catch blocks.
 *
 * @param {Function} fn - The function to execute.
 * @returns [result, error]
 *
 * @example
 * const [result, error] = await attempt(async () => {
 *   return await someFunction()
 * })
 *
 * // maybe fatal:
 * if (error) die(error.message)
 */
async function attempt(fn) {
  try {
    return [await fn(), null]
  } catch (err) {
    return [null, err]
  }
}

function die(msg) {
  log('FATAL', msg)
  console.error(chalk.red(`ralph: ${msg}`))
  process.exit(1)
}

function info(msg) {
  log('INFO', msg)
  console.error(chalk.blue(`ralph: ${msg}`))
}

function ok(msg) {
  log('OK', msg)
  console.error(chalk.green(`ralph: ${msg}`))
}

async function exists(p) {
  try { await fs.access(p); return true } catch { return false }
}

async function readOr(p, fallback = '') {
  try { return await fs.readFile(p, 'utf8') } catch { return fallback }
}

async function loadPrompt(name) {
  return fs.readFile(path.join(PROMPTS_DIR, name), 'utf8')
}

function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

// ── Config ─────────────────────────────────────────────────────────────────

async function loadConfig() {
  log('INFO', `loading config from ${cliOpts.configPath}`)
  const raw = await fs.readFile(cliOpts.configPath, 'utf8')
  const cfg = YAML.parse(raw) || {}
  const merged = {
    tool: cliOpts.tool || cfg.tool || 'claude',
    max_iterations: cliOpts.max || cfg.max_iterations || 50,
    anchor: cfg.anchor || null,
    prompt: cliOpts.prompt || [].concat(cfg.prompt || [path.join(RALPH_DIR, 'ralph-prompt.md')]),
    status: cliOpts.status || cfg.status || path.join(RALPH_DIR, 'ralph-status.md'),
    quality_checks: cfg.quality_checks || [],
  }
  log('INFO', `config: tool=${merged.tool} max=${merged.max_iterations} anchor=${merged.anchor?.slice(0, 12) || 'null'}`)
  return merged
}

// ── Environment Discovery ──────────────────────────────────────────────────

let envCache = null

async function discoverEnv() {
  if (envCache) return envCache

  const platform = os.platform()
  const arch = os.arch()
  const release = os.release()
  const shell = process.env.SHELL || process.env.COMSPEC || 'unknown'
  const cwd = process.cwd()
  const nodeVersion = process.version

  let osName = platform
  let osVersion = release

  if (platform === 'darwin') {
    osName = 'macOS'
    const [ver] = await attempt(() => $`sw_vers -productVersion`)
    if (ver) osVersion = ver.stdout.trim()
  } else if (platform === 'linux') {
    const [rel] = await attempt(() => fs.readFile('/etc/os-release', 'utf8'))
    if (rel) {
      const m = rel.match(/PRETTY_NAME="(.+)"/)
      if (m) osName = m[1]
    }
  }

  // Package manager detection
  const lockfiles = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm'],
  ]
  let pm = 'npm', lockfile = 'none'
  for (const [file, name] of lockfiles) {
    if (await exists(path.join(cwd, file))) { pm = name; lockfile = file; break }
  }

  // Tool probes — parallel with timeout
  const results = {}

  await Promise.allSettled(TOOLS_TO_PROBE.map(async (name) => {
    const [found] = await attempt(() => Promise.race([
      (async () => {
        const p = (await $`which ${name} 2>/dev/null`).stdout.trim()
        const [v1] = await attempt(() => $`${name} --version 2>&1 | head -1`)
        let v = v1?.stdout.trim() || 'unknown'
        if (v === 'unknown') {
          const [v2] = await attempt(() => $`${name} -v 2>&1 | head -1`)
          if (v2) v = v2.stdout.trim()
        }
        return { available: true, path: p, version: v }
      })(),
      new Promise((_, rej) => setTimeout(() => rej(), TOOL_PROBE_TIMEOUT)),
    ]))
    results[name] = found || { available: false }
  }))

  const availRows = Object.entries(results)
    .filter(([, v]) => v.available)
    .map(([n, v]) => `| ${n} | ${v.version} | ${v.path} |`)
    .join('\n')

  const unavailList = Object.entries(results)
    .filter(([, v]) => !v.available)
    .map(([n]) => n)
    .join(', ')

  log('INFO', `env: ${osName} ${osVersion} (${platform} ${arch}) shell=${shell} node=${nodeVersion} pm=${pm}`)
  const availCount = Object.values(results).filter(v => v.available).length
  const unavailCount = Object.values(results).filter(v => !v.available).length
  log('INFO', `tools: ${availCount} available, ${unavailCount} unavailable`)

  envCache = [
    `## Environment\n`,
    `**OS:** ${osName} ${osVersion} (${platform} ${arch})`,
    `**Shell:** ${shell}`,
    `**Node:** ${nodeVersion}`,
    `**CWD:** ${cwd}`,
    `**Package manager:** ${pm} (lockfile: ${lockfile})`,
    ``,
    `### Available tools\n`,
    `| Tool | Version | Path |`,
    `|------|---------|------|`,
    availRows,
    ``,
    `### Unavailable tools\n`,
    unavailList || 'none',
  ].join('\n')

  return envCache
}

// ── init ───────────────────────────────────────────────────────────────────

async function cmdInit() {
  if (await exists(cliOpts.configPath)) {
    die(`${cliOpts.configPath} already exists. Use \`ralph new\` instead.`)
  }

  const promptPath = path.join(RALPH_DIR, 'ralph-prompt.md')
  const statusPath = path.join(RALPH_DIR, 'ralph-status.md')

  const cfg = {
    tool: 'claude',
    max_iterations: 50,
    anchor: null,
    prompt: [promptPath],
    status: statusPath,
    quality_checks: [],
  }

  await fs.mkdir(RALPH_DIR, { recursive: true })
  await fs.writeFile(cliOpts.configPath, YAML.stringify(cfg))
  await fs.writeFile(statusPath, await loadPrompt('init-status.md'))
  await fs.writeFile(promptPath, await loadPrompt('init-prompt.md'))

  await $`git add ${cliOpts.configPath} ${statusPath} ${promptPath}`
  await $`git commit -m ${'ralph(init): initialize ralph loop'}`

  const sha = (await $`git rev-parse HEAD`).stdout.trim()
  cfg.anchor = sha
  await fs.writeFile(cliOpts.configPath, YAML.stringify(cfg))

  await $`git add ${cliOpts.configPath}`
  await $`git commit -m ${'ralph(anchor): ' + sha.slice(0, 12)}`

  ok(`initialized (anchor: ${sha.slice(0, 12)})`)
  info(`edit ${promptPath}, then run: ralph`)
}

// ── new ────────────────────────────────────────────────────────────────────

async function cmdNew() {
  if (!(await exists(cliOpts.configPath))) {
    die(`no config found. Run \`ralph init\` first.`)
  }

  const cfg = YAML.parse(await fs.readFile(cliOpts.configPath, 'utf8'))
  const statusPath = cfg.status || path.join(RALPH_DIR, 'ralph-status.md')

  await fs.writeFile(statusPath, '')
  if (await exists(COMMIT_MSG_FILE)) await fs.unlink(COMMIT_MSG_FILE)

  await $`git add -A`
  await $`git commit -m ${'ralph(reset): start new loop cycle'}`

  const sha = (await $`git rev-parse HEAD`).stdout.trim()
  cfg.anchor = sha
  await fs.writeFile(cliOpts.configPath, YAML.stringify(cfg))

  await $`git add ${cliOpts.configPath}`
  await $`git commit -m ${'ralph(anchor): ' + sha.slice(0, 12)}`

  ok(`new cycle started (anchor: ${sha.slice(0, 12)})`)
  info(`edit ${path.join(RALPH_DIR, 'ralph-prompt.md')} if needed, then run: ralph`)
}

// ── run (default) ──────────────────────────────────────────────────────────

async function cmdRun() {
  if (!(await exists(cliOpts.configPath))) {
    die(`no config found. Run \`ralph init\` first.`)
  }

  // Phase 0 — Environment Discovery (once)
  info('discovering environment...')
  const envBlock = await discoverEnv()
  ok('environment ready')

  // Main loop
  while (true) {
    // ── Phase 1: Gather ──────────────────────────────────────────────────

    const cfg = await loadConfig()

    if (!cfg.anchor) die('no anchor in config. Run `ralph new`.')

    const [, anchorErr] = await attempt(() => $`git cat-file -t ${cfg.anchor}`)
    if (anchorErr) die(`anchor ${cfg.anchor} not found in git. Run \`ralph new\`.`)

    // Derive iteration count from git
    const grepPat = 'ralph(iteration-'
    const range = `${cfg.anchor}..HEAD`
    const iterLog = (await $`git log --oneline --grep=${grepPat} ${range}`).stdout.trim()
    const iterCount = iterLog ? iterLog.split('\n').length : 0
    const N = iterCount + 1

    if (N > cfg.max_iterations) {
      info(`max iterations reached (${cfg.max_iterations})`)
      process.exit(1)
    }

    info(`── iteration ${N} of ${cfg.max_iterations} ──`)

    // Git context scoped to anchor..HEAD
    const gitLog = (await $`git log --oneline ${range}`).stdout.trim()
      || 'No commits yet in this cycle.'
    const anchorLine = (await $`git log --oneline -1 ${cfg.anchor}`).stdout.trim()
    const [lastFilesResult] = await attempt(() => $`git diff-tree --no-commit-id --name-status -r HEAD`)
    const lastFiles = lastFilesResult?.stdout.trim() || ''

    // Status report — strip bare headers to detect truly empty reports
    const statusRaw = await readOr(cfg.status, '')
    const statusMeaningful = statusRaw.replace(/^#[^\n]*\n?/gm, '').trim()
    const statusBlock = statusMeaningful
      ? statusRaw
      : (await loadPrompt('first-iteration.md')).trim()

    // Resolve and read prompt files
    const cwd = process.cwd()
    let promptPaths = []
    for (const p of cfg.prompt) {
      const abs = path.resolve(cwd, p)
      promptPaths.push(...await glob(abs))
    }
    if (!promptPaths.length) die('no prompt files found.')

    const userPrompt = (
      await Promise.all(promptPaths.map(f => fs.readFile(f, 'utf8')))
    ).join('\n\n---\n\n')

    // ── Phase 2: Compose ─────────────────────────────────────────────────

    const ts = new Date().toISOString()

    const vars = {
      ITERATION: String(N),
      MAX_ITERATIONS: String(cfg.max_iterations),
      ENV_BLOCK: envBlock,
      GIT_LOG: gitLog,
      ANCHOR_LINE: anchorLine,
      LAST_FILES: lastFiles || 'N/A',
      STATUS_BLOCK: statusBlock,
      STATUS_PATH: cfg.status,
      COMMIT_MSG_PATH: COMMIT_MSG_FILE,
      TIMESTAMP: ts,
    }

    const preamble = render(await loadPrompt('preamble.md'), vars)
    const postamble = render(await loadPrompt('postamble.md'), vars)
    const assembled = `${preamble}\n\n${userPrompt}\n\n${postamble}`
    log('INFO', `prompt assembled: ${assembled.length} chars from ${promptPaths.join(', ')}`)

    // Dry run — print and exit
    if (cliOpts.dryRun) {
      log('INFO', 'dry-run mode — printing prompt and exiting')
      process.stdout.write(assembled)
      process.exit(0)
    }

    // ── Execute ──────────────────────────────────────────────────────────

    const tmpFile = path.join(os.tmpdir(), `ralph-${Date.now()}.md`)
    await fs.writeFile(tmpFile, assembled)

    info(`invoking ${cfg.tool}...`)
    let retryN = 0
    const [result, toolErr] = await attempt(() => within(() =>
      retry(3, async () => {
        if (retryN > 0) info(`retry ${retryN}/3...`)
        retryN++
        let proc
        switch (cfg.tool) {
          case 'claude':
            proc = $({input: assembled})`claude --dangerously-skip-permissions --print --verbose`
            break
          case 'amp':
            proc = $`cat ${tmpFile} | amp --dangerously-allow-all`
            break
          case 'codex':
            proc = $`cat ${tmpFile} | codex exec --dangerously-bypass-approvals-and-sandbox`
            break
          case 'opencode':
            proc = $`opencode run --file ${tmpFile} "Follow the instructions in the attached file."`
            break
          default:
            die(`unknown tool: ${cfg.tool}`)
        }
        // Stream tool output to terminal live
        proc.pipe.stderr(process.stderr)
        proc.pipe.stdout(process.stderr)
        // Heartbeat + timeout
        const started = Date.now()
        const heartbeat = setInterval(() => {
          const elapsed = Math.round((Date.now() - started) / 1000)
          info(`still running... (${elapsed}s)`)
        }, 30_000)
        try {
          return await proc
        } finally {
          clearInterval(heartbeat)
        }
      })
    ))
    await fs.unlink(tmpFile).catch(() => {})

    if (toolErr) {
      log('ERROR', `tool error: ${toolErr.message || 'unknown'}`)
      const note = [
        `\n### Iteration ${N} — AI Tool Error (appended by loop)`,
        `**error:** ${toolErr.message || 'unknown'}`,
        '',
      ].join('\n')
      await fs.appendFile(cfg.status, note)
      await $`git add ${cfg.status}`
      await $`git commit -m ${'ralph(iteration-' + N + '): ai tool error'}`
      info('tool error, continuing to next iteration...')
      continue
    }

    let output = result.stdout
    log('INFO', `tool output: ${output.length} chars`)
    if (!cliOpts.verbose) info(`tool call (${output.length} chars)`)

    // Handle empty output
    if (!output.trim()) {
      const note = [
        `\n### Iteration ${N} — No Output (appended by loop)`,
        `**note:** agent produced no output`,
        '',
      ].join('\n')
      await fs.appendFile(cfg.status, note)
      await $`git add ${cfg.status}`
      await $`git commit -m ${'ralph(iteration-' + N + '): no output from agent'}`
      info('no output from agent, continuing...')
      continue
    }

    // ── Phase 3: Evaluate & Persist ──────────────────────────────────────

    // Quality checks
    let checksOk = true
    let failedCheck = null
    let failedOut = ''

    for (const check of cfg.quality_checks) {
      info(`quality check: ${check}`)
      const [, checkErr] = await attempt(() => $`bash -c ${check}`)
      if (checkErr) {
        checksOk = false
        failedCheck = check
        failedOut = ((checkErr.stderr || '') + '\n' + (checkErr.stdout || ''))
          .split('\n').slice(0, 50).join('\n')
        log('ERROR', `quality check failed: ${check}\n${failedOut}`)
        break
      }
    }

    if (!checksOk) {
      // Stash working changes, commit only the status update
      await attempt(() => $`git stash`)

      const note = [
        `\n### Iteration ${N} — Quality Check Failure (appended by loop)`,
        `**check:** ${failedCheck}`,
        `**output:** ${failedOut}`,
        `**stashed:** yes — next iteration can \`git stash pop\` to recover`,
        '',
      ].join('\n')
      await fs.appendFile(cfg.status, note)
      await $`git add ${cfg.status}`
      await $`git commit -m ${'ralph(iteration-' + N + '): quality check failed — ' + failedCheck}`
      info(`quality check failed: ${failedCheck}`)
    } else {
      // Read agent's commit message
      const [commitMsgRaw] = await attempt(() => fs.readFile(COMMIT_MSG_FILE, 'utf8'))
      const msg = commitMsgRaw?.trim().split('\n')[0] || 'completed iteration'

      // Commit all work
      const status = (await $`git status --porcelain`).stdout.trim()
      if (status) {
        await $`git add -A`
        await $`git commit -m ${'ralph(iteration-' + N + '): ' + msg}`
        log('INFO', `committed: ralph(iteration-${N}): ${msg}`)
        ok(`committed: ${msg}`)
      } else {
        log('INFO', 'no file changes to commit')
        info('no file changes to commit')
      }
    }

    // ── Phase 4: Loop or Exit ────────────────────────────────────────────

    if (checksOk && output.includes(COMPLETION_SIGIL)) {
      log('INFO', 'completion sigil detected — task complete')
      ok('task complete!')
      process.exit(0)
    }

    // Re-derive count from git for crash safety
    const updated = (await $`git log --oneline --grep=${grepPat} ${range}`).stdout.trim()
    const newCount = updated ? updated.split('\n').length : 0
    if (newCount >= cfg.max_iterations) {
      info(`max iterations reached (${cfg.max_iterations})`)
      process.exit(1)
    }
  }
}

// ── help ───────────────────────────────────────────────────────────────────

function cmdHelp() {
  console.log(`
${chalk.bold('ralph')} — autonomous coding loop

${chalk.yellow('Usage:')}
  ralph <command> [options]

${chalk.yellow('Commands:')}
  ${chalk.green('init')}              First-time scaffolding (no existing config)
  ${chalk.green('new')}               Reset loop cycle (config already exists)
  ${chalk.green('run')}               Run the iteration loop
  ${chalk.green('help')}              Show this help message

${chalk.yellow('Options:')}
  --prompt <paths>    Override prompt file(s), supports globs
  --status <path>     Override status report path
  --tool <name>       AI tool: claude | amp | codex | opencode
  --max <n>           Max iterations
  --dry-run           Print the assembled prompt, do not invoke AI
  --verbose           Stream truncated tool output (first 300 chars)
  --config <path>     Config file path (default: ./docs/ralph-loop/ralph.config.yml)

${chalk.yellow('Examples:')}
  ralph init                          # scaffold a new project
  ralph run                           # start the loop
  ralph run --dry-run                 # preview the assembled prompt
  ralph run --tool amp --max 5        # use amp with 5 iterations
  ralph new                           # reset cycle, keep config
`)
}

// ── Main ───────────────────────────────────────────────────────────────────

const needsLog = { init: true, new: true, run: true }
if (needsLog[command]) {
  const lf = await initLog()
  info(`log: ${lf}`)
}

switch (command) {
  case 'init': await cmdInit(); break
  case 'new':  await cmdNew(); break
  case 'run':  await cmdRun(); break
  default:     cmdHelp(); break
}
