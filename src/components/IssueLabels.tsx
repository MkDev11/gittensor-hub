'use client';

import React from 'react';
import { Box } from '@primer/react';
import { useTheme, type ThemeMode } from '@/lib/theme';

type IssueLabel = { name: string; color?: string | null };

const FALLBACK_COLORS: Array<[RegExp, string]> = [
  [/\bbug\b/, 'd73a4a'],
  [/\b(feature|feat)\b/, '2da44e'],
  [/\benhancement\b/, 'a2eeef'],
  [/\b(documentation|docs?)\b/, '0075ca'],
  [/\bsecurity\b/, 'd1242f'],
  [/\b(good first issue|starter)\b/, '7057ff'],
  [/\bhelp wanted\b/, '008672'],
  [/\bquestion\b/, 'd876e3'],
  [/\b(duplicate|invalid|wontfix|not planned)\b/, '6e7781'],
];

function normalizeHexColor(color: string | null | undefined): string | null {
  const raw = color?.trim().replace(/^#/, '');
  if (!raw) return null;
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return raw
      .split('')
      .map((c) => c + c)
      .join('')
      .toLowerCase();
  }
  return null;
}

function fallbackColorFor(name: string): string {
  const normalized = name.trim().toLowerCase();
  const match = FALLBACK_COLORS.find(([pattern]) => pattern.test(normalized));
  return match?.[1] ?? '6e7781';
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

type ChipColors = { background: string; color: string; borderColor: string };

// Reproduce github.com's own label theming (computed here in JS so it never depends on
// CSS calc/custom-property plumbing): dark = translucent tint + lightened text + border;
// light = solid color bg + black/white text + subtle border. Matches the colors shown
// on a PR/issue page exactly.
function chipColors(hex: string, theme: ThemeMode): ChipColors {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const perceived = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;

  if (theme === 'light') {
    const lightnessSwitch = Math.max(0, Math.min((perceived - 0.6) * -1000, 1));
    const borderAlpha = Math.max(0, Math.min((perceived - 0.96) * 100, 1));
    return {
      background: `rgb(${r}, ${g}, ${b})`,
      color: `hsl(0, 0%, ${lightnessSwitch * 100}%)`,
      borderColor: `hsla(${h}, ${s}%, ${l - 25}%, ${borderAlpha})`,
    };
  }

  const threshold = 0.453;
  const lightnessSwitch = Math.max(0, Math.min((perceived - threshold) * -1000, 1));
  const lighten = (threshold - perceived) * 100 * lightnessSwitch;
  return {
    background: `rgba(${r}, ${g}, ${b}, 0.18)`,
    color: `hsl(${h}, ${s}%, ${l + lighten}%)`,
    borderColor: `hsla(${h}, ${s}%, ${l + lighten}%, 0.3)`,
  };
}

export const IssueLabelChip = React.memo(function IssueLabelChip({
  label,
  maxWidth = 120,
  theme = 'dark',
}: {
  label: IssueLabel;
  maxWidth?: number;
  theme?: ThemeMode;
}) {
  const hex = normalizeHexColor(label.color) ?? fallbackColorFor(label.name);
  const c = chipColors(hex, theme);

  return (
    <span
      title={label.name}
      style={{
        display: 'inline-block',
        padding: '0 7px',
        borderRadius: 999,
        border: `1px solid ${c.borderColor}`,
        background: c.background,
        color: c.color,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: '18px',
        whiteSpace: 'nowrap',
        maxWidth,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        verticalAlign: 'middle',
      }}
    >
      {label.name}
    </span>
  );
});

export const IssueLabels = React.memo(function IssueLabels({
  labels,
  maxVisible = 4,
  maxLabelWidth = 120,
  wrap = false,
}: {
  labels: IssueLabel[] | null | undefined;
  maxVisible?: number;
  maxLabelWidth?: number;
  wrap?: boolean;
}) {
  // One theme read for the whole label group (passed down to each chip) so the
  // colors track light/dark without a hook per chip.
  const { theme } = useTheme();

  if (!labels || labels.length === 0) return null;

  const visible = labels.slice(0, maxVisible);
  const hidden = labels.length - visible.length;

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        flexShrink: 0,
        flexWrap: wrap ? 'wrap' : 'nowrap',
        overflow: wrap ? 'visible' : 'hidden',
        maxWidth: '100%',
      }}
    >
      {visible.map((label) => (
        <IssueLabelChip key={label.name} label={label} maxWidth={maxLabelWidth} theme={theme} />
      ))}
      {hidden > 0 && (
        <span
          title={labels.slice(maxVisible).map((label) => label.name).join(', ')}
          style={{
            color: 'var(--fg-muted)',
            fontSize: 11,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          +{hidden}
        </span>
      )}
    </Box>
  );
});
