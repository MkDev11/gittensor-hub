'use client';

import React, { useEffect, useMemo } from 'react';
import { Box, Text } from '@primer/react';
import { CpuIcon } from '@primer/octicons-react';
import { clampEffort, getModel, MODELS, type Effort, type ModelId } from '@/lib/models';
import { useSelectedEffort, useSelectedModel, useThinkingEnabled } from '@/lib/selected-model';
import Dropdown from '@/components/Dropdown';

const EFFORT_LABELS: Record<Effort, { label: string; hint: string }> = {
  low: { label: 'Fast', hint: 'low effort' },
  medium: { label: 'Balanced', hint: 'medium effort' },
  high: { label: 'Deep', hint: 'high effort' },
  max: { label: 'Max', hint: 'maximum effort' },
};

export default function ModelSelector({ compact = false }: { compact?: boolean }) {
  const { model, setModel } = useSelectedModel();
  const { effort, setEffort } = useSelectedEffort();
  const { thinking, setThinking } = useThinkingEnabled();
  const info = getModel(model);

  // Each model exposes its own subset of effort tiers (Opus 4.7 has the
  // dedicated 'max' tier, the rest top out at 'high'). When the user picks
  // a model that doesn't support the currently-selected effort, fall back
  // to that model's highest tier so the API call doesn't fail.
  const effortOptions = useMemo(
    () => info.supportedEfforts.map((e) => ({ value: e, ...EFFORT_LABELS[e] })),
    [info.supportedEfforts],
  );

  useEffect(() => {
    const clamped = clampEffort(effort, info);
    if (clamped !== effort) setEffort(clamped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
      {!compact && <Text sx={{ color: 'fg.muted', fontSize: 0 }}>AI Model</Text>}
      <Dropdown
        value={model}
        onChange={(v) => setModel(v as ModelId)}
        options={MODELS.map((m) => ({ value: m.id, label: m.label, hint: m.badge }))}
        width={compact ? 200 : 220}
        align="right"
        ariaLabel="AI model"
        leadingVisual={<CpuIcon size={14} />}
      />
      {effortOptions.length > 0 && (
        <Dropdown
          value={clampEffort(effort, info)}
          onChange={(v) => setEffort(v as Effort)}
          options={effortOptions}
          width={compact ? 120 : 140}
          size="small"
          align="right"
          ariaLabel="Reasoning effort / speed"
        />
      )}
      {info.supportsThinking && (
        <Box
          as="button"
          onClick={() => setThinking(!thinking)}
          title={
            info.provider === 'anthropic'
              ? thinking
                ? 'Adaptive thinking on — used at high/max effort'
                : 'Thinking off — direct response, no adaptive thinking'
              : thinking
                ? 'Reasoning on — model thinks before answering'
                : 'Reasoning off — pinned to minimal effort'
          }
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            height: 28,
            border: '1px solid',
            borderColor: thinking ? 'var(--accent-emphasis)' : 'var(--border-default)',
            bg: thinking ? 'rgba(88, 166, 255, 0.12)' : 'var(--bg-canvas)',
            color: thinking ? 'var(--accent-fg)' : 'var(--fg-muted)',
            borderRadius: 6,
            fontSize: 0,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Thinking {thinking ? 'on' : 'off'}
        </Box>
      )}
    </Box>
  );
}
