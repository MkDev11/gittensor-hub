'use client';

export const dynamic = 'force-dynamic';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { MarkGithubIcon } from '@primer/octicons-react';

// Linear-inspired dark palette (matches the pong-agent dashboard's design tokens).
const palette = {
  bg: '#08090a',
  bgGradientTop: '#0c0d10',
  surface: '#101113',
  surface2: '#151619',
  line: '#25262b',
  lineSoft: '#1a1b1f',
  text: '#f7f8f8',
  muted: '#8a8f98',
  muted2: '#b6bbc6',
  accent: '#5e6ad2',
  accentSoft: 'rgba(94, 106, 210, 0.16)',
  red: '#e26d6d',
  redSoft: 'rgba(226, 109, 109, 0.12)',
  redBorder: 'rgba(226, 109, 109, 0.32)',
  shadow: '0 24px 80px rgba(0, 0, 0, 0.45)',
};

const ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: 'Sign-in expired or was tampered with. Please try again.',
  oauth_not_configured: 'GitHub OAuth is not configured on the server.',
  token_exchange_failed: 'Could not exchange the GitHub authorization code.',
  user_fetch_failed: 'Could not read your GitHub profile.',
  invalid_user_payload: 'GitHub returned an unexpected user shape.',
  no_token: 'GitHub declined the authorization request.',
  missing_code_or_state: 'GitHub redirected without an authorization code.',
  account_rejected: 'This GitHub account is no longer permitted to access the dashboard.',
};

function SignInBody() {
  const search = useSearchParams();
  const next = search.get('next') || '/';
  const error = search.get('error');
  const href = `/api/auth/github/login?next=${encodeURIComponent(next)}`;
  const errorMsg = error ? ERROR_MESSAGES[error] ?? `Sign-in failed (${error}).` : null;

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: `radial-gradient(1200px 600px at 50% -10%, ${palette.bgGradientTop}, ${palette.bg} 60%)`,
        color: palette.text,
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: 13,
        letterSpacing: 0,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          background: palette.surface,
          border: `1px solid ${palette.line}`,
          borderRadius: 12,
          padding: '36px 32px',
          boxShadow: palette.shadow,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: palette.surface2,
              border: `1px solid ${palette.lineSoft}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/gt-logo.png" alt="Gittensor Hub" width={36} height={36} style={{ display: 'block' }} />
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: palette.text,
            }}
          >
            Gittensor Hub
          </h1>
          <p style={{ margin: '6px 0 0 0', fontSize: 13, color: palette.muted }}>
            Sign in to continue to your dashboard
          </p>
        </div>

        {errorMsg && (
          <div
            role="alert"
            style={{
              background: palette.redSoft,
              color: '#ffcccc',
              border: `1px solid ${palette.redBorder}`,
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 12.5,
              lineHeight: 1.4,
              marginBottom: 16,
            }}
          >
            {errorMsg}
          </div>
        )}

        <a
          href={href}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            width: '100%',
            height: 42,
            background: '#1f2328',
            color: palette.text,
            border: `1px solid ${palette.line}`,
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 13.5,
            textDecoration: 'none',
            cursor: 'pointer',
            transition: 'background 140ms ease, border-color 140ms ease, transform 80ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#2a2f36';
            e.currentTarget.style.borderColor = '#383a42';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#1f2328';
            e.currentTarget.style.borderColor = palette.line;
            e.currentTarget.style.transform = 'translateY(0)';
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'translateY(1px)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
        >
          <MarkGithubIcon size={18} />
          Continue with GitHub
        </a>

        <div
          style={{
            marginTop: 24,
            paddingTop: 16,
            borderTop: `1px solid ${palette.lineSoft}`,
            fontSize: 12,
            color: palette.muted,
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          Read-only access to your public GitHub profile. Nothing else.
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInBody />
    </Suspense>
  );
}
