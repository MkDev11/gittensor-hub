import { theme as primerTheme } from '@primer/react';

/* Linear-inspired override for Primer's theme. Swaps both color schemes
 * so sx-prop consumers (`bg: 'canvas.subtle'` etc.) track the new palette. */

interface LinearColors {
  canvas: { default: string; overlay: string; inset: string; subtle: string };
  fg: { default: string; muted: string; subtle: string; onEmphasis: string };
  border: { default: string; muted: string; subtle: string };
  accent: { fg: string; emphasis: string; subtle: string; muted: string };
  success: { fg: string; emphasis: string; subtle: string; muted: string };
  attention: { fg: string; emphasis: string; subtle: string; muted: string };
  danger: { fg: string; emphasis: string; subtle: string; muted: string };
  neutral: { emphasisPlus: string; emphasis: string; muted: string; subtle: string };
  // Issue/PR semantic states — re-colored for Linear (StatusBadge).
  open: { fg: string; emphasis: string; subtle: string; muted: string };
  closed: { fg: string; emphasis: string; subtle: string; muted: string };
  done: { fg: string; emphasis: string; subtle: string; muted: string };
  severe: { fg: string; emphasis: string; subtle: string; muted: string };
  // Primer v37 <Button variant="primary"> reads CSS vars, not the theme —
  // see `--button-primary-*` in globals.css. Kept for theme-reading consumers.
  btn: { primary: { bg: string; text: string; hoverBg: string; selectedBg: string; border: string } };
}

const dark: LinearColors = {
  canvas: { default: '#08090a', overlay: '#1c1d20', inset: '#050506', subtle: '#101113' },
  fg: { default: '#f7f8f8', muted: '#b4bcd0', subtle: '#8a8f98', onEmphasis: '#ffffff' },
  border: { default: '#23252a', muted: '#1a1c1f', subtle: 'rgba(255, 255, 255, 0.04)' },
  accent: {
    fg: '#b4bdff',
    emphasis: '#5e6ad2',
    subtle: 'rgba(94, 106, 210, 0.16)',
    muted: 'rgba(94, 106, 210, 0.40)',
  },
  success: {
    fg: '#4cb782',
    emphasis: '#3fa672',
    subtle: 'rgba(76, 183, 130, 0.16)',
    muted: 'rgba(76, 183, 130, 0.40)',
  },
  attention: {
    fg: '#f2c94c',
    emphasis: '#e0b53d',
    subtle: 'rgba(242, 201, 76, 0.14)',
    muted: 'rgba(242, 201, 76, 0.38)',
  },
  danger: {
    fg: '#eb5757',
    emphasis: '#d63b3b',
    subtle: 'rgba(235, 87, 87, 0.14)',
    muted: 'rgba(235, 87, 87, 0.40)',
  },
  neutral: {
    emphasisPlus: '#3a3d44',
    emphasis: '#2a2c30',
    muted: 'rgba(255, 255, 255, 0.06)',
    subtle: 'rgba(255, 255, 255, 0.03)',
  },
  open: {
    fg: '#4cb782',
    emphasis: '#3fa672',
    subtle: 'rgba(76, 183, 130, 0.16)',
    muted: 'rgba(76, 183, 130, 0.40)',
  },
  closed: {
    fg: '#eb5757',
    emphasis: '#d63b3b',
    subtle: 'rgba(235, 87, 87, 0.14)',
    muted: 'rgba(235, 87, 87, 0.40)',
  },
  done: {
    fg: '#a584ff',
    emphasis: '#8866ee',
    subtle: 'rgba(165, 132, 255, 0.14)',
    muted: 'rgba(165, 132, 255, 0.40)',
  },
  severe: {
    fg: '#f2994a',
    emphasis: '#e0823d',
    subtle: 'rgba(242, 153, 74, 0.14)',
    muted: 'rgba(242, 153, 74, 0.40)',
  },
  btn: {
    primary: {
      bg: '#5e6ad2',
      text: '#ffffff',
      hoverBg: '#6e79de',
      selectedBg: '#4b56b9',
      border: 'transparent',
    },
  },
};

