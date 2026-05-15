'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Box, Text, IconButton } from '@primer/react';
import { XIcon, IssueOpenedIcon, GitPullRequestIcon, BellIcon } from '@primer/octicons-react';

export type ToastVariant = 'info' | 'success' | 'warning' | 'danger';
export type ToastIcon = 'issue' | 'pull' | 'bell';

export interface Toast {
  id: string;
  title: string;
  body?: string;
  href?: string;
  onClick?: () => void;
  variant?: ToastVariant;
  icon?: ToastIcon;
  ttlMs?: number;
}

interface ToastCtx {
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast must be used inside ToastProvider');
  return c;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const toast: Toast = { id, ttlMs: 7000, variant: 'info', ...t };
      setToasts((cur) => [...cur.slice(-8), toast]);
      if (toast.ttlMs && toast.ttlMs > 0) {
        setTimeout(() => dismiss(id), toast.ttlMs);
      }
    },
    [dismiss]
  );

  return (
    <Ctx.Provider value={{ push, dismiss }}>
      {children}
      <Box
        sx={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          maxWidth: 380,
        }}
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </Box>
    </Ctx.Provider>
  );
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const variant = toast.variant ?? 'info';
  const variantStyle = {
    info: { border: 'accent.emphasis', bar: 'accent.emphasis' },
    success: { border: 'success.emphasis', bar: 'success.emphasis' },
    warning: { border: 'attention.emphasis', bar: 'attention.emphasis' },
    danger: { border: 'danger.emphasis', bar: 'danger.emphasis' },
  }[variant];

  const Icon = toast.icon === 'issue' ? IssueOpenedIcon : toast.icon === 'pull' ? GitPullRequestIcon : BellIcon;

  const inner = (
    <Box
      sx={{
        bg: 'canvas.overlay',
        border: '1px solid',
        borderColor: 'border.default',
        borderLeft: '3px solid',
        borderLeftColor: variantStyle.bar,
        borderRadius: 2,
        boxShadow: 'shadow.large',
        p: 3,
        display: 'flex',
        gap: 2,
        alignItems: 'flex-start',
        animation: 'slideUp 200ms ease',
        '@keyframes slideUp': {
          from: { opacity: 0, transform: 'translateY(8px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
      }}
    >
      <Box sx={{ pt: '2px', color: variantStyle.bar }}>
        <Icon size={16} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Text sx={{ fontWeight: 600, color: 'fg.default', display: 'block', fontSize: 1 }}>{toast.title}</Text>
        {toast.body && (
          <Text sx={{ color: 'fg.muted', fontSize: 0, mt: 1, display: 'block', wordBreak: 'break-word' }}>
            {toast.body}
          </Text>
        )}
      </Box>
      <IconButton
        icon={XIcon}
        aria-label="Dismiss notification"
        size="small"
        variant="invisible"
        onClick={(e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      />
    </Box>
  );

  if (toast.onClick) {
    // <div role="button"> instead of <button> because `inner` contains an
    // IconButton (the dismiss X), and nesting <button> inside <button> is
    // invalid HTML — Next 15 surfaces it as a hydration error.
    const activate = () => {
      toast.onClick!();
      onClose();
    };
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
          }
        }}
        style={{
          display: 'block',
          width: '100%',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {inner}
      </div>
    );
  }
  if (toast.href) {
    return (
      <a href={toast.href} style={{ textDecoration: 'none', display: 'block' }}>
        {inner}
      </a>
    );
  }
  return inner;
}
