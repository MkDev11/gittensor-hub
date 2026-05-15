import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface Row {
  author_login: string;
  state: string;
  state_reason: string | null;
  c: number;
}

export interface AuthorTotals {
  open: number;
  completed: number;
  not_planned: number;
}

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT author_login, state, state_reason, COUNT(*) c
       FROM issues
       WHERE author_login IS NOT NULL AND author_login != ''
       GROUP BY author_login, state, state_reason`,
    )
    .all() as Row[];

  const map: Record<string, AuthorTotals> = {};
  for (const r of rows) {
    if (!map[r.author_login]) map[r.author_login] = { open: 0, completed: 0, not_planned: 0 };
    if (r.state === 'open') {
      map[r.author_login].open += r.c;
    } else if (r.state === 'closed') {
      const reason = (r.state_reason ?? '').toUpperCase();
      if (reason === 'COMPLETED') map[r.author_login].completed += r.c;
      else if (reason === 'NOT_PLANNED') map[r.author_login].not_planned += r.c;
    }
  }

  return NextResponse.json({ count: Object.keys(map).length, authors: map });
}
