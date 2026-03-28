#!/usr/bin/env zx

// ralph.mjs test suite
// Runs each test in an isolated tmp/ git repo

$.verbose = false

const RALPH = path.resolve(__dirname, '..', 'src', 'ralph.mjs')
const TMP_ROOT = path.resolve(__dirname, '..', 'tmp')

let passed = 0
let failed = 0
const failures = []

async function setup() {
  const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const dir = path.join(TMP_ROOT, id)
  await fs.mkdir(dir, { recursive: true })
  await $`git -C ${dir} init`
  await $`git -C ${dir} config user.email "test@test.com"`
  await $`git -C ${dir} config user.name "Test"`
  // Initial commit so HEAD exists
  await fs.writeFile(path.join(dir, '.gitkeep'), '')
  await $`git -C ${dir} add .gitkeep`
  await $`git -C ${dir} commit -m "initial"`
  return dir
}

async function teardown(dir) {
  await fs.rm(dir, { recursive: true, force: true })
}

async function test(name, fn) {
  let dir
  try {
    dir = await setup()
    await fn(dir)
    passed++
    console.log(chalk.green(`  ✓ ${name}`))
  } catch (err) {
    failed++
    failures.push({ name, error: err.message || String(err) })
    console.log(chalk.red(`  ✗ ${name}`))
    console.log(chalk.gray(`    ${err.message || err}`))
  } finally {
    if (dir) await teardown(dir)
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed')
}

// ── Tests ──────────────────────────────────────────────────────────────────

console.log(chalk.bold('\nralph.mjs test suite\n'))

// -- help --

await test('help: prints usage when no command given', async (dir) => {
  const result = await $`cd ${dir} && zx ${RALPH}`
  assert(result.stdout.includes('autonomous coding loop'), 'should contain description')
  assert(result.stdout.includes('init'), 'should list init command')
  assert(result.stdout.includes('run'), 'should list run command')
  assert(result.stdout.includes('new'), 'should list new command')
})

await test('help: prints usage with explicit help command', async (dir) => {
  const result = await $`cd ${dir} && zx ${RALPH} help`
  assert(result.stdout.includes('autonomous coding loop'), 'should contain description')
})

// -- init --

await test('init: creates config, status, and prompt files', async (dir) => {
  await $`cd ${dir} && zx ${RALPH} init`
  const cfg = await fs.readFile(path.join(dir, 'docs/ralph-loop/ralph.config.yml'), 'utf8')
  const status = await fs.readFile(path.join(dir, 'docs/ralph-loop/ralph-status.md'), 'utf8')
  const prompt = await fs.readFile(path.join(dir, 'docs/ralph-loop/ralph-prompt.md'), 'utf8')

  assert(cfg.includes('anchor:'), 'config should have anchor')
  assert(cfg.includes('tool:'), 'config should have tool')
  assert(status.includes('Status Report'), 'status should have header')
  assert(prompt.includes('Goal'), 'prompt should have template content')
})

await test('init: anchor SHA is set and valid', async (dir) => {
  await $`cd ${dir} && zx ${RALPH} init`
  const cfg = await fs.readFile(path.join(dir, 'docs/ralph-loop/ralph.config.yml'), 'utf8')
  const anchorMatch = cfg.match(/anchor:\s*([a-f0-9]+)/)
  assert(anchorMatch, 'should have an anchor SHA')

  // Verify the anchor exists in git
  const anchor = anchorMatch[1]
  const result = await $`git -C ${dir} cat-file -t ${anchor}`
  assert(result.stdout.trim() === 'commit', 'anchor should point to a commit')
})

await test('init: commit messages follow convention', async (dir) => {
  await $`cd ${dir} && zx ${RALPH} init`
  const log = (await $`git -C ${dir} log --oneline -2`).stdout.trim()
  assert(log.includes('ralph(init):'), 'should have ralph(init): commit')
  assert(log.includes('ralph(anchor):'), 'should have ralph(anchor): commit')
})

await test('init: refuses if config already exists', async (dir) => {
  await $`cd ${dir} && zx ${RALPH} init`
  try {
    await $`cd ${dir} && zx ${RALPH} init`
    assert(false, 'should have exited with error')
  } catch (err) {
    assert(err.stderr.includes('already exists'), 'should mention config exists')
  }
})

await test('init: creates log file in docs/ralph-loop/logs/', async (dir) => {
  await $`cd ${dir} && zx ${RALPH} init`
  const logDir = path.join(dir, 'docs/ralph-loop/logs')
  const files = await fs.readdir(logDir)
  const logFiles = files.filter(f => f.startsWith('ralph-') && f.endsWith('.log'))
  assert(logFiles.length === 1, `expected 1 log file, found ${logFiles.length}`)

  const content = await fs.readFile(path.join(logDir, logFiles[0]), 'utf8')
  assert(content.includes('# ralph log'), 'log should have header')
  assert(content.includes('[INFO]'), 'log should have INFO entries')
})

// -- new --

await test('new: resets status and moves anchor', async (dir) => {
  await $`cd ${dir} && zx ${RALPH} init`
  const cfg1 = await fs.readFile(path.join(dir, 'docs/ralph-loop/ralph.config.yml'), 'utf8')
  const anchor1 = cfg1.match(/anchor:\s*([a-f0-9]+)/)[1]

  await $`cd ${dir} && zx ${RALPH} new`
  const cfg2 = await fs.readFile(path.join(dir, 'docs/ralph-loop/ralph.config.yml'), 'utf8')
  const anchor2 = cfg2.match(/anchor:\s*([a-f0-9]+)/)[1]

  assert(anchor1 !== anchor2, 'anchor should have moved')

  const status = await fs.readFile(path.join(dir, 'docs/ralph-loop/ralph-status.md'), 'utf8')
  assert(status === '', 'status should be empty after reset')
})

await test('new: commit messages follow convention', async (dir) => {
  await $`cd ${dir} && zx ${RALPH} init`
  await $`cd ${dir} && zx ${RALPH} new`
  const log = (await $`git -C ${dir} log --oneline -2`).stdout.trim()
  assert(log.includes('ralph(reset):'), 'should have ralph(reset): commit')
  assert(log.includes('ralph(anchor):'), 'should have ralph(anchor): commit')
})

await test('init: anchor is reachable from HEAD (survives gc)', async (dir) => {
  await $`cd ${dir} && zx ${RALPH} init`
  const cfg = await fs.readFile(path.join(dir, 'docs/ralph-loop/ralph.config.yml'), 'utf8')
  const anchor = cfg.match(/anchor:\s*([a-f0-9]+)/)[1]

  // Anchor should be an ancestor of HEAD, not a dangling commit
  await $`git -C ${dir} merge-base --is-ancestor ${anchor} HEAD`

  // Force aggressive GC — anchor must survive
  await $`git -C ${dir} reflog expire --expire=now --all`
  await $`git -C ${dir} gc --prune=now`
  const result = await $`git -C ${dir} cat-file -t ${anchor}`
  assert(result.stdout.trim() === 'commit', 'anchor should survive GC')
})

await test('new: anchor is reachable from HEAD (survives gc)', async (dir) => {
  await $`cd ${dir} && zx ${RALPH} init`
  await $`cd ${dir} && zx ${RALPH} new`
  const cfg = await fs.readFile(path.join(dir, 'docs/ralph-loop/ralph.config.yml'), 'utf8')
  const anchor = cfg.match(/anchor:\s*([a-f0-9]+)/)[1]

  await $`git -C ${dir} merge-base --is-ancestor ${anchor} HEAD`

  await $`git -C ${dir} reflog expire --expire=now --all`
  await $`git -C ${dir} gc --prune=now`
  const result = await $`git -C ${dir} cat-file -t ${anchor}`
  assert(result.stdout.trim() === 'commit', 'anchor should survive GC')
})

await test('new: anchor commit is excluded from iteration count', async (dir) => {
  await $`cd ${dir} && zx ${RALPH} init`
  await $`cd ${dir} && zx ${RALPH} new`
  const cfg = await fs.readFile(path.join(dir, 'docs/ralph-loop/ralph.config.yml'), 'utf8')
  const anchor = cfg.match(/anchor:\s*([a-f0-9]+)/)[1]

  // Commits in anchor..HEAD should not match iteration pattern
  const log = (await $`git -C ${dir} log --oneline --grep=${'ralph(iteration-'} ${anchor}..HEAD`).stdout.trim()
  assert(log === '', 'no iteration commits should exist after fresh reset')
})

await test('new: refuses without existing config', async (dir) => {
  try {
    await $`cd ${dir} && zx ${RALPH} new`
    assert(false, 'should have exited with error')
  } catch (err) {
    assert(err.stderr.includes('no config'), 'should mention missing config')
  }
})

await test('new: removes .ralph-commit-msg if present', async (dir) => {
  await $`cd ${dir} && zx ${RALPH} init`
  await fs.writeFile(path.join(dir, 'docs/ralph-loop/.ralph-commit-msg'), 'old message')
  await $`cd ${dir} && zx ${RALPH} new`
  const msgExists = await fs.access(path.join(dir, 'docs/ralph-loop/.ralph-commit-msg')).then(() => true).catch(() => false)
  assert(!msgExists, '.ralph-commit-msg should be removed')
})

// -- run --

await test('run: refuses without config', async (dir) => {
  try {
    await $`cd ${dir} && zx ${RALPH} run`
    assert(false, 'should have exited with error')
  } catch (err) {
    assert(err.stderr.includes('no config'), 'should mention missing config')
  }
})

await test('run --dry-run: outputs assembled prompt without invoking tool', async (dir) => {
  await $`cd ${dir} && zx ${RALPH} init`
  // Write a real prompt
  await fs.writeFile(path.join(dir, 'docs/ralph-loop/ralph-prompt.md'), '# Test Task\n\nDo the thing.\n')
  await $`git -C ${dir} add -A`
  await $`git -C ${dir} commit -m "update prompt"`

  const result = await $`cd ${dir} && zx ${RALPH} run --dry-run`
  const out = result.stdout

  // Preamble
  assert(out.includes('Ralph Loop — Iteration 1'), 'should show iteration 1')
  assert(out.includes('Environment'), 'should have environment block')
  assert(out.includes('Available tools'), 'should list tools')
  assert(out.includes('Git History'), 'should have git history section')
  assert(out.includes('Current Status Report'), 'should have status section')

  // User prompt
  assert(out.includes('Test Task'), 'should include user prompt')
  assert(out.includes('Do the thing'), 'should include prompt body')

  // Postamble
  assert(out.includes('Post-Task Instructions'), 'should have postamble')
  assert(out.includes('docs/ralph-loop/.ralph-commit-msg'), 'should mention commit msg file')
  assert(out.includes('COMPLETE'), 'should mention completion sigil')
})

await test('run --dry-run: detects OS and shell', async (dir) => {
  await $`cd ${dir} && zx ${RALPH} init`
  const result = await $`cd ${dir} && zx ${RALPH} run --dry-run`
  const out = result.stdout

  assert(out.includes('**OS:**'), 'should have OS line')
  assert(out.includes('**Shell:**'), 'should have shell line')
  assert(out.includes('**Node:**'), 'should have node version')
  assert(out.includes('**CWD:**'), 'should have CWD')
})

await test('run --dry-run: handles multiple prompt files', async (dir) => {
  await $`cd ${dir} && zx ${RALPH} init`

  await fs.writeFile(path.join(dir, 'prompt-a.md'), '# Part A\nFirst part.\n')
  await fs.writeFile(path.join(dir, 'prompt-b.md'), '# Part B\nSecond part.\n')
  await $`git -C ${dir} add -A`
  await $`git -C ${dir} commit -m "add prompts"`

  const result = await $`cd ${dir} && zx ${RALPH} run --dry-run --prompt prompt-a.md --prompt prompt-b.md`
  assert(result.stdout.includes('Part A'), 'should include first prompt')
  assert(result.stdout.includes('Part B'), 'should include second prompt')
})

await test('run --dry-run: respects --max and --tool flags', async (dir) => {
  await $`cd ${dir} && zx ${RALPH} init`
  const result = await $`cd ${dir} && zx ${RALPH} run --dry-run --max 5`
  assert(result.stdout.includes('Iteration 1 of 5'), 'should show max 5')
})

await test('run --dry-run: shows first-iteration status message', async (dir) => {
  await $`cd ${dir} && zx ${RALPH} init`
  const result = await $`cd ${dir} && zx ${RALPH} run --dry-run`
  assert(
    result.stdout.includes('first iteration') || result.stdout.includes('No prior work'),
    'should indicate first iteration'
  )
})

await test('run --dry-run: log file captures prompt size', async (dir) => {
  await $`cd ${dir} && zx ${RALPH} init`
  await $`cd ${dir} && zx ${RALPH} run --dry-run`
  const logDir = path.join(dir, 'docs/ralph-loop/logs')
  const files = (await fs.readdir(logDir)).filter(f => f.endsWith('.log'))
  // Find the log from the run (not from init)
  const logs = await Promise.all(files.map(async f => ({
    name: f,
    content: await fs.readFile(path.join(logDir, f), 'utf8'),
  })))
  const runLog = logs.find(l => l.content.includes('command: run'))
  assert(runLog, 'should have a log from the run command')
  assert(runLog.content.includes('prompt assembled'), 'should log prompt assembly')
  assert(runLog.content.includes('dry-run'), 'should log dry-run mode')
})

// -- config --

await test('init: custom --config path works', async (dir) => {
  await $`cd ${dir} && zx ${RALPH} init --config custom.yml`
  const exists = await fs.access(path.join(dir, 'custom.yml')).then(() => true).catch(() => false)
  assert(exists, 'custom config file should exist')
})

// ── Summary ────────────────────────────────────────────────────────────────

console.log('')
if (failed > 0) {
  console.log(chalk.red(`${failed} failed`), chalk.green(`${passed} passed`), `of ${passed + failed}`)
  for (const f of failures) {
    console.log(chalk.red(`  ✗ ${f.name}: ${f.error}`))
  }
  process.exit(1)
} else {
  console.log(chalk.green(`all ${passed} tests passed`))
}
