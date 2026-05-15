import { NextRequest, NextResponse } from 'next/server';
import { getDb, IssueRow } from '@/lib/db';
import { isValidModelId, type ModelId } from '@/lib/models';
import { complete, MissingApiKeyError } from '@/lib/ai';

export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `You compare a GitHub issue to a list of older issues from the same repo and decide whether the new issue is a duplicate.

Be STRICT: only flag as duplicate when the underlying problem (or feature request) is substantially the same — not when issues merely share keywords or a topic area. Different bugs in the same area are NOT duplicates.

Respond with ONLY this JSON, no prose:
{
  "is_duplicate": boolean,
  "duplicate_of_number": number | null,
  "confidence": "low" | "medium" | "high",
  "reasoning": "<1-3 short sentences explaining the call>"
}`;

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','if','then','for','to','of','in','on','at','by','with','from','as','is','are','was',
  'were','be','been','being','this','that','these','those','i','it','its','we','you','they','not','no','so','do','does',
  'done','can','could','should','would','will','may','might','should','have','has','had','bug','issue','feature','crash',
  'error','fix','about','when','where','what','why','how','which','who','please',
]);

function tokenize(s: string): string[] {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
}

function pickCandidates(target: IssueRow, all: IssueRow[]): IssueRow[] {
  const targetTokens = new Set(tokenize(target.title + ' ' + (target.body ?? '')));
  if (targetTokens.size === 0) return [];
  const targetCreatedMs = target.created_at ? new Date(target.created_at).getTime() : Infinity;

  const scored: Array<{ row: IssueRow; score: number }> = [];
  for (const row of all) {
    if (row.number === target.number) continue;
    // Only consider OLDER issues — the target can only be a duplicate of
    // something that already existed.
    const createdMs = row.created_at ? new Date(row.created_at).getTime() : 0;
    if (createdMs >= targetCreatedMs) continue;

    const tokens = tokenize(row.title);
    let overlap = 0;
    for (const t of tokens) if (targetTokens.has(t)) overlap += 1;
    if (overlap < 2) continue;
    scored.push({ row, score: overlap });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 10).map((s) => s.row);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { owner: string; name: string; number: string } }
) {
  const { owner, name, number } = params;
  const num = parseInt(number, 10);
  if (!Number.isFinite(num)) {
    return NextResponse.json({ error: 'invalid number' }, { status: 400 });
  }
  const repoFullName = `${owner}/${name}`;
  const body = await req.json().catch(() => ({})) as { model?: string; force?: boolean };
  if (!body.model || !isValidModelId(body.model)) {
    return NextResponse.json({ error: 'invalid model' }, { status: 400 });
  }
  const model = body.model as ModelId;
  const force = body.force === true;

  const db = getDb();

  // ---- cache hit ----
  if (!force) {
    const cached = db
      .prepare(
        `SELECT is_duplicate, duplicate_of, confidence, reasoning, created_at
         FROM duplicate_checks WHERE repo_full_name = ? AND issue_number = ? AND model = ?`
      )
      .get(repoFullName, num, model) as
      | { is_duplicate: number; duplicate_of: number | null; confidence: string | null; reasoning: string | null; created_at: string }
      | undefined;
    if (cached) {
      return NextResponse.json({
        is_duplicate: !!cached.is_duplicate,
        duplicate_of_number: cached.duplicate_of,
        confidence: cached.confidence,
        reasoning: cached.reasoning,
        cached: true,
        generated_at: cached.created_at,
      });
    }
  }

  const target = db
    .prepare(
      `SELECT id, repo_full_name, number, title, body, state, state_reason,
              author_login, author_association, labels, comments,
              created_at, updated_at, closed_at, html_url, fetched_at, first_seen_at
       FROM issues WHERE repo_full_name = ? AND number = ?`
    )
    .get(repoFullName, num) as IssueRow | undefined;
  if (!target) {
    return NextResponse.json({ error: 'issue not in cache' }, { status: 404 });
  }

  // Pull repo's issues for candidate filtering. Capped — for the largest repos
  // we only consider the 10k most-recently-updated, which is fine for "older
  // issue with similar wording" matching.
  const all = db
    .prepare(
      `SELECT id, repo_full_name, number, title, body, state, state_reason,
              author_login, author_association, labels, comments,
              created_at, updated_at, closed_at, html_url, fetched_at, first_seen_at
       FROM issues WHERE repo_full_name = ?
       ORDER BY updated_at DESC LIMIT 10000`
    )
    .all(repoFullName) as IssueRow[];

  const candidates = pickCandidates(target, all);
  if (candidates.length === 0) {
    // Nothing similar found — record the result so we don't burn tokens
    // re-checking on every dialog open.
    db.prepare(
      `INSERT OR REPLACE INTO duplicate_checks
       (repo_full_name, issue_number, model, is_duplicate, duplicate_of, confidence, reasoning, created_at)
       VALUES (?, ?, ?, 0, NULL, 'high', 'No older issues with overlapping keywords found.', ?)`
    ).run(repoFullName, num, model, new Date().toISOString());
    return NextResponse.json({
      is_duplicate: false,
      duplicate_of_number: null,
      confidence: 'high',
      reasoning: 'No older issues with overlapping keywords found.',
      cached: false,
    });
  }

  const userPrompt =
    `TARGET ISSUE\n` +
    `#${target.number} — ${target.title}\n` +
    `${(target.body ?? '').slice(0, 2000)}\n\n` +
    `OLDER ISSUES (candidates)\n` +
    candidates
      .map(
        (c) =>
          `#${c.number} — ${c.title}\n${(c.body ?? '').slice(0, 800)}\n`
      )
      .join('\n');

  let parsed: { is_duplicate?: boolean; duplicate_of_number?: number | null; confidence?: string; reasoning?: string } = {};
  try {
    const result = await complete(model, SYSTEM_PROMPT, userPrompt, 1200, { effort: 'medium' });
    // The model is asked for raw JSON; tolerate ```json fences just in case.
    const cleaned = result.text.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json({ error: 'missing API key', missing_key: err.provider }, { status: 400 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  const is_duplicate = !!parsed.is_duplicate;
  const duplicate_of_number = is_duplicate && typeof parsed.duplicate_of_number === 'number' ? parsed.duplicate_of_number : null;
  // Validate the model didn't hallucinate a number that wasn't in the candidate list.
  const candidateNumbers = new Set(candidates.map((c) => c.number));
  const safeDupOf = duplicate_of_number && candidateNumbers.has(duplicate_of_number) ? duplicate_of_number : null;
  const confidence = ['low', 'medium', 'high'].includes(parsed.confidence ?? '') ? parsed.confidence! : 'medium';
  const reasoning = (parsed.reasoning ?? '').slice(0, 1000);

  db.prepare(
    `INSERT OR REPLACE INTO duplicate_checks
     (repo_full_name, issue_number, model, is_duplicate, duplicate_of, confidence, reasoning, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    repoFullName,
    num,
    model,
    is_duplicate && safeDupOf ? 1 : 0,
    safeDupOf,
    confidence,
    reasoning,
    new Date().toISOString(),
  );

  return NextResponse.json({
    is_duplicate: is_duplicate && safeDupOf != null,
    duplicate_of_number: safeDupOf,
    confidence,
    reasoning,
    cached: false,
  });
}
