
export interface SparklinePoint {
  x: number;
  y: number;
}

export interface SparklineLayout {
  width: number;
  height: number;
  padV?: number;
}

export interface SparklinePath {
  points: readonly SparklinePoint[];
  linePoints: string;
  areaD: string;
}

export interface TrendSummary {
  last7: number;
  prior7: number | null;
  trendText: string;
}

export function computeSparklinePath(
  values: readonly number[],
  layout: SparklineLayout,
): SparklinePath {
  const { width, height, padV = 2 } = layout;
  const cols = values.length;
  let max = 0;
  if (cols > 0) {
    max = Math.max(...values);
  }

  const points: SparklinePoint[] = values.map((v, i) => ({
    x: cols > 1 ? (i / (cols - 1)) * (width - 1) : (width - 1) / 2,
    y: padV + (max > 0 ? 1 - v / max : 1) * (height - padV * 2),
  }));

  const linePoints = points
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');

  const areaD = points.length === 0
    ? ''
    : [
        `M${points[0].x.toFixed(1)},${height}`,
        ...points.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`),
        `L${points[points.length - 1].x.toFixed(1)},${height}`,
        'Z',
      ].join(' ');

  return { points, linePoints, areaD };
}

export function summarizeTrend(values: readonly number[]): TrendSummary {
  const cols = values.length;
  const last7 = values.slice(-7).reduce((a, b) => a + b, 0);
  const prior7 = cols >= 14
    ? values.slice(-14, -7).reduce((a, b) => a + b, 0)
    : null;

  let trendText = '';
  if (prior7 != null) {
    if (prior7 === 0 && last7 > 0) {
      trendText = ' · new activity this week';
    } else if (prior7 > 0) {
      const arrow = last7 > prior7 ? '↑' : last7 < prior7 ? '↓' : '·';
      const pct = Math.round((Math.abs(last7 - prior7) / prior7) * 100);
      trendText = ` · ${arrow}${pct}% vs prior 7d`;
    }
  }

  return { last7, prior7, trendText };
}
