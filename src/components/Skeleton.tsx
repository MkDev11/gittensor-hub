'use client';

import React from 'react';

/* Shared skeleton primitives. All ride on `.gt-skeleton` (defined in
 * globals.css) for the shimmer animation; the components here just stamp
 * out the right shapes for the surface they precede. The down-the-list
 * opacity fade signals "more content is on its way" without claiming a
 * specific row count up front.
 *
 * IMPLEMENTATION NOTE: dynamic values (per-row opacity) go in `style`
 * rather than Primer's `sx` prop — styled-components creates a fresh
 * class for every unique sx value, and these skeletons are stamped out
 * in loops, so using sx for opacity would explode the class count and
 * trigger styled-components' "Over 200 classes" warning. */

export function SkeletonBar({
  width,
  height = 12,
  flex,
  rounded = 6,
}: {
  width?: number | string;
  height?: number;
  flex?: number;
  rounded?: number;
}) {
  return (
    <span
      className="gt-skeleton"
      style={{
        display: 'block',
        width,
        flex,
        height,
        borderRadius: rounded,
      }}
    />
  );
}

interface Col {
  width?: number | string;
  flex?: number;
}

function rowOpacity(i: number, step = 0.07, floor = 0.2): number {
  return Math.max(floor, 1 - i * step);
}

/** Rows for tabular surfaces — issues, pulls, repositories, miners. */
export function TableRowsSkeleton({
  rows = 10,
  cols,
  rowHeight = 36,
  px = 24,
}: {
  rows?: number;
  cols: Col[];
  rowHeight?: number;
  px?: number;
}) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            height: rowHeight,
            paddingLeft: px,
            paddingRight: px,
            borderBottom: '1px solid var(--border-muted)',
            opacity: rowOpacity(i),
          }}
        >
          {cols.map((c, j) => (
            <SkeletonBar key={j} width={c.width} flex={c.flex} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Compact row list — RepoExplorer's left rail and similar slim lists. */
export function RepoListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div style={{ padding: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            paddingLeft: 8,
            paddingRight: 8,
            paddingTop: 10,
            paddingBottom: 10,
            opacity: rowOpacity(i, 0.09, 0.25),
          }}
        >
          <SkeletonBar width={14} height={14} rounded={999} />
          <SkeletonBar flex={1} />
          <SkeletonBar width={36} />
        </div>
      ))}
    </div>
  );
}

/** Card grid — for dashboards / stat panels. */
export function CardGridSkeleton({
  count = 6,
  columns = 3,
  cardHeight = 120,
}: {
  count?: number;
  columns?: number;
  cardHeight?: number;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 16,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            height: cardHeight,
            border: '1px solid var(--border-default)',
            borderRadius: 6,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            opacity: rowOpacity(i, 0.08, 0.3),
          }}
        >
          <SkeletonBar width={80} height={10} />
          <SkeletonBar width={120} height={20} />
          <div style={{ flex: 1 }} />
          <SkeletonBar flex={1} height={8} />
        </div>
      ))}
    </div>
  );
}

/** Sidebar / sticky-rail card list. */
export function SidebarCardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
      <SkeletonBar width={100} height={10} />
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: rowOpacity(i, 0.1, 0.3) }}
        >
          <SkeletonBar width={20} height={20} rounded={999} />
          <SkeletonBar flex={1} />
          <SkeletonBar width={32} />
        </div>
      ))}
    </div>
  );
}
