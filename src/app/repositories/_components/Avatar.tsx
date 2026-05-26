'use client';

import React from 'react';
import styles from '../page.module.css';

interface AvatarProps {
  fullName: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  pxSize?: number;
  className?: string;
}

const sizeClass: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: styles.avatarXs,
  sm: styles.avatarSm,
  md: styles.avatarMd,
  lg: styles.avatarLg,
  xl: styles.avatarXl,
};

const defaultPx: Record<NonNullable<AvatarProps['size']>, number> = {
  xs: 32,
  sm: 48,
  md: 64,
  lg: 96,
  xl: 128,
};

export default function Avatar({ fullName, size = 'md', pxSize, className }: AvatarProps) {
  const owner = fullName.split('/')[0] ?? fullName;
  const px = pxSize ?? defaultPx[size];
  const src = `https://github.com/${encodeURIComponent(owner)}.png?size=${px}`;
  const cls = [styles.avatar, sizeClass[size], className].filter(Boolean).join(' ');
  // Native <img> — next/image needs predeclared remote patterns and the rest
  // of the app (AppHeader, UserMenu, etc.) uses the same direct-fetch pattern.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={owner}
      className={cls}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}
