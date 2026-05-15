import { NextRequest, NextResponse } from 'next/server';
import { getDb, type PullRow, type IssueRow } from '@/lib/db';
import { isValidModelId, type ModelId } from '@/lib/models';
import { complete, MissingApiKeyError } from '@/lib/ai';

export const dynamic = 'force-dynamic';

// User-supplied review prompt — kept verbatim so the model produces the exact
// section structure the reviewer asked for. Trimmed only of trailing newlines.
const SYSTEM_PROMPT = `Review the implemented PR against the target issue before submission.

Goal:
Act as a strict maintainer reviewing this PR. Verify whether the implementation is valid, minimal, competitive, and correctly fixes the target issue. Do not make changes unless explicitly asked; first produce review findings.

Project context:
Inspect and follow the repository's:
- CONTRIBUTING / DEVELOPING docs
- PR template
- issue template, if relevant
- changelog or release-note rules
- package/build/test configuration
- CI workflow files
- nearby code and tests
- recent accepted PRs touching similar code, if available

Review scope:

1. Issue correctness
- Re-read the issue and analysis.
- Confirm the implementation addresses the confirmed root cause.
- Confirm it fixes the reported behavior, not just a symptom.
- Confirm all edge cases from the analysis are handled.
- Confirm the PR does not change unrelated behavior.
- Confirm \`Closes #N\` would be accurate.

2. Diff quality
Inspect the full diff:
- no unrelated changes
- no redundant code
- no duplicated logic
- no unnecessary abstractions
- no overengineering
- no formatting-only churn
- no extra whitespace
- no accidental import reorder
- no debug code, TODOs, FIXMEs, logs, or commented-out code
- no new dependency unless clearly justified

3. Bug and regression risk
Check for:
- null/None handling issues
- empty input/collection issues
- off-by-one errors
- incorrect error handling
- broken compatibility or public API behavior
- performance regressions
- concurrency/state issues, if relevant
- platform/path/version assumptions
- flaky or order-dependent behavior

4. Test quality
Verify:
- regression test fails before the fix and passes after it, if feasible
- tests cover the root cause
- tests cover edge cases from the analysis
- assertions are specific
- tests follow project naming/style/fixture conventions
- tests are deterministic and isolated
- no obsolete or weakened tests were introduced

5. Merge readiness
Check:
- branch is based on the correct target branch
- no merge conflicts
- working tree contains only intended changes
- relevant tests/lint/type checks pass
- PR description accurately explains root cause, fix, and tests

Output format:

## Verdict
Choose one:
- Ready to submit
- Needs small cleanup
- Needs functional changes
- Not valid for this issue

## Blocking Findings
List only issues that must be fixed before PR submission. Include file paths and line references.

## Non-Blocking Suggestions
List optional improvements only if they materially improve review quality.

## Issue-Fix Validation
Explain whether the PR correctly fixes the target issue and why.

## Diff Quality Review
Comment on redundancy, duplication, whitespace, unrelated changes, and maintainability.

## Test Review
Assess regression coverage, edge cases, and test quality.

## Verification
List commands run and results.

## Final Recommendation
Submit, revise first, or reconsider the approach.`;

const VERDICT_RE = /^##\s*Verdict\s*\n+([^\n#]+)/im;

function extractVerdict(markdown: string): string {
  const m = markdown.match(VERDICT_RE);
  if (!m) return 'uncertain';
  const line = m[1].trim().replace(/^[-*]\s*/, '');
  // Map the prompt's four-option vocabulary to a short single token for the
  // DB column (the full text stays in `reasoning`).
  const lower = line.toLowerCase();
  if (lower.startsWith('ready')) return 'ready';
  if (lower.startsWith('needs small')) return 'needs_cleanup';
  if (lower.startsWith('needs functional')) return 'needs_changes';
  if (lower.startsWith('not valid')) return 'invalid';
  return lower.split(/\s+/).slice(0, 2).join('_');
}

