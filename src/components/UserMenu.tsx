'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  GearIcon,
  SignOutIcon,
  PersonIcon,
  TriangleDownIcon,
  RepoIcon,
  ShieldLockIcon,
} from '@primer/octicons-react';
import { useSession } from '@/lib/settings';

export default function UserMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{
    top: number;
    anchor: { left: number } | { right: number };
    placement: 'down' | 'up';
  } | null>(null);
  const [mounted, setMounted] = useState(false);
  const { authenticated, username, isAdmin, avatarUrl, loading, signOut } = useSession();

  // Pending-signup badge — shares the same TanStack queryKey as
  // NewPendingUsersWatcher, so both components read from a single cache entry.
  const { data: pending } = useQuery<{ count: number }>({
    queryKey: ['watcher-pending-users'],
    queryFn: async () => {
      const r = await fetch('/api/admin/pending-count', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 15000,
    enabled: !!isAdmin,
  });
  const pendingCount = pending?.count ?? 0;

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const measuredHeight = menuRef.current?.offsetHeight;
      const menuHeight = measuredHeight ?? 320;
      const spaceBelow = window.innerHeight - r.bottom;
      const placement: 'down' | 'up' = spaceBelow < menuHeight + 16 ? 'up' : 'down';
      const top = placement === 'down' ? r.bottom + 6 : Math.max(8, r.top - 6 - menuHeight);
      // Pick the horizontal anchor based on where the trigger sits. A trigger
      // in the left half of the viewport (sidebar footer) anchors the menu's
      // LEFT edge to the trigger's left, so it opens rightward. A trigger in
      // the right half (legacy top-bar position) anchors RIGHT-to-RIGHT, so
      // the menu opens leftward and never clips the right edge.
      const triggerCenter = (r.left + r.right) / 2;
      const anchor =
        triggerCenter < window.innerWidth / 2
          ? { left: Math.max(8, r.left) }
          : { right: Math.max(8, window.innerWidth - r.right) };
      setCoords({ top, anchor, placement });
    };
    update();
    // Re-measure on the next frame so `menuRef.current.offsetHeight` is the
    // real height instead of the 320px estimate. Fixes the flip placement
    // when the menu opens from the sidebar footer.
    const raf = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  if (loading) {
    // Match the trigger button's footprint with a circle + name skeleton
    // so the chrome doesn't collapse while /api/auth/me is in flight.
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: 4,
          paddingRight: 8,
          height: 32,
        }}
      >
        <span className="gt-skeleton" style={{ width: 24, height: 24, borderRadius: '50%' }} />
        <span className="gt-skeleton" style={{ width: 60, height: 10 }} />
      </div>
    );
  }

  if (!authenticated || !username) {
    return (
      <button
        type="button"
        onClick={() => router.push('/sign-in')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          background: 'transparent',
          border: '1px solid var(--border-default)',
          borderRadius: 6,
          color: 'var(--fg-default)',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <PersonIcon size={14} />
        Sign in
      </button>
    );
  }

  const display = username;
  const initial = display.charAt(0).toUpperCase();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="User menu"
        aria-haspopup="true"
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: 4,
          paddingRight: 8,
          background: open ? 'var(--bg-emphasis)' : 'transparent',
          border: '1px solid',
          borderColor: open ? 'var(--border-default)' : 'transparent',
          borderRadius: 6,
          color: 'var(--fg-default)',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: 'inherit',
          transition: 'background 80ms, border-color 80ms',
        }}
        onMouseEnter={(e) => {
          if (!open) {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-subtle)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-default)';
          }
        }}
        onMouseLeave={(e) => {
          if (!open) {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
          }
        }}
      >
        <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={display}
              style={{ width: 24, height: 24, borderRadius: '50%', display: 'block' }}
            />
          ) : (
            <span
              style={{
                display: 'inline-flex',
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: 'var(--accent-emphasis)',
                color: 'white',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {initial}
            </span>
          )}
          {isAdmin && pendingCount > 0 && (
            <span
              aria-label={`${pendingCount} pending user${pendingCount === 1 ? '' : 's'}`}
              title={`${pendingCount} pending user${pendingCount === 1 ? '' : 's'} awaiting approval`}
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                minWidth: 16,
                height: 16,
                padding: '0 4px',
                borderRadius: 999,
                background: 'var(--danger-fg)',
                color: 'white',
                fontSize: 10,
                fontWeight: 700,
                lineHeight: '16px',
                textAlign: 'center',
                border: '2px solid var(--bg-canvas)',
                boxSizing: 'content-box',
                fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, monospace',
              }}
            >
              {pendingCount > 9 ? '9+' : pendingCount}
            </span>
          )}
        </span>
        <span style={{ color: 'var(--fg-default)' }}>{display}</span>
        <TriangleDownIcon size={12} />
      </button>

      {mounted && open && coords &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: coords.top,
              ...('left' in coords.anchor
                ? { left: coords.anchor.left }
                : { right: coords.anchor.right }),
              width: 280,
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-default)',
              borderRadius: 6,
              boxShadow: 'var(--shadow-overlay)',
              zIndex: 9500,
              padding: 0,
              fontSize: 14,
              color: 'var(--fg-default)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px',
                borderBottom: '1px solid var(--border-muted)',
              }}
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={display}
                  style={{ width: 40, height: 40, borderRadius: '50%', display: 'block' }}
                />
              ) : (
                <div
                  style={{
                    display: 'inline-flex',
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: 'var(--accent-emphasis)',
                    color: 'white',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    fontWeight: 700,
                  }}
                >
                  {initial}
                </div>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--fg-default)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {display}
                </div>
                <div style={{ fontSize: 12, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Signed in
                </div>
              </div>
            </div>

            <MenuItem
              onClick={() => {
                router.push('/manage-repos');
                setOpen(false);
              }}
              icon={<RepoIcon size={16} />}
              label="Manage repositories"
            />
            {isAdmin && (
              <MenuItem
                onClick={() => {
                  router.push('/admin/users');
                  setOpen(false);
                }}
                icon={<ShieldLockIcon size={16} />}
                label="User access"
                suffix={
                  pendingCount > 0 ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: 20,
                        height: 18,
                        padding: '0 6px',
                        borderRadius: 999,
                        background: 'var(--danger-fg)',
                        color: 'white',
                        fontSize: 11,
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, monospace',
                        lineHeight: 1,
                      }}
                    >
                      {pendingCount > 99 ? '99+' : pendingCount}
                    </span>
                  ) : undefined
                }
              />
            )}
            <MenuItem
              onClick={() => {
                router.push('/settings');
                setOpen(false);
              }}
              icon={<GearIcon size={16} />}
              label="Settings"
            />
            <div style={{ borderTop: '1px solid var(--border-muted)' }}>
              <MenuItem
                onClick={async () => {
                  await signOut();
                  setOpen(false);
                  router.push('/sign-in');
                }}
                icon={<SignOutIcon size={16} />}
                label="Sign out"
                danger
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function MenuItem({
  onClick,
  icon,
  label,
  suffix,
  danger,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  suffix?: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 12px',
        background: 'transparent',
        border: 'none',
        color: danger ? 'var(--danger-fg)' : 'var(--fg-default)',
        fontSize: 14,
        fontFamily: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = danger ? 'var(--danger-subtle)' : 'var(--menu-item-hover-bg)';
        (e.currentTarget as HTMLButtonElement).style.color = danger ? 'var(--danger-fg)' : 'var(--menu-item-hover-fg)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        (e.currentTarget as HTMLButtonElement).style.color = danger ? 'var(--danger-fg)' : 'var(--fg-default)';
      }}
    >
      <span style={{ display: 'inline-flex', flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {suffix && <span style={{ flexShrink: 0, opacity: 0.7 }}>{suffix}</span>}
    </button>
  );
}
