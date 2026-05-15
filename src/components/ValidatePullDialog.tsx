'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, Link as PrimerLink } from '@primer/react';
import Spinner from '@/components/Spinner';
import { XIcon, CheckCircleIcon, XCircleIcon, AlertIcon, GitPullRequestIcon, IssueOpenedIcon, type Icon } from '@primer/octicons-react';
import { useSelectedEffort, useSelectedModel, useThinkingEnabled } from '@/lib/selected-model';
import { MODELS, type ModelId } from '@/lib/models';
import Dropdown from '@/components/Dropdown';
import { useSettings } from '@/lib/settings';

interface AiResp {
  verdict: string;
  markdown: string;
  cached: boolean;
  generated_at: string;
  model: ModelId;
  tokens_in?: number;
  tokens_out?: number;
  error?: string;
  missing_key?: 'anthropic' | 'openai';
}

interface ValidatePullResp {
  ai: AiResp | null;
  pr: { number: number; title: string; html_url: string | null };
  linked_issues: Array<{ number: number; title: string; state: string; state_reason: string | null }>;
}

/** Minimal markdown -> JSX renderer scoped to the structure the validation
 *  prompt produces: H2 sections, bullet lists, paragraphs, inline code. We
 *  avoid pulling in a full markdown library for one screen. */
