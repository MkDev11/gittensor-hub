'use client';

export const dynamic = 'force-dynamic';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageLayout, Heading, Text, Box } from '@primer/react';
import { MarkGithubIcon } from '@primer/octicons-react';

function ErrorMessage({ code }: { code: string }) {
  const messages: Record<string, string> = {
    state_mismatch: 'Sign-in expired or was tampered with. Please try again.',
    oauth_not_configured: 'GitHub OAuth is not configured on the server.',
    token_exchange_failed: 'Could not exchange the GitHub authorization code.',
    user_fetch_failed: 'Could not read your GitHub profile.',
    invalid_user_payload: 'GitHub returned an unexpected user shape.',
    no_token: 'GitHub declined the authorization request.',
    missing_code_or_state: 'GitHub redirected without an authorization code.',
  };
  const msg = messages[code] ?? `Sign-in failed (${code}).`;
  return (
    <Box
      sx={{
        bg: 'danger.subtle',
        color: 'danger.fg',
        border: '1px solid',
        borderColor: 'danger.muted',
        borderRadius: 2,
        px: 3,
        py: 2,
        fontSize: 1,
        mb: 3,
      }}
    >
      {msg}
    </Box>
  );
}

function SignInBody() {
  const search = useSearchParams();
  const next = search.get('next') || '/';
  const error = search.get('error');
  const href = `/api/auth/github/login?next=${encodeURIComponent(next)}`;
  return (
    <Box sx={{ maxWidth: 420, mx: 'auto', py: 6 }}>
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/gt-logo.png" alt="Gittensor" width={48} height={48} style={{ display: 'inline-block' }} />
        <Heading sx={{ fontSize: 4, mt: 2 }}>Gittensor Dashboard</Heading>
        <Text sx={{ color: 'fg.muted', display: 'block', mt: 1 }}>Sign in with your GitHub account.</Text>
      </Box>

      {error && <ErrorMessage code={error} />}

      <Box
        as="a"
        href={href}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          width: '100%',
          height: 44,
          bg: 'fg.default',
          color: 'canvas.default',
          border: '1px solid',
          borderColor: 'fg.default',
          borderRadius: 2,
          fontWeight: 600,
          fontSize: 2,
          textDecoration: 'none',
          cursor: 'pointer',
          transition: 'opacity 80ms',
          '&:hover': { opacity: 0.9 },
        }}
      >
        <MarkGithubIcon size={18} />
        Sign in with GitHub
      </Box>

      <Text sx={{ display: 'block', textAlign: 'center', mt: 4, fontSize: 0, color: 'fg.muted' }}>
        New accounts require admin approval before they can access the dashboard.
      </Text>
    </Box>
  );
}

export default function SignInPage() {
  return (
    <PageLayout containerWidth="medium" padding="normal">
      <PageLayout.Content>
        <Suspense fallback={null}>
          <SignInBody />
        </Suspense>
      </PageLayout.Content>
    </PageLayout>
  );
}
