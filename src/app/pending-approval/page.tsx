'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageLayout, Heading, Text, Box } from '@primer/react';
import { ClockIcon, XCircleIcon } from '@primer/octicons-react';

interface MeResp {
  authenticated: boolean;
  username?: string;
  status?: 'pending' | 'approved' | 'rejected';
  is_admin?: boolean;
  avatar_url?: string | null;
}

export default function PendingApprovalPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResp | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        // POST /api/auth/refresh re-issues the cookie from the current DB row
        // — so an admin's approval propagates without forcing the user to
        // sign in again.
        const r = await fetch('/api/auth/refresh', { method: 'POST', cache: 'no-store' });
        if (cancelled) return;
        if (!r.ok) {
          router.replace('/sign-in');
          return;
        }
        const j = (await r.json()) as MeResp;
        setMe(j);
        if (j.status === 'approved') {
          router.replace('/');
          return;
        }
      } catch {
        /* network blip — try again */
      }
      timer = setTimeout(tick, 5000);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [router]);

  const onSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/sign-in');
  };

  const isRejected = me?.status === 'rejected';

  return (
    <PageLayout containerWidth="medium" padding="normal">
      <PageLayout.Content>
        <Box sx={{ maxWidth: 480, mx: 'auto', py: 6, textAlign: 'center' }}>
          <Box sx={{ display: 'inline-flex', color: isRejected ? 'danger.fg' : 'attention.fg', mb: 3 }}>
            {isRejected ? <XCircleIcon size={48} /> : <ClockIcon size={48} />}
          </Box>
          <Heading sx={{ fontSize: 4, mb: 2 }}>
            {isRejected ? 'Access denied' : 'Awaiting approval'}
          </Heading>
          <Text sx={{ display: 'block', color: 'fg.muted', mb: 4 }}>
            {isRejected
              ? 'An admin rejected your sign-in request. Reach out to the dashboard owner if you think this is a mistake.'
              : 'Your account was created. An admin needs to approve it before you can access the dashboard. This page will refresh automatically once approved.'}
          </Text>
          {me?.username && (
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                px: 3,
                py: 2,
                bg: 'canvas.subtle',
                border: '1px solid',
                borderColor: 'border.default',
                borderRadius: 2,
                mb: 4,
              }}
            >
              {me.avatar_url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={me.avatar_url}
                  alt={me.username}
                  width={28}
                  height={28}
                  style={{ borderRadius: '50%', border: '1px solid var(--border-muted)' }}
                />
              )}
              <Text sx={{ fontFamily: 'mono', fontWeight: 600 }}>{me.username}</Text>
            </Box>
          )}
          <Box>
            <Box
              as="button"
              onClick={onSignOut}
              sx={{
                px: 3,
                py: 2,
                bg: 'transparent',
                color: 'fg.default',
                border: '1px solid',
                borderColor: 'border.default',
                borderRadius: 2,
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 1,
                '&:hover': { bg: 'canvas.subtle' },
              }}
            >
              Sign out
            </Box>
          </Box>
        </Box>
      </PageLayout.Content>
    </PageLayout>
  );
}