const light: LinearColors = {
  canvas: { default: '#ffffff', overlay: '#ffffff', inset: '#f4f5f7', subtle: '#f9fafb' },
  fg: { default: '#161617', muted: '#4a4d54', subtle: '#6b7280', onEmphasis: '#ffffff' },
  border: { default: '#e6e6e8', muted: '#efeff1', subtle: 'rgba(0, 0, 0, 0.04)' },
  accent: {
    fg: '#5e6ad2',
    emphasis: '#5e6ad2',
    subtle: 'rgba(94, 106, 210, 0.10)',
    muted: 'rgba(94, 106, 210, 0.32)',
  },
  success: {
    fg: '#1a6943',
    emphasis: '#1a6943',
    subtle: 'rgba(26, 105, 67, 0.10)',
    muted: 'rgba(26, 105, 67, 0.32)',
  },
  // Darkened from #ad7d1f to meet AA on light backgrounds (6.54:1 on white).
  attention: {
    fg: '#7d5614',
    emphasis: '#7d5614',
    subtle: 'rgba(125, 86, 20, 0.10)',
    muted: 'rgba(125, 86, 20, 0.32)',
  },
  danger: {
    fg: '#a72424',
    emphasis: '#a72424',
    subtle: 'rgba(167, 36, 36, 0.10)',
    muted: 'rgba(167, 36, 36, 0.32)',
  },
  neutral: {
    emphasisPlus: '#161617',
    emphasis: '#4a4d54',
    muted: 'rgba(0, 0, 0, 0.06)',
    subtle: 'rgba(0, 0, 0, 0.03)',
  },
  open: {
    fg: '#1a6943',
    emphasis: '#1a6943',
    subtle: 'rgba(26, 105, 67, 0.10)',
    muted: 'rgba(26, 105, 67, 0.32)',
  },
  closed: {
    fg: '#a72424',
    emphasis: '#a72424',
    subtle: 'rgba(167, 36, 36, 0.10)',
    muted: 'rgba(167, 36, 36, 0.32)',
  },
  done: {
    fg: '#5635c3',
    emphasis: '#5635c3',
    subtle: 'rgba(86, 53, 195, 0.10)',
    muted: 'rgba(86, 53, 195, 0.32)',
  },
  severe: {
    fg: '#c66628',
    emphasis: '#c66628',
    subtle: 'rgba(198, 102, 40, 0.10)',
    muted: 'rgba(198, 102, 40, 0.32)',
  },
  btn: {
    primary: {
      bg: '#5e6ad2',
      text: '#ffffff',
      hoverBg: '#4b56b9',
      selectedBg: '#4b56b9',
      border: 'transparent',
    },
  },
};

type AnyRecord = Record<string, unknown>;
function deepMerge<T extends AnyRecord>(base: T, override: Partial<T>): T {
  const out: AnyRecord = { ...base };
  for (const [k, v] of Object.entries(override)) {
    const cur = out[k];
    if (
      cur &&
      typeof cur === 'object' &&
      !Array.isArray(cur) &&
      v &&
      typeof v === 'object' &&
      !Array.isArray(v)
    ) {
      out[k] = deepMerge(cur as AnyRecord, v as AnyRecord);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export const linearTheme = deepMerge(primerTheme as unknown as AnyRecord, {
  // Route Primer's sx font tokens through the same Inter / JetBrains Mono
  // pair next/font registers as `--font-sans` / `--font-mono`. Without this,
  // `sx={{ fontFamily: 'mono' }}` still resolves to Primer's default stack.
  fonts: {
    normal: 'var(--font-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    mono: 'var(--font-mono), ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
  },
  colorSchemes: {
    dark: { colors: dark },
    light: { colors: light },
  },
});
