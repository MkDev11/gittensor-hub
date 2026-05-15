'use client';

import React, { useEffect, useState } from 'react';
import { Box, Text, Label, Link as PrimerLink } from '@primer/react';
import Spinner from '@/components/Spinner';
import {
  XIcon,
  CheckCircleIcon,
  XCircleIcon,
  AlertIcon,
  CopyIcon,
  CheckIcon,
  CpuIcon,
  RepoIcon,
} from '@primer/octicons-react';
import { useSelectedModel } from '@/lib/selected-model';
import { getModel, MODELS, type ModelId } from '@/lib/models';
import type { DeterministicResult, ScorePrediction } from '@/lib/validate';
import Dropdown from '@/components/Dropdown';
import { useSettings } from '@/lib/settings';

interface AIVerdict {
  ai_verdict?: 'valid' | 'invalid' | 'uncertain';
  confidence?: number;
  engineering_effort?: 'small' | 'medium' | 'large';
  reasoning?: string;
  risks?: string[];
  error?: string;
  missing_key?: 'anthropic' | 'openai';
  cached?: boolean;
  generated_at?: string;
  tokens_in?: number;
  tokens_out?: number;
}

interface ValidateResp {
  deterministic: DeterministicResult;
  score: ScorePrediction;
  ai: AIVerdict | null;
}

interface PromptResp {
  prompt?: string;
  cached?: boolean;
  generated_at?: string;
  tokens_in?: number;
  tokens_out?: number;
  error?: string;
  missing_key?: 'anthropic' | 'openai';
}

interface DuplicateCheckResp {
  is_duplicate: boolean;
  duplicate_of_number: number | null;
  confidence: 'low' | 'medium' | 'high' | null;
  reasoning: string | null;
  cached?: boolean;
  generated_at?: string;
  error?: string;
  missing_key?: 'anthropic' | 'openai';
}