function renderMarkdown(md: string): React.ReactNode {
  if (!md) return null;
  const lines = md.split('\n');
  const out: React.ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    out.push(
      <Text key={`p-${out.length}`} as="p" sx={{ display: 'block', mb: 2, lineHeight: 1.55, color: 'var(--fg-default)' }}>
        {renderInline(para.join(' '))}
      </Text>,
    );
    para = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    out.push(
      <Box as="ul" key={`ul-${out.length}`} sx={{ pl: 4, mb: 2 }}>
        {list.map((item, i) => (
          <Box as="li" key={i} sx={{ mb: 1, color: 'var(--fg-default)', lineHeight: 1.5 }}>
            {renderInline(item)}
          </Box>
        ))}
      </Box>,
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      flushPara();
      flushList();
      out.push(
        <Text
          key={`h-${out.length}`}
          as="h3"
          sx={{ display: 'block', fontSize: 2, fontWeight: 700, mt: 3, mb: 2, color: 'var(--fg-default)' }}
        >
          {line.slice(3).trim()}
        </Text>,
      );
    } else if (/^[-*]\s+/.test(line)) {
      flushPara();
      list.push(line.replace(/^[-*]\s+/, ''));
    } else if (line.trim() === '') {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out;
}

function renderInline(text: string): React.ReactNode {
  // Inline code spans only — bold/italic aren't worth a full parser here.
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`')) {
      return (
        <Text
          key={i}
          as="code"
          sx={{
            fontFamily: 'mono',
            fontSize: 0,
            bg: 'var(--bg-emphasis)',
            color: 'var(--fg-default)',
            px: '4px',
            py: '1px',
            borderRadius: 1,
          }}
        >
          {p.slice(1, -1)}
        </Text>
      );
    }
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

interface VerdictPillStyle {
  icon: Icon;
  bg: string;
  fg: string;
  label: string;
}

function verdictStyle(verdict: string): VerdictPillStyle {
  switch (verdict) {
    case 'ready':
      return { icon: CheckCircleIcon, bg: 'rgba(46, 160, 67, 0.18)', fg: 'var(--success-fg)', label: 'Ready to submit' };
    case 'needs_cleanup':
      return { icon: AlertIcon, bg: 'rgba(187, 128, 9, 0.18)', fg: '#d29922', label: 'Needs small cleanup' };
    case 'needs_changes':
      return { icon: AlertIcon, bg: 'rgba(248, 81, 73, 0.16)', fg: 'var(--danger-fg)', label: 'Needs functional changes' };
    case 'invalid':
      return { icon: XCircleIcon, bg: 'rgba(248, 81, 73, 0.20)', fg: 'var(--danger-fg)', label: 'Not valid for this issue' };
    case 'error':
      return { icon: XCircleIcon, bg: 'rgba(248, 81, 73, 0.16)', fg: 'var(--danger-fg)', label: 'Error' };
    default:
      return { icon: AlertIcon, bg: 'var(--bg-emphasis)', fg: 'var(--fg-muted)', label: verdict || 'Uncertain' };
  }
}

export default function ValidatePullDialog({
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
  const { model: globalModel, setModel: setGlobalModel } = useSelectedModel();
  const { effort } = useSelectedEffort();
  const { thinking } = useThinkingEnabled();
  const [model, setModelLocal] = useState<ModelId>(globalModel);
  useEffect(() => setModelLocal(globalModel), [globalModel]);
  const handleModelChange = (next: ModelId) => {
    setModelLocal(next);
    setGlobalModel(next);
  };

  const [validating, setValidating] = useState(false);
  const [data, setData] = useState<ValidatePullResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ranOnce = useRef(false);

  const runValidate = async () => {
    setValidating(true);
    setError(null);
    try {
      const r = await fetch(`/api/validate-pr/${owner}/${name}/${number}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, effort, thinking }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const j = (await r.json()) as ValidatePullResp;
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setValidating(false);
    }
  };

  useEffect(() => {
    if (ranOnce.current) return;
    ranOnce.current = true;
    void runValidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-run when the user changes model, effort, or thinking — each changes
  // the cached row's key so we'd otherwise serve a stale verdict.
  useEffect(() => {
    if (!ranOnce.current) return;
    void runValidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, effort, thinking]);

  useEffect(() => {
    if (mode !== 'side') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mode, onClose]);

  const ai = data?.ai ?? null;
  const vstyle = ai ? verdictStyle(ai.verdict) : null;
  const VerdictIcon = vstyle?.icon;

  const content = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <Box
        sx={{
          flexShrink: 0,
          p: 3,
          borderBottom: '1px solid',
          borderColor: 'var(--border-default)',
          bg: 'var(--bg-subtle)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <GitPullRequestIcon size={16} />
          <Text sx={{ fontWeight: 600, color: 'var(--fg-default)' }}>Validate PR #{number}</Text>
          <Box
            as="button"
            onClick={onClose}
            sx={{
              ml: 'auto',
              cursor: 'pointer',
              border: 'none',
              bg: 'transparent',
              color: 'var(--fg-muted)',
              p: 1,
              borderRadius: 1,
              display: 'inline-flex',
              alignItems: 'center',
              '&:hover': { bg: 'var(--bg-emphasis)', color: 'var(--fg-default)' },
            }}
            title="Close"
          >
            <XIcon size={14} />
          </Box>
        </Box>
        <Text
          as="p"
          sx={{ display: 'block', color: 'var(--fg-muted)', fontSize: 0, mb: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={title}
        >
          {title}
        </Text>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Dropdown
            value={model}
            onChange={(v) => handleModelChange(v as ModelId)}
            options={MODELS.map((m) => ({ value: m.id, label: m.label, hint: m.badge }))}
            width={220}
            size="small"
            ariaLabel="Choose model"
          />
          {data?.pr.html_url && (
            <PrimerLink href={data.pr.html_url} target="_blank" rel="noreferrer" sx={{ fontSize: 0 }}>
              Open on GitHub →
            </PrimerLink>
          )}
        </Box>
      </Box>

      {/* Linked issues summary */}
      {data && data.linked_issues.length > 0 && (
        <Box sx={{ flexShrink: 0, px: 3, py: 2, borderBottom: '1px solid', borderColor: 'var(--border-muted)' }}>
          <Text sx={{ display: 'block', fontSize: 0, color: 'var(--fg-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', mb: 1 }}>
            Linked issue{data.linked_issues.length === 1 ? '' : 's'}
          </Text>
          {data.linked_issues.map((i) => (
            <Box key={i.number} sx={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 0 }}>
              <IssueOpenedIcon size={11} />
              <Text sx={{ color: 'var(--fg-default)' }}>
                #{i.number} {i.title}
              </Text>
              <Text sx={{ color: 'var(--fg-muted)', ml: 'auto', fontSize: 0 }}>{i.state_reason ?? i.state}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Result body */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 3 }}>
        {validating && !data && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--fg-muted)' }}>
            <Spinner size="sm" tone="muted" />
            Reviewing this PR…
          </Box>
        )}
        {error && (
          <Box sx={{ p: 2, border: '1px solid', borderColor: 'var(--danger-emphasis)', borderRadius: 2, color: 'var(--danger-fg)', fontSize: 1 }}>
            {error}
          </Box>
        )}
        {ai?.error && (
          <Box sx={{ p: 2, border: '1px solid', borderColor: 'var(--danger-emphasis)', borderRadius: 2, color: 'var(--danger-fg)', fontSize: 1, mb: 3 }}>
            {ai.missing_key ? (
              <>
                Missing API key for {ai.missing_key}. Add it via the Settings page or the env var
                {ai.missing_key === 'anthropic' ? ' ANTHROPIC_API_KEY' : ' OPENAI_API_KEY'} and try again.
              </>
            ) : (
              ai.error
            )}
          </Box>
        )}
        {ai && !ai.error && (
          <>
            {vstyle && VerdictIcon && (
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                  px: 3,
                  py: 2,
                  borderRadius: 2,
                  bg: vstyle.bg,
                  color: vstyle.fg,
                  fontWeight: 700,
                  fontSize: 1,
                  mb: 3,
                }}
              >
                <VerdictIcon size={14} />
                {vstyle.label}
                {ai.cached && (
                  <Text sx={{ ml: 2, color: 'var(--fg-muted)', fontSize: 0, fontWeight: 400 }}>
                    cached · {new Date(ai.generated_at).toLocaleString()}
                  </Text>
                )}
              </Box>
            )}
            <Box sx={{ fontSize: 1 }}>{renderMarkdown(ai.markdown)}</Box>
            {(ai.tokens_in || ai.tokens_out) && (
              <Text sx={{ display: 'block', mt: 3, color: 'var(--fg-muted)', fontSize: 0 }}>
                {ai.tokens_in ?? 0} → {ai.tokens_out ?? 0} tokens · model {ai.model}
              </Text>
            )}
          </>
        )}
      </Box>
    </Box>
  );

  if (mode === 'side') {
    // The side container is rendered by RepoExplorer; we just supply content.
    return content;
  }

  // Modal mode — overlay backdrop + centered card.
  return (
    <Box
      onClick={onClose}
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        bg: 'rgba(1, 4, 9, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 3,
      }}
    >
      <Box
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        sx={{
          width: 'min(900px, 100%)',
          height: 'min(80vh, 800px)',
          bg: 'var(--bg-canvas)',
          border: '1px solid',
          borderColor: 'var(--border-default)',
          borderRadius: 3,
          boxShadow: 'var(--shadow-overlay)',
          overflow: 'hidden',
        }}
      >
        {content}
      </Box>
    </Box>
  );
}
