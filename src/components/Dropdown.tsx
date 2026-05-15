'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TriangleDownIcon, CheckIcon } from '@primer/octicons-react';

export interface DropdownOption<T extends string> {
  value: T;
  label: React.ReactNode;
  hint?: string;
}

function approxOptionWidth(label: React.ReactNode, hint?: string): number {
  const labelChars = typeof label === 'string' ? label.length : 16;
  const hintChars = hint ? hint.length : 0;
  // 12px per em for 14px font, plus padding (12 + 16 + label + 12 + hint + 12) ~ scale by 8.5
  return 24 + 16 + labelChars * 8.5 + (hintChars > 0 ? 12 + hintChars * 7 : 0) + 24;
}

interface DropdownProps<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (next: T) => void;
  width?: number | string;
  placeholder?: string;
  align?: 'left' | 'right';
  size?: 'small' | 'medium';
  ariaLabel?: string;
  leadingVisual?: React.ReactNode;
}

export default function Dropdown<T extends string>({
  value,
  options,
  onChange,
  width = 200,
  placeholder = 'Select…',
  align = 'left',
  size = 'medium',
  ariaLabel,
  leadingVisual,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; maxHeight: number; flipped: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      // Auto-size: pick the larger of trigger width, requested width, or content min
      const requested = typeof width === 'number' ? width : 0;
      const contentMin = Math.max(...options.map((o) => approxOptionWidth(o.label, o.hint)));
      const w = Math.max(r.width, requested, contentMin);
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      let left = align === 'right' ? r.right - w : r.left;
      if (left + w > viewportW - 8) left = Math.max(8, viewportW - w - 8);
      if (left < 8) left = 8;

      // Calculate vertical placement — open downward by default, flip up
      // when there isn't enough space below the trigger.
      const spaceBelow = viewportH - r.bottom - 8;
      const spaceAbove = r.top - 8;
      const PREFERRED_MAX = 360;
      // Natural content height: rows × 36px + 12px padding
      const natural = Math.min(PREFERRED_MAX, options.length * 36 + 12);
      let top: number;
      let maxHeight: number;
      let flipped: boolean;
      if (spaceBelow >= natural || spaceBelow >= spaceAbove) {
        top = r.bottom + 4;
        maxHeight = Math.min(PREFERRED_MAX, spaceBelow);
        flipped = false;
      } else {
        // Flip upward — bottom edge of menu sits 4px above trigger top.
        const usableHeight = Math.min(natural, spaceAbove);
        top = r.top - 4 - usableHeight;
        maxHeight = usableHeight;
        flipped = true;
      }
      setCoords({ top, left, width: w, maxHeight, flipped });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, width, align, options]);

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

  const current = options.find((o) => o.value === value);
  const height = size === 'small' ? 28 : 32;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: typeof width === 'number' ? width : width,
          height,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '0 12px',
          border: '1px solid var(--border-default)',
          borderRadius: 6,
          background: 'var(--bg-canvas)',
          color: 'var(--fg-default)',
          fontSize: 14,
          fontWeight: 400,
          fontFamily: 'inherit',
          cursor: 'pointer',
          lineHeight: '20px',
          whiteSpace: 'nowrap',
          textAlign: 'left',
          transition: 'border-color 80ms, box-shadow 80ms',
          boxShadow: open ? '0 0 0 3px var(--accent-glow)' : 'none',
          borderColor: open ? 'var(--accent-emphasis)' : 'var(--border-default)',
          verticalAlign: 'middle',
        }}
        onMouseEnter={(e) => {
          if (!open) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-strong)';
        }}
        onMouseLeave={(e) => {
          if (!open) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-default)';
        }}
        onFocus={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent-emphasis)';
          (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 0 3px var(--accent-glow)';
        }}
        onBlur={(e) => {
          if (!open) {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-default)';
            (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
          }
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, overflow: 'hidden', minWidth: 0 }}>
          {leadingVisual && (
            <span style={{ display: 'inline-flex', color: 'var(--fg-muted)', flexShrink: 0 }}>{leadingVisual}</span>
          )}
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: current ? 'var(--fg-default)' : 'var(--fg-subtle)',
            }}
          >
            {current?.label ?? placeholder}
          </span>
        </span>
        <span style={{ display: 'inline-flex', color: 'var(--fg-muted)', flexShrink: 0 }}>
          <TriangleDownIcon size={16} />
        </span>
      </button>

      {mounted && open && coords &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              width: coords.width,
              maxHeight: coords.maxHeight,
              overflowY: 'auto',
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-default)',
              borderRadius: 6,
              boxShadow: 'var(--shadow-overlay)',
              zIndex: 9500,
              padding: '6px 0',
              fontSize: 14,
              color: 'var(--fg-default)',
              transformOrigin: coords.flipped ? 'bottom' : 'top',
            }}
          >
            {options.map((opt) => {
              const selected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '6px 12px',
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    fontSize: 'inherit',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                    cursor: 'pointer',
                    lineHeight: '20px',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--menu-item-hover-bg)';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--menu-item-hover-fg)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.color = 'inherit';
                  }}
                >
                  <span style={{ width: 16, flexShrink: 0, display: 'inline-flex', alignItems: 'center', color: 'var(--selected-check)' }}>
                    {selected ? <CheckIcon size={14} /> : null}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {opt.label}
                  </span>
                  {opt.hint && (
                    <span
                      style={{
                        color: 'var(--fg-muted)',
                        fontSize: 12,
                        marginLeft: 12,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {opt.hint}
                    </span>
                  )}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
