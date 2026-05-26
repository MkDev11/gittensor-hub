/* Squarified treemap layout (Bruls/Huijbregts/van Wijk, 2000).
 *
 * Packs weighted segments into a containing rectangle with low aspect-ratio
 * variance — cleaner than slice-and-dice when the input distribution is
 * uneven (which the SN74 emission shares almost always are). */

export interface SquarifyInput<T> {
  w: number;
  data: T;
}

export interface SquarifyRect<T> {
  x: number;
  y: number;
  w: number;
  h: number;
  data: T;
}

export interface SquarifyOptions {
  sort?: boolean;
}

export function squarify<T>(
  segs: Array<SquarifyInput<T>>,
  x: number,
  y: number,
  w: number,
  h: number,
  options: SquarifyOptions = {},
): Array<SquarifyRect<T>> {
  if (segs.length === 0 || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return [];
  }

  const totalArea = w * h;
  const weighted = segs.map((seg) => ({
    data: seg.data,
    w: Number.isFinite(seg.w) && seg.w > 0 ? seg.w : 0,
  }));
  const totalWeight = weighted.reduce((a, b) => a + b.w, 0);
  const items = (totalWeight > 0
    ? weighted.map((seg) => ({ data: seg.data, area: (seg.w / totalWeight) * totalArea }))
    : weighted.map((seg) => ({ data: seg.data, area: totalArea / weighted.length }))
  )
    .filter((seg) => seg.area > 0);

  if (options.sort !== false) {
    items.sort((a, b) => b.area - a.area);
  }

  if (items.length === 0) return [];

  const result: Array<SquarifyRect<T>> = [];

  function layoutRow(
    row: Array<{ data: T; area: number }>,
    rx: number,
    ry: number,
    rw: number,
    rh: number,
    side: 'h' | 'v',
  ): { x: number; y: number; w: number; h: number } {
    const rowArea = row.reduce((a, b) => a + b.area, 0);
    if (side === 'h') {
      const rowH = rowArea / rw;
      let cx = rx;
      for (const it of row) {
        const cw = it.area / rowH;
        result.push({ x: cx, y: ry, w: cw, h: rowH, data: it.data });
        cx += cw;
      }
      return { x: rx, y: ry + rowH, w: rw, h: rh - rowH };
    } else {
      const rowW = rowArea / rh;
      let cy = ry;
      for (const it of row) {
        const ch = it.area / rowW;
        result.push({ x: rx, y: cy, w: rowW, h: ch, data: it.data });
        cy += ch;
      }
      return { x: rx + rowW, y: ry, w: rw - rowW, h: rh };
    }
  }

  function worstRatio(row: Array<{ data: T; area: number }>, side: 'h' | 'v', rw: number, rh: number): number {
    if (row.length === 0) return Infinity;
    const sum = row.reduce((a, b) => a + b.area, 0);
    const length = side === 'h' ? rw : rh;
    const stripThickness = sum / length;
    let worst = 0;
    for (const it of row) {
      const otherDim = it.area / stripThickness;
      const ratio = Math.max(stripThickness / otherDim, otherDim / stripThickness);
      if (ratio > worst) worst = ratio;
    }
    return worst;
  }

  function pack(): void {
    let cur = items;
    let rx = x;
    let ry = y;
    let rw = w;
    let rh = h;
    while (cur.length > 0) {
      const side: 'h' | 'v' = rw < rh ? 'h' : 'v';
      const row: Array<{ data: T; area: number }> = [];
      let i = 0;
      while (i < cur.length) {
        const trial = row.concat([cur[i]]);
        if (row.length === 0 || worstRatio(trial, side, rw, rh) <= worstRatio(row, side, rw, rh)) {
          row.push(cur[i]);
          i++;
        } else {
          break;
        }
      }
      const remaining = layoutRow(row, rx, ry, rw, rh, side);
      rx = remaining.x;
      ry = remaining.y;
      rw = remaining.w;
      rh = remaining.h;
      cur = cur.slice(i);
    }
  }

  pack();
  return result;
}
