import { NextRequest, NextResponse } from 'next/server';
import { getDb, IssueRow } from '@/lib/db';
import { isValidModelId, type ModelId } from '@/lib/models';
import { runDeterministicChecks, predictScore } from '@/lib/validate';
import type { IssueDto } from '@/lib/api-types';
import { complete, MissingApiKeyError } from '@/lib/ai';

export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `You are an expert open-source contributor evaluating GitHub issues for a SN74 (Gittensor) miner.
Your job: judge whether the issue is a GOOD candidate to fix — meaning:
- The bug or feature is clearly described and reproducible
- The scope is bounded enough to fix in a single PR
- The maintainer is likely to merge a quality fix

Respond strictly in compact JSON with these keys:
{
  "ai_verdict": "valid" | "invalid" | "uncertain",
  "confidence": 0.0-1.0,
  "engineering_effort": "small" | "medium" | "large",
  "reasoning": "<2-4 short sentences explaining the verdict>",
  "risks": ["<short risk 1>", "<short risk 2>"]
}
"engineering_effort" is the amount of human coding work required to fix the issue (NOT how hard you should think about your verdict).
No markdown, no preamble. Output JSON only.`;

// Older cached verdicts stored the field as "effort"; map it forward so the UI sees one consistent name.
function normalizeVerdict(parsed: Record<string, unknown>): Record<string, unknown> {
  if (parsed.engineering_effort === undefined && parsed.effort !== undefined) {
    const { effort, ...rest } = parsed;
    return { ...rest, engineering_effort: effort };
  }
  return parsed;
}

function issueRowToDto(row: IssueRow): IssueDto {
  return {
    ...row,
    labels: row.labels ? JSON.parse(row.labels) : [],
  };
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
  try {
    const body = await req.json().catch(() => null);
    if (body?.model && isValidModelId(body.model)) modelId = body.model;
  } catch {
    /* no body */
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, repo_full_name, number, title, body, state, state_reason,
              author_login, author_association, labels, comments,
              created_at, updated_at, closed_at, html_url, fetched_at, first_seen_at
       FROM issues WHERE repo_full_name = ? AND number = ?`
    )
    .get(repoFullName, num) as IssueRow | undefined;

  if (!row) {
    return NextResponse.json({ error: 'Issue not found in cache. Open the repo page first to fetch it.' }, { status: 404 });
  }

  const issue = issueRowToDto(row);
  const deterministic = runDeterministicChecks(issue);
  const score = predictScore(issue);

  if (!modelId) {
    return NextResponse.json({ deterministic, score, ai: null });
  }

  const cached = db
    .prepare(
      `SELECT verdict, reasoning, created_at FROM ai_verdicts
       WHERE repo_full_name = ? AND issue_number = ? AND model = ?`
    )
    .get(repoFullName, num, modelId) as { verdict: string; reasoning: string; created_at: string } | undefined;

  if (cached) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(cached.reasoning);
    } catch {
      parsed = { ai_verdict: cached.verdict, reasoning: cached.reasoning };
    }
    parsed = normalizeVerdict(parsed);
    return NextResponse.json({
      deterministic,
      score,
      ai: { ...parsed, model: modelId, cached: true, generated_at: cached.created_at },
    });
  }

  const userPrompt = buildUserPrompt(issue);

  try {
    const result = await complete(modelId, SYSTEM_PROMPT, userPrompt, 1200, { effort: 'max' });
    let parsed: Record<string, unknown>;
    try {
      const cleaned = result.text.replace(/^```json\s*|\s*```$/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { ai_verdict: 'uncertain', reasoning: result.text, parse_error: true };
    }
    parsed = normalizeVerdict(parsed);

    db.prepare(
      `INSERT OR REPLACE INTO ai_verdicts (repo_full_name, issue_number, model, verdict, reasoning, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      repoFullName,
      num,
      modelId,
      String(parsed.ai_verdict ?? 'uncertain'),
      JSON.stringify(parsed),
      new Date().toISOString()
    );

    return NextResponse.json({
      deterministic,
      score,
      ai: { ...parsed, model: modelId, cached: false, tokens_in: result.tokensIn, tokens_out: result.tokensOut },
    });
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json({ deterministic, score, ai: { error: err.message, missing_key: err.provider } });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ deterministic, score, ai: { error: msg } });
  }
}

function buildUserPrompt(issue: IssueDto): string {
  const labelStr = issue.labels?.map((l) => l.name).join(', ') || 'none';
  const body = (issue.body ?? '').slice(0, 4000);
  return `Repository: ${issue.repo_full_name}
Issue #${issue.number}: ${issue.title}
State: ${issue.state}${issue.state_reason ? ` (${issue.state_reason})` : ''}
Author: ${issue.author_login} (association: ${issue.author_association ?? 'NONE'})
Labels: ${labelStr}
Comments: ${issue.comments}
Created: ${issue.created_at}
URL: ${issue.html_url}

--- Issue body ---
${body || '(empty)'}
--- End body ---

Evaluate whether this issue is a good candidate to fix.`;
}
