'use client';

import { Box } from '@primer/react';
import AuthorActivitySidebar from '@/components/AuthorActivitySidebar';
import type { Issue, Pull } from '@/types/entities';

type AuthorTarget = {
  owner: string;
  name: string;
  repoFullName: string;
  login: string;
  association?: string | null;
};

export function AuthorSidebarModal({
  target,
  initialTab,
  onClose,
  onIssueClick,
  onPullClick,
}: {
  target: AuthorTarget | null;
  initialTab?: 'issues' | 'pulls';
  onClose: () => void;
  onIssueClick: (issue: Issue) => void;
  onPullClick: (pull: Pull) => void;
}): JSX.Element | null {
  if (!target) return null;
  return (
    <>
      <Box
        onMouseDown={onClose}
        sx={{
          position: 'fixed',
          inset: 0,
          zIndex: 219,
          bg: 'rgba(1, 4, 9, 0.28)',
        }}
      />
      <Box
        sx={{
          position: 'fixed',
          top: 'var(--header-height)',
          right: 0,
          bottom: 0,
          width: ['100vw', null, 'min(760px, 52vw)'],
          maxWidth: ['100vw', null, 'calc(100vw - 24px)'],
          borderLeft: '1px solid',
          borderColor: 'var(--border-default)',
          bg: 'var(--bg-canvas)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '-18px 0 36px rgba(1, 4, 9, 0.36)',
          zIndex: 220,
        }}
      >
        <AuthorActivitySidebar
          owner={target.owner}
          name={target.name}
          repoFullName={target.repoFullName}
          login={target.login}
          initialAssociation={target.association ?? null}
          initialTab={initialTab}
          onClose={onClose}
          onIssueClick={onIssueClick}
          onPullClick={onPullClick}
        />
      </Box>
    </>
  );
}
