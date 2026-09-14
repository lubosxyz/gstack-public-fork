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
import { describe, test, expect } from 'bun:test';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
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
    const argv = execFileSync('bash', ['-c', `printf '%s\\n' ${generateClaudeModelFlag(FAKE_CTX)}`], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim().split('\n');
    expect(argv).toEqual(['--model', 'claude-fable-5', '--effort', 'medium']);

    const overridden = execFileSync('bash', ['-c', `printf '%s\\n' ${generateClaudeModelFlag(FAKE_CTX)}`], {
      env: { ...process.env, GSTACK_CLAUDE_MODEL: 'claude-sonnet-4-6', GSTACK_CLAUDE_EFFORT: 'high' },
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
