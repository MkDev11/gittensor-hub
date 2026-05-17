'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Box, Header, Text } from '@primer/react';
import { RepoIcon, IssueOpenedIcon, GitPullRequestIcon, PersonIcon, BrowserIcon, BookIcon, OrganizationIcon } from '@primer/octicons-react';
import ThemeToggle from '@/components/ThemeToggle';
import UserMenu from '@/components/UserMenu';
import PriceTicker from '@/components/PriceTicker';

const navItems = [
  { href: '/', label: 'Browse', icon: BrowserIcon },
  { href: '/miners', label: 'Miners', icon: OrganizationIcon },
  { href: '/repositories', label: 'Repositories', icon: RepoIcon },
  { href: '/issues', label: 'Issues', icon: IssueOpenedIcon },
  { href: '/pulls', label: 'Pull Requests', icon: GitPullRequestIcon },
  { href: '/my-prs', label: 'My PRs', icon: GitPullRequestIcon },
  { href: '/docs', label: 'Docs', icon: BookIcon },
];

// Routes that should render full-bleed without the nav header (pre-auth screens).
const HIDE_HEADER_ROUTES = new Set(['/sign-in']);

export default function AppHeader() {
  const pathname = usePathname();
  if (HIDE_HEADER_ROUTES.has(pathname)) return null;

  // Wrap in a plain div so the `data-app-header` attribute reliably lands
  // on a DOM node — Primer's <Header> doesn't forward arbitrary data
  // attributes, which is why CSS-driven show/hide couldn't target it before.
  // `userSelect: none` prevents nav-item text from getting highlighted on
  // accidental double-clicks (the sidebar applies the same to its <aside>).
  return (
    <div data-app-header="" style={{ position: 'sticky', top: 0, zIndex: 100, userSelect: 'none' }}>
    <Header
      sx={{
        bg: 'canvas.subtle',
        borderBottom: '1px solid',
        borderColor: 'border.default',
      }}
    >
      <Header.Item>
        <Header.Link href="/" sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gt-logo.png" alt="Gittensor Hub" width={28} height={28} style={{ display: 'block' }} />
          <Text sx={{ fontWeight: 600, fontSize: 2, letterSpacing: '-0.015em' }}>Gittensor Hub</Text>
        </Header.Link>
      </Header.Item>
      {navItems.map((item) => {
        const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
        const Icon = item.icon;
        return (
          <Header.Item key={item.href}>
            <Link href={item.href} style={{ textDecoration: 'none' }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  color: active ? 'fg.default' : 'fg.muted',
                  fontWeight: active ? 600 : 400,
                  '&:hover': { color: 'fg.default' },
                }}
              >
                <Icon size={16} />
                {item.label}
              </Box>
            </Link>
          </Header.Item>
        );
      })}
      <Header.Item full />
      <Header.Item>
        <PriceTicker />
      </Header.Item>
      <Header.Item>
        <ThemeToggle />
      </Header.Item>
      <Header.Item>
        <UserMenu />
      </Header.Item>
    </Header>
    </div>
  );
}