export default function ValidateIssueDialog({
  owner,
  name,
  number,
  title,
  onClose,
}: {
  owner: string;
  name: string;
  number: number;
  title: string;
  onClose: () => void;
}) {
  const { settings } = useSettings();
  const mode: 'modal' | 'side' = settings.validateDisplay === 'side' ? 'side' : 'modal';
  const panelRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode !== 'side') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [mode, onClose]);
  const { model: globalModel, setModel: setGlobalModel } = useSelectedModel();
  const [model, setModelLocal] = useState<ModelId>(globalModel);
  const modelInfo = getModel(model);

  useEffect(() => {
    setModelLocal(globalModel);
  }, [globalModel]);

  const handleModelChange = (next: ModelId) => {
    setModelLocal(next);
    setGlobalModel(next);
  };

  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState<ValidateResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [prompt, setPrompt] = useState<PromptResp | null>(null);
  const [copied, setCopied] = useState(false);

  const [dupChecking, setDupChecking] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateCheckResp | null>(null);

  useEffect(() => {
    void runValidate();
    void runDuplicateCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, owner, name, number]);

  const runDuplicateCheck = async () => {
    setDupChecking(true);
    setDuplicate(null);
    try {
      const r = await fetch(`/api/check-duplicate/${owner}/${name}/${number}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      const j = (await r.json()) as DuplicateCheckResp;
      setDuplicate(j);
    } catch (err) {
      setDuplicate({
        is_duplicate: false,
        duplicate_of_number: null,
        confidence: null,
        reasoning: err instanceof Error ? err.message : String(err),
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDupChecking(false);
    }
  };

  const runValidate = async () => {
    setValidating(true);
    setError(null);
    setResult(null);
    setPrompt(null);
    setCopied(false);
    try {
      const r = await fetch(`/api/validate/${owner}/${name}/${number}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${r.status}`);
      }
      setResult(await r.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
    }
  };

  const runGenerate = async () => {
    setGenerating(true);
    setPrompt(null);
    try {
      const r = await fetch(`/api/prompt/${owner}/${name}/${number}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      const j = (await r.json()) as PromptResp;
      setPrompt(j);
    } catch (err) {
      setPrompt({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setGenerating(false);
    }
  };

  const copy = async () => {
    if (!prompt?.prompt) return;
    await navigator.clipboard.writeText(prompt.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isSide = mode === 'side';

  return (
    <Box
      ref={isSide ? (panelRef as unknown as React.Ref<HTMLDivElement>) : undefined}
      sx={
        isSide
          ? {
              position: 'relative',
              width: '100%',
              height: '100%',
              bg: 'canvas.default',
              animation: 'slideInRight 240ms cubic-bezier(0.16, 1, 0.3, 1)',
              '@keyframes slideInRight': {
                from: { transform: 'translateX(100%)', opacity: 0 },
                to: { transform: 'translateX(0)', opacity: 1 },
              },
              overflowY: 'auto',
              overflowX: 'hidden',
            }
          : {
              position: 'fixed',
              inset: 0,
              bg: 'rgba(0, 0, 0, 0.65)',
              zIndex: 9000,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'center',
              py: 4,
              overflowY: 'auto',
            }
      }
      onClick={isSide ? undefined : onClose}
    >
      <Box
        onClick={isSide ? undefined : (e: React.MouseEvent) => e.stopPropagation()}
        sx={
          isSide
            ? {
                bg: 'canvas.default',
                width: '100%',
              }
            : {
                bg: 'canvas.default',
                border: '1px solid',
                borderColor: 'border.default',
                borderRadius: 2,
                width: '100%',
                maxWidth: 880,
                mx: 3,
                boxShadow: 'shadow.large',
              }
        }
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            p: 3,
            borderBottom: '1px solid',
            borderColor: 'border.default',
            bg: 'canvas.subtle',
          }}
        >
          <RepoIcon size={16} />
          <Text sx={{ color: 'fg.muted', fontSize: 1 }}>
            {owner}/{name}
          </Text>
          <Text sx={{ color: 'fg.muted', fontSize: 1 }}>#{number}</Text>
          <Text sx={{ fontWeight: 600, color: 'fg.default', fontSize: 1, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </Text>
          {!isSide && (
            <>
              <Dropdown
                value={model}
                onChange={(v) => handleModelChange(v as ModelId)}
                options={MODELS.map((m) => ({ value: m.id, label: m.label, hint: m.badge }))}
                width={220}
                align="right"
                ariaLabel="Pick AI model for this issue"
                leadingVisual={<CpuIcon size={14} />}
              />
              <Box
                as="button"
                onClick={onClose}
                sx={{
                  cursor: 'pointer',
                  border: 'none',
                  bg: 'transparent',
                  color: 'fg.muted',
                  p: 1,
                  borderRadius: 1,
                  '&:hover': { bg: 'canvas.inset', color: 'fg.default' },
                }}
                aria-label="Close"
              >
                <XIcon size={16} />
              </Box>
            </>
          )}
        </Box>

        <Box sx={{ p: 3 }}>
          <DuplicateAlert
            owner={owner}
            name={name}
            checking={dupChecking}
            duplicate={duplicate}
          />

          {result?.score && <ScorePanel score={result.score} />}

          <SectionHeader title="Deterministic checks" subtitle="From SN74's own validity rules — no AI involved." />
          {validating && !result && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'fg.muted', mb: 3 }}>
              <Spinner size="sm" tone="muted" inline />
              <Text>Running…</Text>
            </Box>
          )}
          {error && (
            <Box sx={{ p: 2, border: '1px solid', borderColor: 'danger.emphasis', bg: 'danger.subtle', borderRadius: 2, mb: 3 }}>
              <Text sx={{ color: 'danger.fg', fontSize: 1 }}>{error}</Text>
            </Box>
          )}
          {result && (
            <Box sx={{ mb: 3 }}>
              <VerdictHeader
                verdict={result.deterministic.verdict}
                multiplier={result.deterministic.predictedMultiplier}
              />
              <Box sx={{ mt: 2, border: '1px solid', borderColor: 'border.default', borderRadius: 2, overflow: 'hidden' }}>
                {result.deterministic.checks.map((c, i) => (
                  <Box
                    key={c.id}
                    sx={{
                      display: 'flex',
                      gap: 2,
                      p: 2,
                      borderBottom: i === result.deterministic.checks.length - 1 ? 'none' : '1px solid',
                      borderColor: 'border.muted',
                      alignItems: 'flex-start',
                    }}
                  >
                    <Box sx={{ pt: '2px' }}>
                      {c.status === 'pass' && <CheckCircleIcon size={16} className="check-pass" />}
                      {c.status === 'fail' && <XCircleIcon size={16} className="check-fail" />}
                      {c.status === 'warn' && <AlertIcon size={16} className="check-warn" />}
                    </Box>
                    <Box sx={{ flex: 1 }}>
                      <Text sx={{ fontWeight: 600, color: c.status === 'fail' ? 'danger.fg' : c.status === 'warn' ? 'attention.fg' : 'fg.default', fontSize: 1 }}>
                        {c.label}
                      </Text>
                      <Text sx={{ color: 'fg.muted', fontSize: 0, display: 'block', mt: 1 }}>
                        {c.detail}
                      </Text>
                    </Box>
                  </Box>
                ))}
              </Box>
              <style jsx global>{`
                .check-pass { color: #3fb950; }
                .check-fail { color: #f85149; }
                .check-warn { color: #d29922; }
              `}</style>
            </Box>
          )}

          <SectionHeader title={`AI judgment — ${modelInfo.label}`} subtitle="Solvability and engineering-effort estimate from the selected model (run at max reasoning)." />
          {result?.ai?.error && (
            <Box sx={{ p: 2, border: '1px solid', borderColor: 'attention.emphasis', bg: 'attention.subtle', borderRadius: 2, mb: 3 }}>
              <Text sx={{ color: 'attention.fg', fontSize: 1 }}>{result.ai.error}</Text>
              {result.ai.missing_key && (
                <Text sx={{ color: 'fg.muted', fontSize: 0, display: 'block', mt: 1 }}>
                  Add the missing key to <code>.env.local</code> and restart the dev server.
                </Text>
              )}
            </Box>
          )}
          {result?.ai && !result.ai.error && (
            <AIVerdictCard verdict={result.ai} />
          )}

          <SectionHeader
            title="Generate fix prompt"
            subtitle={`Crafted for ${modelInfo.label}. Paste it into your AI coding tool to produce a PR.`}
          />
          {!prompt && (
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <Box
                as="button"
                onClick={runGenerate}
                disabled={generating}
                sx={{
                  px: 3,
                  py: 2,
                  border: '1px solid',
                  borderColor: 'border.default',
                  borderRadius: 2,
                  bg: 'btn.primary.bg',
                  color: 'btn.primary.text',
                  fontWeight: 600,
                  fontSize: 1,
                  cursor: generating ? 'not-allowed' : 'pointer',
                  opacity: generating ? 0.6 : 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                  '&:hover': { bg: 'btn.primary.hoverBg' },
                }}
              >
                {generating ? <Spinner size="sm" tone="inherit" inline /> : <CpuIcon size={14} />}
                {generating ? 'Generating…' : 'Generate prompt'}
              </Box>
              <Dropdown
                value={model}
                onChange={(v) => handleModelChange(v as ModelId)}
                options={MODELS.map((m) => ({ value: m.id, label: m.label, hint: m.badge }))}
                width={220}
                ariaLabel="Pick AI model for this issue"
                leadingVisual={<CpuIcon size={14} />}
              />
            </Box>
          )}

          {prompt?.error && (
            <Box sx={{ p: 2, border: '1px solid', borderColor: 'danger.emphasis', bg: 'danger.subtle', borderRadius: 2 }}>
              <Text sx={{ color: 'danger.fg', fontSize: 1 }}>{prompt.error}</Text>
            </Box>
          )}

          {prompt?.prompt && (
            <Box sx={{ mt: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                <Box
                  as="button"
                  onClick={copy}
                  sx={{
                    px: 2,
                    py: 1,
                    border: '1px solid',
                    borderColor: copied ? 'success.emphasis' : 'border.default',
                    borderRadius: 2,
                    bg: copied ? 'success.subtle' : 'btn.bg',
                    color: copied ? 'success.fg' : 'fg.default',
                    fontSize: 0,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 1,
                    '&:hover': { borderColor: 'border.emphasis' },
                  }}
                >
                  {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                  {copied ? 'Copied!' : 'Copy prompt'}
                </Box>
                <Box
                  as="button"
                  onClick={runGenerate}
                  disabled={generating}
                  sx={{
                    px: 2,
                    py: 1,
                    border: '1px solid',
                    borderColor: 'border.default',
                    borderRadius: 2,
                    bg: 'btn.bg',
                    color: 'fg.default',
                    fontSize: 0,
                    fontWeight: 600,
                    cursor: generating ? 'not-allowed' : 'pointer',
                    opacity: generating ? 0.6 : 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 1,
                    '&:hover': { borderColor: 'border.emphasis' },
                  }}
                >
                  {generating && <Spinner size="xs" tone="inherit" inline />}
                  {generating ? 'Generating…' : 'Regenerate'}
                </Box>
                <Text sx={{ ml: 'auto', color: 'fg.muted', fontSize: 0 }}>
                  {prompt.cached ? 'cached' : 'fresh'}
                  {prompt.tokens_in && prompt.tokens_out && ` · ${prompt.tokens_in}→${prompt.tokens_out} tokens`}
                </Text>
              </Box>
              <Box
                as="pre"
                sx={{
                  bg: 'canvas.inset',
                  border: '1px solid',
                  borderColor: 'border.default',
                  borderRadius: 2,
                  p: 3,
                  fontSize: 0,
                  fontFamily: 'mono',
                  whiteSpace: 'pre-wrap',
                  wordWrap: 'break-word',
                  maxHeight: 360,
                  overflowY: 'auto',
                  m: 0,
                  color: 'fg.default',
                }}
              >
                {prompt.prompt}
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function DuplicateAlert({
  owner,
  name,
  checking,
  duplicate,
}: {
  owner: string;
  name: string;
  checking: boolean;
  duplicate: DuplicateCheckResp | null;
}) {
  if (checking) {
    return (
      <Box
        sx={{
          mb: 3,
          p: 2,
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          bg: 'canvas.subtle',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          color: 'fg.muted',
          fontSize: 1,
        }}
      >
        <Spinner size="sm" tone="muted" inline />
        <Text>Checking for duplicate issues…</Text>
      </Box>
    );
  }
  if (!duplicate || duplicate.error) {
    // Soft-fail — don't surface our duplicate-check errors as alarms in the
    // validate dialog; the rest of the validation already runs independently.
    return null;
  }
  if (!duplicate.is_duplicate) return null;

  const dupNum = duplicate.duplicate_of_number;
  const url = dupNum ? `https://github.com/${owner}/${name}/issues/${dupNum}` : null;
  const conf = duplicate.confidence ?? 'medium';
  return (
    <Box
      sx={{
        mb: 3,
        p: 3,
        border: '1px solid',
        borderColor: 'attention.emphasis',
        borderRadius: 2,
        bg: 'attention.subtle',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 2,
      }}
    >
      <Box sx={{ color: 'attention.fg', mt: '2px' }}>
        <AlertIcon size={16} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Text sx={{ fontWeight: 600, color: 'attention.fg', display: 'block', mb: 1 }}>
          Possible duplicate {conf === 'high' ? '(high confidence)' : conf === 'medium' ? '(medium confidence)' : '(low confidence)'}
        </Text>
        {dupNum != null && url && (
          <Text sx={{ color: 'fg.default', fontSize: 1, display: 'block', mb: 1 }}>
            Looks similar to{' '}
            <PrimerLink
              href={url}
              target="_blank"
              rel="noreferrer"
              sx={{ color: 'accent.fg', fontWeight: 600 }}
            >
              #{dupNum}
            </PrimerLink>
            . Fixing this issue may not earn rewards if the maintainer closes it as a duplicate.
          </Text>
        )}
        {duplicate.reasoning && (
          <Text sx={{ color: 'fg.muted', fontSize: 0, display: 'block' }}>{duplicate.reasoning}</Text>
        )}
      </Box>
    </Box>
  );
}

function ScorePanel({ score }: { score: ScorePrediction }) {
  const isZero = score.predicted === 0;
  return (
    <Box
      sx={{
        mb: 4,
        p: 3,
        border: '1px solid',
        borderColor: isZero ? 'danger.emphasis' : 'success.emphasis',
        borderRadius: 2,
        bg: isZero ? 'danger.subtle' : 'rgba(46, 160, 67, 0.08)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 3, flexWrap: 'wrap' }}>
        <Box>
          <Text sx={{ fontSize: 0, color: 'fg.muted', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, display: 'block' }}>
            Predicted SN74 Score
          </Text>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mt: 1 }}>
            <Text
              sx={{
                fontSize: '32px',
                fontWeight: 700,
                color: isZero ? 'danger.fg' : 'success.fg',
                fontFamily: 'mono',
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
              }}
            >
              {score.predicted.toFixed(2)}
            </Text>
            <Text sx={{ color: 'fg.muted', fontSize: 1 }}>points</Text>
          </Box>
          {!isZero && (
            <Text sx={{ color: 'fg.muted', fontSize: 0, display: 'block', mt: 1 }}>
              Range: <strong>{score.worst.toFixed(2)}</strong> – <strong>{score.best.toFixed(2)}</strong> depending on PR labels and time-decay
            </Text>
          )}
        </Box>
        <Box sx={{ ml: 'auto', minWidth: 280 }}>
          <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block', mb: 1 }}>Formula</Text>
          <Box
            sx={{
              p: 2,
              bg: 'canvas.inset',
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 1,
              fontFamily: 'mono',
              fontSize: 0,
              color: 'fg.default',
              overflowX: 'auto',
            }}
          >
            {score.formula}
          </Box>
        </Box>
      </Box>
      {!isZero && (
        <Box sx={{ mt: 3, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 2 }}>
          {score.breakdown.map((b, i) => (
            <Box
              key={i}
              sx={{
                p: 2,
                bg: 'canvas.subtle',
                border: '1px solid',
                borderColor: 'border.muted',
                borderRadius: 1,
              }}
            >
              <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block' }}>{b.factor}</Text>
              <Text sx={{ fontWeight: 600, fontSize: 1, fontFamily: 'mono', color: 'fg.default' }}>
                ×{b.value.toFixed(typeof b.value === 'number' && b.value < 1 ? 4 : 2)}
              </Text>
              <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block', mt: 1 }}>{b.note}</Text>
            </Box>
          ))}
        </Box>
      )}
      {isZero && (
        <Text sx={{ color: 'fg.muted', fontSize: 1, display: 'block', mt: 2 }}>
          {score.breakdown[0]?.note}
        </Text>
      )}
    </Box>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Text sx={{ fontWeight: 600, fontSize: 1, color: 'fg.default', display: 'block' }}>{title}</Text>
      <Text sx={{ color: 'fg.muted', fontSize: 0 }}>{subtitle}</Text>
    </Box>
  );
}

function VerdictHeader({ verdict, multiplier }: { verdict: 'valid' | 'invalid' | 'unknown'; multiplier: number }) {
  const cfg =
    verdict === 'valid'
      ? { bg: 'success.subtle', border: 'success.emphasis', color: 'success.fg', label: 'VALID', icon: <CheckCircleIcon size={16} /> }
      : verdict === 'invalid'
      ? { bg: 'danger.subtle', border: 'danger.emphasis', color: 'danger.fg', label: 'INVALID', icon: <XCircleIcon size={16} /> }
      : { bg: 'attention.subtle', border: 'attention.emphasis', color: 'attention.fg', label: 'UNCLEAR', icon: <AlertIcon size={16} /> };
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 2, p: 2, borderRadius: 2, border: '1px solid', borderColor: cfg.border, bg: cfg.bg }}>
      <Box sx={{ color: cfg.color }}>{cfg.icon}</Box>
      <Text sx={{ fontWeight: 700, color: cfg.color, fontSize: 1 }}>{cfg.label}</Text>
      <Text sx={{ color: 'fg.muted', fontSize: 0 }}>
        Predicted PR-link multiplier: <strong>{multiplier.toFixed(2)}x</strong>
      </Text>
    </Box>
  );
}

function AIVerdictCard({ verdict }: { verdict: AIVerdict }) {
  const v = verdict.ai_verdict ?? 'uncertain';
  const cfg =
    v === 'valid'
      ? { bg: 'success.subtle', border: 'success.emphasis', color: 'success.fg', label: 'AI: VALID' }
      : v === 'invalid'
      ? { bg: 'danger.subtle', border: 'danger.emphasis', color: 'danger.fg', label: 'AI: INVALID' }
      : { bg: 'attention.subtle', border: 'attention.emphasis', color: 'attention.fg', label: 'AI: UNCERTAIN' };
  return (
    <Box sx={{ p: 3, border: '1px solid', borderColor: cfg.border, bg: cfg.bg, borderRadius: 2, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
        <Text sx={{ fontWeight: 700, color: cfg.color, fontSize: 1 }}>{cfg.label}</Text>
        {typeof verdict.confidence === 'number' && (
          <Label variant="secondary">confidence {(verdict.confidence * 100).toFixed(0)}%</Label>
        )}
        {verdict.engineering_effort && (
          <Label variant="secondary" title="Estimated human coding work to fix the issue">
            engineering: {verdict.engineering_effort}
          </Label>
        )}
        {verdict.cached && <Label variant="secondary">cached</Label>}
      </Box>
      {verdict.reasoning && (
        <Text sx={{ fontSize: 1, color: 'fg.default', display: 'block', mb: 2 }}>{verdict.reasoning}</Text>
      )}
      {verdict.risks && verdict.risks.length > 0 && (
        <Box>
          <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block', mb: 1 }}>Risks to consider:</Text>
          <Box as="ul" sx={{ m: 0, pl: 4, color: 'fg.default', fontSize: 0 }}>
            {verdict.risks.map((r, i) => (
              <Box as="li" key={i} sx={{ mb: 1 }}>
                {r}
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}
