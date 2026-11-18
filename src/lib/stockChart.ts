// Geometry for the inventory stock history chart (display only).

export interface StockHistoryDay {
  date: string;
  on_hand: string;
  used: string;
  wasted: string;
  received: string;
}

// Layout of the SVG (viewBox units; the SVG scales to the container width).
export const W = 720;
export const LEFT = 56;
export const RIGHT = 16;
export const LINE_TOP = 12;
export const LINE_H = 150;
export const BAR_TOP = LINE_TOP + LINE_H + 28;
export const BAR_H = 64;
export const H = BAR_TOP + BAR_H + 28;
const PLOT_W = W - LEFT - RIGHT;

/**
 * Pure drawing helper, exported for unit tests. Numbers are parsed only to
 * place marks on screen; every value shown as text is the server's own string.
 */
export function chartGeometry(series: StockHistoryDay[], reorderPoint: string | null) {
  const n = series.length;
  const onHand = series.map((d) => Number(d.on_hand));
  const used = series.map((d) => Number(d.used));
  const wasted = series.map((d) => Number(d.wasted));
  const received = series.map((d) => Number(d.received));
  const rop = reorderPoint == null ? null : Number(reorderPoint);
  const lineMax = Math.max(1, ...onHand, rop ?? 0) * 1.1;
  const barMax = Math.max(1, ...used.map((u, i) => u + wasted[i]!), ...received);
  const band = PLOT_W / Math.max(n, 1);
  const x = (i: number) => LEFT + band * i + band / 2;
  const yLine = (v: number) => LINE_TOP + LINE_H - (Math.max(v, 0) / lineMax) * LINE_H;
  const barHeight = (v: number) => (Math.max(v, 0) / barMax) * BAR_H;
  const path = onHand.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yLine(v).toFixed(1)}`).join(' ');
  return { n, band, x, yLine, barHeight, path, lineMax, barMax, rop, used, wasted, received, onHand };
}
