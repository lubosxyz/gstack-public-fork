/**
 * Cross-family opposition defaults guard (owner decision 2026-09-14).
 *
 * gstack runs cross-family "opposition" — /codex review & challenge modes
 * asking Codex for a second opinion, and the /claude outside-voice skill
 * asking Claude for one from a non-Claude host. The owner decision pins
 * BOTH sides to MEDIUM reasoning effort by default (high/xhigh only by
 * explicit user choice) and to a NON-MOVING model alias:
 *   - Codex side: model stays the explicit frontier pin `gpt-6-astra`
 *     (CODEX_FRONTIER_MODEL); effort defaults to `medium` via
 *     GSTACK_CODEX_EFFORT (CODEX_REASONING_EFFORT_FLAG).
 *   - Claude side: model is pinned to `claude-fable-5` (CLAUDE_OPPOSITION_MODEL)
 *     — never the moving alias `claude-fable-5-1` and never a bare `fable`
 *     — with effort defaulting to `medium` via GSTACK_CLAUDE_EFFORT.
 *
 * These tests fail the build if either default ever regresses: to `high`
 * effort with no override path, or to `claude-fable-5-1` / a bare `fable`
 * as the Claude opposition model. Deliberately separate from
 * eval-model.test.ts, which covers the UNRELATED eval-harness
 * capture/judge model (CLAUDE_FRONTIER_EVAL_MODEL) — that one is allowed
 * to stay on claude-fable-5-1; only the opposition path is pinned here.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CODEX_FRONTIER_MODEL,
  CODEX_DEFAULT_EFFORT,
  CODEX_REASONING_EFFORT_FLAG,
} from '../scripts/resolvers/constants';
import { generateClaudeModelFlag } from '../scripts/resolvers/utility';
import { CLAUDE_OPPOSITION_MODEL, CLAUDE_FRONTIER_EVAL_MODEL } from '../lib/eval-model';
import type { TemplateContext } from '../scripts/resolvers/types';

const ROOT = path.join(import.meta.dir, '..');
// Minimal fake context — generateClaudeModelFlag ignores its argument.
const FAKE_CTX = {} as TemplateContext;

// Pure-Node file walk instead of shelling out to grep: the pattern this
// guard needs to match legitimately contains quote characters, which would
// have to fight shell quoting if piped through a `grep -E '<pattern>'`
// invocation. Walking in-process sidesteps that entirely.
function findFiles(dir: string, suffix: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.claude') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findFiles(full, suffix, out);
    else if (entry.name.endsWith(suffix)) out.push(full);
  }
  return out;
}

describe('Codex opposition (review/challenge) defaults to medium effort', () => {
  test('the shared effort flag defaults to medium and is env-overridable', () => {
    expect(CODEX_DEFAULT_EFFORT).toBe('medium');
    expect(CODEX_REASONING_EFFORT_FLAG).toBe(
      '-c "model_reasoning_effort=\\"${GSTACK_CODEX_EFFORT:-medium}\\""',
    );
  });

  test('the flag actually expands to medium by default and honors the env override', () => {
    const baseEnv: NodeJS.ProcessEnv = { ...process.env };
    delete baseEnv.GSTACK_CODEX_EFFORT;
    for (const [override, expected] of [['', 'medium'], ['high', 'high'], ['xhigh', 'xhigh']] as const) {
      const env = override ? { ...baseEnv, GSTACK_CODEX_EFFORT: override } : baseEnv;
      const argv = execFileSync('bash', ['-c', `printf '%s\\n' ${CODEX_REASONING_EFFORT_FLAG}`], {
        env, encoding: 'utf8', timeout: 5000,
      }).trim().split('\n');
      expect(argv).toEqual(['-c', `model_reasoning_effort="${expected}"`]);
    }
  });

  test('the model stays the explicit pinned frontier model, untouched by the effort change', () => {
    expect(CODEX_FRONTIER_MODEL).toBe('gpt-6-astra');
  });

  // Only the actual invocation lines matter here — prose documenting the
  // explicit `--high`/`--xhigh` override path legitimately mentions the
  // literal `model_reasoning_effort="high"`/`"xhigh"` strings as what to
  // substitute IN; that is the override mechanism, not a hardcoded default.
  function invocationLines(content: string): string[] {
    return content.split('\n').filter((l) => l.includes('_gstack_codex_timeout_wrapper'));
  }

  test('review-mode and challenge-mode sources invoke via the shared token, never a hardcoded high default', () => {
    for (const file of ['codex/sections/review-mode.md.tmpl', 'codex/sections/challenge-mode.md.tmpl']) {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf-8');
      const calls = invocationLines(src);
      expect(calls.length, `${file}: no codex invocation lines found`).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call, `${file} invocation still hardcodes a high default`).not.toContain('model_reasoning_effort="high"');
        expect(call, `${file} invocation lost the shared effort token`).toContain('{{CODEX_REASONING_EFFORT_FLAG}}');
      }
    }
  });

  test('rendered review-mode.md and challenge-mode.md resolve to the medium-default flag at every invocation', () => {
    for (const file of ['review-mode.md', 'challenge-mode.md']) {
      const rendered = fs.readFileSync(path.join(ROOT, 'codex', 'sections', file), 'utf-8');
      const calls = invocationLines(rendered);
      expect(calls.length, `${file}: no codex invocation lines found`).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call, `${file} invocation lost the resolved effort flag`).toContain(CODEX_REASONING_EFFORT_FLAG);
        expect(call).not.toContain('{{CODEX_REASONING_EFFORT_FLAG}}');
        expect(call, `${file} invocation still hardcodes a high default`).not.toContain('model_reasoning_effort="high"');
      }
    }
  });

  test('the generated codex/SKILL.md documents medium as the review/challenge default, not high', () => {
    const rendered = fs.readFileSync(path.join(ROOT, 'codex', 'SKILL.md'), 'utf-8');
    expect(rendered).toContain('Review (2A): `medium`');
    expect(rendered).toContain('Challenge (2B): `medium`');
    expect(rendered).toContain('GSTACK_CODEX_EFFORT');
  });

  test('--xhigh and --high both remain documented as explicit per-request overrides', () => {
    const rendered = fs.readFileSync(path.join(ROOT, 'codex', 'SKILL.md'), 'utf-8');
    expect(rendered).toContain('--xhigh');
    expect(rendered).toContain('--high');
  });
});

describe('Claude opposition (/claude outside voice) is pinned, never a moving alias', () => {
  test('CLAUDE_OPPOSITION_MODEL is exactly claude-fable-5', () => {
    expect(CLAUDE_OPPOSITION_MODEL).toBe('claude-fable-5');
  });

  test('the generated --model/--effort flag defaults to the pinned model at medium effort', () => {
    const flag = generateClaudeModelFlag(FAKE_CTX);
    expect(flag).toBe(
      '--model "${GSTACK_CLAUDE_MODEL:-claude-fable-5}" --effort "${GSTACK_CLAUDE_EFFORT:-medium}"',
    );
  });

  test('the flag actually expands to the pinned model + medium effort and honors env overrides', () => {
    // Strip every opposition-effort/model env var from the child process
    // before asserting the DEFAULT expansion — an ambient
    // GSTACK_CLAUDE_MODEL/GSTACK_CLAUDE_EFFORT/GSTACK_CODEX_EFFORT in the
    // *test runner's own* environment (e.g. someone running
    // `GSTACK_CLAUDE_EFFORT=high bun test ...`) must not leak into this
    // "no override" case and silently pass it off as the default.
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cleanEnv.GSTACK_CLAUDE_MODEL;
    delete cleanEnv.GSTACK_CLAUDE_EFFORT;
    delete cleanEnv.GSTACK_CODEX_EFFORT;

    const argv = execFileSync('bash', ['-c', `printf '%s\\n' ${generateClaudeModelFlag(FAKE_CTX)}`], {
      env: cleanEnv, encoding: 'utf8', timeout: 5000,
    }).trim().split('\n');
    expect(argv).toEqual(['--model', 'claude-fable-5', '--effort', 'medium']);

    const overridden = execFileSync('bash', ['-c', `printf '%s\\n' ${generateClaudeModelFlag(FAKE_CTX)}`], {
      env: { ...cleanEnv, GSTACK_CLAUDE_MODEL: 'claude-sonnet-4-6', GSTACK_CLAUDE_EFFORT: 'high' },
      encoding: 'utf8',
      timeout: 5000,
    }).trim().split('\n');
    expect(overridden).toEqual(['--model', 'claude-sonnet-4-6', '--effort', 'high']);
  });

  // Regression guard: `claude-fable-5-1` (or any `-latest`/moving-alias
  // spelling) or a bare `fable` must never become the OPPOSITION default
  // again. Matches only a *default* assignment shape (`:-claude-fable-5-1`,
  // `:-fable`, a bare `"fable"`/`'fable'` literal, or `= "claude-fable-5-1"`)
  // so this does not false-positive on prose mentioning the word "fable" or
  // on the deliberately-untouched eval-harness constant, which this test
  // asserts stays out of the opposition path instead (see next test).
  test('no opposition .tmpl source carries claude-fable-5-1 or a bare fable as a default model', () => {
    // A *default-assignment* shape only: `:-claude-fable-5-1`, `:-fable`, or a
    // bare quoted "fable"/'fable' literal — so this does not false-positive on
    // prose that merely mentions the word "fable" (e.g. in backticks).
    const BAD_PATTERN = /:-(claude-)?fable(-5-1|-latest)?[}"']|["']fable["']/;
    const hits: string[] = [];
    for (const dir of [path.join(ROOT, 'claude'), path.join(ROOT, 'codex')]) {
      for (const file of findFiles(dir, '.tmpl')) {
        const content = fs.readFileSync(file, 'utf-8');
        if (BAD_PATTERN.test(content)) hits.push(path.relative(ROOT, file));
      }
    }
    expect(hits).toEqual([]);
  });

  test('claude/SKILL.md.tmpl documents the pinned model and the effort override', () => {
    // Prose is allowed to name `claude-fable-5-1` as the alias to avoid (that's
    // how a reader learns not to reintroduce it) — the preceding test is the
    // one that fails the build on an actual default-assignment regression.
    const src = fs.readFileSync(path.join(ROOT, 'claude', 'SKILL.md.tmpl'), 'utf-8');
    expect(src).toContain('claude-fable-5');
    expect(src).toContain('GSTACK_CLAUDE_EFFORT');
  });

  test('the eval-harness frontier constant is untouched and stays separate from the opposition pin', () => {
    // Documents the deliberate split this guard relies on: changing the
    // eval-harness judge/capture model is a DIFFERENT decision than pinning
    // the opposition model, and must not happen as a side effect of this one.
    expect(CLAUDE_FRONTIER_EVAL_MODEL).toBe('claude-fable-5-1');
    expect(CLAUDE_OPPOSITION_MODEL).not.toBe(CLAUDE_FRONTIER_EVAL_MODEL);
  });
});

// ─── Repo-wide sweep (review round 1 finding, 2026-09-14) ──────────────────
//
// The narrower tests above only covered the `/codex` and `/claude` skills
// themselves. But "cross-family opposition" is not limited to those two
// entry points: /review, /ship, /spec, the design-outside-voice skills, and
// office-hours all launch Codex (or Claude) as an outside/adversarial voice
// too, via SHARED resolvers (generateAdversarialStep, generateCodexPlanReview,
// generateCodexDocReview, generateCodexSecondOpinion, generateDesignOutsideVoices,
// generateDesignReviewLite, generateDesignSketch — scripts/resolvers/review.ts
// and design.ts). Those resolvers used to hardcode `model_reasoning_effort="high"`
// independently of the `/codex` skill's own fix, so fixing only `/codex` left
// every one of those call sites — and every generated host's rendering of
// them — still defaulting to high. This sweep scans EVERY resolver, EVERY
// .tmpl source, and a FRESH render of EVERY configured host (not just
// claude/codex) so a new call site added anywhere in the future, or a
// regression in an existing one, fails here — not just in the two
// narrowly-scoped skills above.
describe('Repo-wide sweep — every resolver, template, and host output', () => {
  const ROOT_DIRS_TO_SCAN = ['scripts', 'claude', 'codex', 'lib', 'hosts'];
  const SWEEP_OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-opposition-sweep-'));

  beforeAll(() => {
    // One `--host all` render covers every host in ONE pass: the claude
    // host's own output lands at the out-dir root (e.g. `<out>/ship/SKILL.md`),
    // and every external host under its `<hostSubdir>/skills/gstack-*`
    // (e.g. `<out>/.agents/skills/gstack-claude/SKILL.md`) — see
    // scripts/gen-skill-docs.ts's per-host output routing.
    const result = Bun.spawnSync(
      ['bun', 'run', 'scripts/gen-skill-docs.ts', '--host', 'all', '--out-dir', SWEEP_OUT],
      { cwd: ROOT, timeout: 180_000 },
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `sweep beforeAll: gen-skill-docs --host all --out-dir failed (exit ${result.exitCode}):\n`
        + result.stderr.toString(),
      );
    }
  });

  afterAll(() => {
    fs.rmSync(SWEEP_OUT, { recursive: true, force: true });
  });

  // ── Review round 2 finding (2026-09-14) ──────────────────────────────────
  // The original line-based scan missed a real regression shape: a codex
  // prompt argument can span MANY lines (real, unescaped newlines inside the
  // double-quoted string — see design-review's generated multi-paragraph
  // prompt), so "codex exec" lands on one line and the `-c
  // 'model_reasoning_effort="..."'` flag that closes the same shell command
  // lands dozens of lines later. Per-line matching never puts both on the
  // same string, so a regression to a hardcoded high hidden behind a
  // multi-line prompt passed both the source scan and the all-host render
  // scan with ZERO reported violations (confirmed by the reviewer with an
  // in-memory mutation).
  //
  // Fix: scan whole FENCED CODE BLOCKS instead of individual lines. Every
  // real invocation (with its surrounding `TMPERR=...`/exit-handling
  // scaffolding) lives inside exactly one ` ```bash ` fence in this
  // codebase; prose ABOUT the override mechanism (e.g. "replace X with the
  // literal `-c 'model_reasoning_effort=\"xhigh\"'` for that call") is
  // always plain paragraph text OUTSIDE any fence. Scanning per-block:
  //   - reunites a multi-line prompt with the flags that follow it (no more
  //     false negative from a line split), and
  //   - still can't false-positive on the override-documentation prose,
  //     because that prose never sits inside a fence.
  // .ts resolver SOURCE files spell their fences as escaped `\`\`\`` (they're
  // themselves JS template literals delimited by backtick), never a literal
  // ``` — normalized away before splitting so one implementation covers both
  // resolver source and rendered markdown.
  function extractFencedBlocks(content: string): string[] {
    const normalized = content.replace(/\\`/g, '`');
    const parts = normalized.split(/`{3,}/);
    const blocks: string[] = [];
    for (let i = 1; i < parts.length; i += 2) blocks.push(parts[i]);
    return blocks;
  }
  // A real Codex launch always contains one of these two subcommands
  // somewhere in its fenced block (possibly many lines before the flags).
  function containsCodexInvocation(block: string): boolean {
    return block.includes('codex exec') || block.includes('codex review');
  }
  // A real Claude outside-voice launch pipes into `$CLAUDE_BIN -p`.
  function containsClaudeInvocation(block: string): boolean {
    return block.includes('CLAUDE_BIN" -p');
  }
  function hasHardcodedHighOrXhigh(block: string): boolean {
    return block.includes('model_reasoning_effort="high"') || block.includes('model_reasoning_effort="xhigh"');
  }
  function summarize(block: string): string {
    return block.trim().replace(/\s+/g, ' ').slice(0, 260);
  }

  function scanForCodexEffortViolations(root: string, suffix: string): string[] {
    const violations: string[] = [];
    for (const file of findFiles(root, suffix)) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const block of extractFencedBlocks(content)) {
        if (containsCodexInvocation(block) && hasHardcodedHighOrXhigh(block)) {
          violations.push(`${path.relative(root, file)}: ${summarize(block)}`);
        }
      }
    }
    return violations;
  }

  function scanForClaudeEffortViolations(root: string, suffix: string): { violations: string[]; checked: number } {
    const violations: string[] = [];
    let checked = 0;
    for (const file of findFiles(root, suffix)) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const block of extractFencedBlocks(content)) {
        if (!containsClaudeInvocation(block)) continue;
        checked++;
        const rel = path.relative(root, file);
        if (block.includes('claude-fable-5-1')) {
          violations.push(`${rel}: pins claude-fable-5-1: ${summarize(block)}`);
        }
        if (!block.includes('--effort')) {
          violations.push(`${rel}: missing --effort flag: ${summarize(block)}`);
        }
      }
    }
    return { violations, checked };
  }

  test('no resolver .ts file hardcodes a Codex opposition/outside-voice default of high or xhigh', () => {
    const violations = ROOT_DIRS_TO_SCAN.flatMap((d) => scanForCodexEffortViolations(path.join(ROOT, d), '.ts'));
    expect(violations).toEqual([]);
  });

  test('no .tmpl source anywhere hardcodes a Codex opposition/outside-voice default of high or xhigh', () => {
    const violations = scanForCodexEffortViolations(ROOT, '.tmpl');
    expect(violations).toEqual([]);
  });

  test('a fresh render of EVERY configured host has zero hardcoded Codex high/xhigh invocation defaults', () => {
    const violations = scanForCodexEffortViolations(SWEEP_OUT, '.md');
    expect(violations).toEqual([]);
  });

  test('a fresh render of EVERY configured host resolves at least one Codex opposition/outside-voice call through the shared flag', () => {
    // Guards the guard: if the resolvers stopped emitting Codex invocations
    // at all (e.g. a refactor silently dropped the feature), the previous
    // "zero violations" test would trivially pass on zero call sites. Assert
    // real coverage: the rendered claude-host tree alone (ship/review/spec/
    // design-* etc., all under SWEEP_OUT root) must contain the resolved
    // flag's exact expansion at least once.
    let found = 0;
    for (const file of findFiles(SWEEP_OUT, '.md')) {
      const content = fs.readFileSync(file, 'utf-8');
      if (content.includes(CODEX_REASONING_EFFORT_FLAG)) found++;
    }
    expect(found).toBeGreaterThan(0);
  });

  test('every generated Claude outside-voice invocation, on every host, is pinned and carries --effort — never claude-fable-5-1', () => {
    const { violations, checked } = scanForClaudeEffortViolations(SWEEP_OUT, '.md');
    // Guards the guard: fail loud if the sweep somehow found no Claude
    // invocation blocks at all, rather than silently passing on zero coverage.
    expect(checked, 'no Claude outside-voice invocation blocks found across any host — sweep is broken').toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  describe('negative controls — the sweep must actually catch a regression', () => {
    // These feed the scanner SYNTHETIC content that reproduces the exact
    // shape of the round-2 miss (a multi-line prompt separating "codex exec"
    // from the flags that hardcode high) and assert it is CAUGHT — proving
    // the fence-block rewrite above actually closes the gap, not just that
    // it still passes on today's (already-fixed) real files.
    let scratch: string;
    beforeAll(() => { scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-opposition-negctl-')); });
    afterAll(() => { fs.rmSync(scratch, { recursive: true, force: true }); });

    test('catches a multi-line design-review-shaped GENERATED command with a hardcoded high', () => {
      // Mirrors design-review/SKILL.md's real shape: a `codex exec "..."`
      // prompt argument containing several literal newlines, only closing
      // (with the effort flag) many lines later — exactly what a regression
      // to design.ts's old `isDesignReview ? 'high' : 'medium'` branch would
      // render.
      const synthetic = [
        '## Design Outside Voices',
        '',
        '```bash',
        'TMPERR_DESIGN=$(mktemp /tmp/codex-design-XXXXXXXX)',
        '_REPO_ROOT=$(git rev-parse --show-toplevel) || { echo "ERROR: not in a git repo" >&2; exit 1; }',
        'codex exec "Review the frontend source code in this repo. Evaluate against these design hard rules:',
        '- Spacing: systematic (design tokens / CSS variables) or magic numbers?',
        '- Typography: expressive purposeful fonts or default stacks?',
        '',
        'LITMUS CHECKS — answer YES/NO:',
        '1. Brand/product unmistakable in first screen?',
        '',
        'Be specific. Reference file:line for every finding." -C "$_REPO_ROOT" -s read-only -c "model=\\"gpt-6-astra\\"" -c \'model_reasoning_effort="high"\' -c \'web_search="cached"\' < /dev/null 2>"$TMPERR_DESIGN"',
        '```',
        '',
      ].join('\n');
      const file = path.join(scratch, 'fake-design-review-SKILL.md');
      fs.writeFileSync(file, synthetic);
      const violations = scanForCodexEffortViolations(scratch, '.md');
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toContain('fake-design-review-SKILL.md');
      fs.rmSync(file);
    });

    test('catches the same regression shape in a RESOLVER-SOURCE (.ts) mutation, escaped-backtick fences included', () => {
      // Reproduces the bug class directly in a scripts/resolvers/*.ts-shaped
      // file: a hardcoded high on the codex invocation, with a multi-line
      // prompt separating "codex exec" from the flag that closes it, inside
      // a JS template literal whose markdown fences are ESCAPED (`\`\`\`bash`,
      // not a literal ```) because the real backtick is the template
      // literal's own delimiter — exactly how review.ts/design.ts render
      // their fenced bash blocks. Proves extractFencedBlocks' backtick
      // normalization + multi-line reunification also works on resolver
      // source, not just rendered markdown.
      const lines = [
        'export function generateDesignOutsideVoicesFAKE(_ctx) {',
        '  // REGRESSION: hardcoded high instead of CODEX_REASONING_EFFORT_FLAG.',
        '  return `',
        '1. **Codex design voice** (via Bash):',
        '\\`\\`\\`bash',
        'TMPERR_DESIGN=$(mktemp /tmp/codex-design-XXXXXXXX)',
        '_REPO_ROOT=$(git rev-parse --show-toplevel) || { echo "ERROR: not in a git repo" >&2; exit 1; }',
        'codex exec "Review the frontend source code in this repo. Evaluate against these design hard rules:',
        '- Spacing: systematic (design tokens / CSS variables) or magic numbers?',
        '',
        'Be specific." -C "$_REPO_ROOT" -s read-only ${CODEX_MODEL_CONFIG_FLAG} -c \'model_reasoning_effort="high"\' ${CODEX_WEB_SEARCH_FLAG} < /dev/null 2>"$TMPERR_DESIGN"',
        '\\`\\`\\`',
        '`;',
        '}',
      ];
      const file = path.join(scratch, 'fake-design-resolver.ts');
      fs.writeFileSync(file, lines.join('\n'));
      const violations = scanForCodexEffortViolations(scratch, '.ts');
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toContain('fake-design-resolver.ts');
      fs.rmSync(file);
    });
  });
});
