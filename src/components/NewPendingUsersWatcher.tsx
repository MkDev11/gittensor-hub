'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/lib/toast';
import { useSession } from '@/lib/settings';

interface PendingUser {
  id: number;
  github_login: string;
  avatar_url: string | null;
  created_at: string;
}
interface PendingResp {
  count: number;
  latest: PendingUser[];
}

export default function NewPendingUsersWatcher() {
  const router = useRouter();
  const { push } = useToast();
  const { isAdmin } = useSession();
  const baselineRef = useRef<number | null>(null);
  const seenRef = useRef<Set<number>>(new Set());

  const { data } = useQuery<PendingResp>({
    queryKey: ['watcher-pending-users'],
    queryFn: async () => {
      const r = await fetch('/api/admin/pending-count', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 15000,
    enabled: !!isAdmin,
  });

  useEffect(() => {
    if (!data) return;
    if (baselineRef.current == null) {
      baselineRef.current = Date.now();
      for (const u of data.latest) seenRef.current.add(u.id);
      return;
    }
    const baseline = baselineRef.current;
    let fired = 0;
    const MAX_PER_TICK = 3;
    for (const u of data.latest) {
      if (seenRef.current.has(u.id)) continue;
      seenRef.current.add(u.id);
      const createdMs = u.created_at ? new Date(u.created_at).getTime() : 0;
      if (createdMs <= baseline) continue;
      if (fired >= MAX_PER_TICK) continue;
      fired += 1;
      push({
        title: 'New pending user',
        body: `@${u.github_login} requested access`,
        onClick: () => router.push('/admin/users'),
        icon: 'bell',
        variant: 'info',
        ttlMs: 9000,
      });
    }
  }, [data, push, router]);

  return null;
}
