import { NextRequest, NextResponse } from 'next/server';
import { getDb, IssueRow } from '@/lib/db';
import { isValidModelId, getModel, type ModelId } from '@/lib/models';
import { complete, MissingApiKeyError } from '@/lib/ai';

export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `You are a senior open-source maintainer writing a high-quality coding-task prompt
for an AI coding assistant. The assistant will be given your prompt and asked to produce a complete,
correct, mergeable pull request that fixes the GitHub issue described below.

Write the prompt as if briefing a smart engineer who has never seen the codebase. The prompt MUST:

1. Restate the issue concisely (what's broken / what's wanted, why it matters)
2. List concrete acceptance criteria — what must be true for this to be considered fixed
3. Spell out the workflow:
   a. Clone the repo and create a feature branch
   b. Identify the right files to change (mention search strategies, not specific files unless certain)
   c. Make the change with care: minimal scope, follow existing code style, no unrelated cleanup
   d. Add or update tests that prove the fix works
   e. Run the full test suite and any linters/type-checkers
   f. Open a PR with a clear title (use Conventional Commits) and a body that links the issue ("Fixes #N")
4. Highlight risks and edge cases the assistant should consider before writing code
5. Specify what NOT to do (no scope creep, no rewriting unrelated modules, no comments narrating the fix)

Return ONLY the prompt as plain text — no preamble, no explanation, no markdown code fences.
The prompt should be self-contained and ready to paste directly into the target model.`;

interface PromptResponse {
  prompt: string;
  cached: boolean;
  generated_at: string;
  model: ModelId;
  tokens_in?: number;
  tokens_out?: number;
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
  let force = false;
  try {
    const body = await req.json().catch(() => null);
    if (body?.model && isValidModelId(body.model)) modelId = body.model;
    if (body?.force === true) force = true;
  } catch {
    /* no body */
  }

  if (!modelId) {
    return NextResponse.json({ error: 'model is required (claude-opus-4-7 | gpt-5 | gpt-5-codex)' }, { status: 400 });
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
    return NextResponse.json({ error: 'Issue not found in cache.' }, { status: 404 });
  }

  if (!force) {
    const cached = db
      .prepare(
        `SELECT prompt, created_at FROM prompts
         WHERE repo_full_name = ? AND issue_number = ? AND model = ?`
      )
      .get(repoFullName, num, modelId) as { prompt: string; created_at: string } | undefined;

    if (cached) {
      const out: PromptResponse = {
        prompt: cached.prompt,
        cached: true,
        generated_at: cached.created_at,
        model: modelId,
      };
      return NextResponse.json(out);
    }
  }

  const target = getModel(modelId);
  const userPrompt = `Generate a coding-task prompt that will be fed into ${target.label} to produce a high-quality PR fixing the following GitHub issue.

Repository: ${row.repo_full_name}
Issue #${row.number}: ${row.title}
URL: ${row.html_url}
State: ${row.state}${row.state_reason ? ` (${row.state_reason})` : ''}
Author: ${row.author_login} (association: ${row.author_association ?? 'NONE'})
Labels: ${row.labels ? JSON.parse(row.labels).map((l: { name: string }) => l.name).join(', ') : 'none'}

--- Issue body ---
${(row.body ?? '').slice(0, 6000) || '(empty)'}
--- End body ---

Write the prompt now.`;

  try {
    const result = await complete(modelId, SYSTEM_PROMPT, userPrompt, 2500, { effort: 'max' });
    db.prepare(
      `INSERT OR REPLACE INTO prompts (repo_full_name, issue_number, model, prompt, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(repoFullName, num, modelId, result.text, new Date().toISOString());

    const out: PromptResponse = {
      prompt: result.text,
      cached: false,
      generated_at: new Date().toISOString(),
      model: modelId,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
    };
    return NextResponse.json(out);
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json({ error: err.message, missing_key: err.provider }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