interface PrValidateResp {
  ai: {
    verdict: string;
    markdown: string;
    cached: boolean;
    generated_at: string;
    model: ModelId;
    tokens_in?: number;
    tokens_out?: number;
    error?: string;
    missing_key?: 'anthropic' | 'openai';
  } | null;
  pr: { number: number; title: string; html_url: string | null };
  linked_issues: Array<{ number: number; title: string; state: string; state_reason: string | null }>;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { owner: string; name: string; number: string } }
) {
  const owner = params.owner;
  const name = params.name;
  const num = parseInt(params.number, 10);
  const repoFullName = `${owner}/${name}`;

  let modelId: ModelId | null = null;
  let effort: 'low' | 'medium' | 'high' | 'max' = 'max';
  let thinking = true;
  try {
    const body = await req.json().catch(() => null);
    if (body?.model && isValidModelId(body.model)) modelId = body.model;
    if (body?.effort === 'low' || body?.effort === 'medium' || body?.effort === 'high' || body?.effort === 'max') {
      effort = body.effort;
    }
    if (typeof body?.thinking === 'boolean') thinking = body.thinking;
  } catch {
    /* no body */
  }

  const db = getDb();
  const pr = db
    .prepare(
      `SELECT id, repo_full_name, number, title, body, state, draft, merged,
              author_login, created_at, updated_at, closed_at, merged_at,
              html_url, fetched_at, first_seen_at
       FROM pulls WHERE repo_full_name = ? AND number = ?`,
    )
    .get(repoFullName, num) as PullRow | undefined;

  if (!pr) {
    return NextResponse.json({ error: 'PR not found in cache. Open the repo page first to fetch it.' }, { status: 404 });
  }

  const linkedIssues = db
    .prepare(
      `SELECT i.number, i.title, i.state, i.state_reason, i.body
       FROM pr_issue_links l
       JOIN issues i ON i.repo_full_name = l.repo_full_name AND i.number = l.issue_number
       WHERE l.repo_full_name = ? AND l.pr_number = ?`,
    )
    .all(repoFullName, num) as Array<{ number: number; title: string; state: string; state_reason: string | null; body: string | null }>;

  const baseResp: PrValidateResp = {
    ai: null,
    pr: { number: pr.number, title: pr.title, html_url: pr.html_url },
    linked_issues: linkedIssues.map((i) => ({ number: i.number, title: i.title, state: i.state, state_reason: i.state_reason })),
  };

  if (!modelId) return NextResponse.json(baseResp);

  // Cached verdict — single PR + model lookup keyed on the same shape as the
  // issue verdict cache. Returns immediately when present.
  const cached = db
    .prepare(
      `SELECT verdict, reasoning, created_at FROM ai_pr_verdicts
       WHERE repo_full_name = ? AND pr_number = ? AND model = ?`,
    )
    .get(repoFullName, num, modelId) as { verdict: string; reasoning: string; created_at: string } | undefined;

  if (cached) {
    return NextResponse.json({
      ...baseResp,
      ai: {
        verdict: cached.verdict,
        markdown: cached.reasoning ?? '',
        cached: true,
        generated_at: cached.created_at,
        model: modelId,
      },
    } as PrValidateResp);
  }

  const userPrompt = buildUserPrompt(pr, linkedIssues);

  try {
    const result = await complete(modelId, SYSTEM_PROMPT, userPrompt, 4000, { effort, thinking });
    const markdown = result.text;
    const verdict = extractVerdict(markdown);

    db.prepare(
      `INSERT OR REPLACE INTO ai_pr_verdicts (repo_full_name, pr_number, model, verdict, reasoning, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(repoFullName, num, modelId, verdict, markdown, new Date().toISOString());

    return NextResponse.json({
      ...baseResp,
      ai: {
        verdict,
        markdown,
        cached: false,
        generated_at: new Date().toISOString(),
        model: modelId,
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
      },
    } as PrValidateResp);
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json({
        ...baseResp,
        ai: {
          verdict: 'error',
          markdown: '',
          cached: false,
          generated_at: new Date().toISOString(),
          model: modelId,
          error: err.message,
          missing_key: err.provider,
        },
      } as PrValidateResp);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      ...baseResp,
      ai: {
        verdict: 'error',
        markdown: '',
        cached: false,
        generated_at: new Date().toISOString(),
        model: modelId,
        error: msg,
      },
    } as PrValidateResp);
  }
}

function buildUserPrompt(
  pr: PullRow,
  issues: Array<{ number: number; title: string; state: string; state_reason: string | null; body: string | null }>,
): string {
  const prBody = (pr.body ?? '').slice(0, 8000);
  const stateLabel = pr.merged ? 'merged' : pr.draft ? 'draft' : pr.state;
  const issuesBlock = issues.length === 0
    ? '(no issues linked via closes/fixes/sidebar)'
    : issues
        .map((i) => {
          const reason = i.state_reason ? ` / ${i.state_reason}` : '';
          const body = (i.body ?? '').slice(0, 4000);
          return `--- Issue #${i.number}: ${i.title} (${i.state}${reason}) ---\n${body || '(empty body)'}\n--- End issue #${i.number} ---`;
        })
        .join('\n\n');
  return `Repository: ${pr.repo_full_name}
PR #${pr.number}: ${pr.title}
State: ${stateLabel}
Author: ${pr.author_login ?? 'unknown'}
Created: ${pr.created_at ?? 'unknown'}
URL: ${pr.html_url ?? 'unknown'}

--- PR description ---
${prBody || '(empty)'}
--- End PR description ---

--- Linked issues ---
${issuesBlock}
--- End linked issues ---

The PR diff itself is not provided to you here — base your review on the PR description, linked issue context, and any code references the description includes. If the PR description is too thin to verify the diff against the issue, say so explicitly under "Verification" and recommend reviewing the actual diff on GitHub.`;
}
