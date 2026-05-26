'use client';

import React, { useState } from 'react';
import styles from '../page.module.css';

interface LangIconProps {
  /** Devicon icon spec [name, variant], or null/undefined to skip the
   *  SVG and render the colored-letter fallback directly. */
  spec?: [string, string] | null;
  /** Tint for both the fallback square and the surrounding pill border. */
  color: string;
  /** First 1–2 letters shown when the icon is missing or fails to load. */
  fallbackLetter: string;
  /** Pixel size — defaults to 14 (compact repo-card/list-row pills). The
   *  language-weights table uses 18. */
  size?: number;
  title?: string;
}

export default function LangIcon({ spec, color, fallbackLetter, size = 14, title }: LangIconProps) {
  // Devicon ships icons for most popular languages but not all. We try
  // the SVG first; if it 404s at runtime, swap to the colored-letter
  // square. Single piece of React state per icon since errors are rare.
  const [errored, setErrored] = useState(false);
  const showFallback = !spec || errored;

  if (showFallback) {
    return (
      <span
        className={styles.langIconFallback}
        style={{ background: color, width: size, height: size, fontSize: Math.max(7, size * 0.55) }}
        title={title}
      >
        {fallbackLetter}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/${spec[0]}/${spec[0]}-${spec[1]}.svg`}
      alt=""
      className={styles.langIcon}
      style={{ width: size, height: size }}
      loading="lazy"
      title={title}
      onError={() => setErrored(true)}
    />
  );
}
