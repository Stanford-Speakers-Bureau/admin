const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export type CanceledTicketMode = "separate" | "as-noshow" | "exclude";

export type PurchaseRange = {
  rangeStart: number;
  rangeEnd: number;
};

type RatePoint = [number, number, number, number];

export type PurchaseTimingChartData = {
  intervalMs: number;
  intervalLabel: string;
  rangeStart: number;
  rangeEnd: number;
  mode: CanceledTicketMode;
  soldBars: [number, number][];
  rateLine: RatePoint[];
  canceledLine: RatePoint[] | null;
  noShowLine: RatePoint[] | null;
  missLine: RatePoint[] | null;
};

export function pickPurchaseInterval(spanMs: number): number {
  if (spanMs <= 3 * HOUR) return MIN;
  if (spanMs <= 12 * HOUR) return 5 * MIN;
  if (spanMs <= 3 * DAY) return 15 * MIN;
  if (spanMs <= 14 * DAY) return HOUR;
  return DAY;
}

export function purchaseIntervalLabel(ms: number): string {
  if (ms <= MIN) return "Minute";
  if (ms < HOUR) return `${ms / MIN} Min`;
  if (ms === HOUR) return "Hour";
  if (ms === DAY) return "Day";
  return `${ms / HOUR}h`;
}

function sortEpochs(epochs: number[]): number[] {
  return epochs.filter((epoch) => Number.isFinite(epoch)).sort((a, b) => a - b);
}

export function buildPurchaseRange(input: {
  ticketEpochs: number[];
  canceledPurchaseEpochs: number[];
  salesOpenMs: number | null;
}): PurchaseRange | null {
  const ticketEpochs = sortEpochs(input.ticketEpochs);
  const canceledPurchaseEpochs = sortEpochs(input.canceledPurchaseEpochs);

  if (ticketEpochs.length === 0) return null;
  // Canceled purchases can fall before the first / after the last live sale,
  // so fold them into the extent or their buckets would render off-axis.
  const firstCanceled = canceledPurchaseEpochs[0];
  const lastCanceled =
    canceledPurchaseEpochs[canceledPurchaseEpochs.length - 1];
  const firstPurchase = Math.min(
    ticketEpochs[0],
    firstCanceled ?? ticketEpochs[0],
  );
  const lastPurchase = Math.max(
    ticketEpochs[ticketEpochs.length - 1],
    lastCanceled ?? ticketEpochs[ticketEpochs.length - 1],
  );
  // Include sales-open in the extent so its marker and the default zoom anchor
  // are visible even if the first sale came later.
  const rangeStart = Math.min(
    firstPurchase,
    input.salesOpenMs ?? firstPurchase,
  );
  const rangeEnd = Math.max(lastPurchase, rangeStart + MIN);
  return { rangeStart, rangeEnd };
}

export function buildDefaultPurchaseZoomRange(input: {
  purchaseRange: PurchaseRange | null;
  salesOpenMs: number | null;
}): [number, number] | null {
  const { purchaseRange, salesOpenMs } = input;
  if (!purchaseRange) return null;
  // Default the visible window to begin at the ticketing date (sales open).
  const start =
    salesOpenMs != null
      ? Math.min(
          Math.max(salesOpenMs, purchaseRange.rangeStart),
          purchaseRange.rangeEnd,
        )
      : purchaseRange.rangeStart;
  return [start, purchaseRange.rangeEnd];
}

export function buildPurchaseTimingChartData(input: {
  purchaseRange: PurchaseRange | null;
  effectivePurchaseZoomRange: [number, number] | null;
  ticketEpochs: number[];
  scannedPurchaseEpochs: number[];
  canceledPurchaseEpochs: number[];
  canceledMode: CanceledTicketMode;
}): PurchaseTimingChartData | null {
  const { purchaseRange, effectivePurchaseZoomRange, canceledMode } = input;
  if (!purchaseRange) return null;
  const { rangeStart, rangeEnd } = purchaseRange;
  const visStart = effectivePurchaseZoomRange
    ? effectivePurchaseZoomRange[0]
    : rangeStart;
  const visEnd = effectivePurchaseZoomRange
    ? effectivePurchaseZoomRange[1]
    : rangeEnd;
  const visibleSpan = Math.max(visEnd - visStart, MIN);
  const intervalMs = pickPurchaseInterval(visibleSpan);
  // Bucket only a padded window around the visible range. This keeps the
  // interval fine (down to 1 min) when zoomed in without producing buckets
  // across an entire weeks-long sales window; the pad lets small pans stay
  // smooth before the next zoom event re-buckets.
  const winStart = Math.max(rangeStart, visStart - visibleSpan);
  const winEnd = Math.min(rangeEnd, visEnd + visibleSpan);
  const alignedStart = Math.floor(winStart / intervalMs) * intervalMs;

  const liveEpochs = sortEpochs(input.ticketEpochs);
  const scannedEpochs = sortEpochs(input.scannedPurchaseEpochs);
  // In "exclude" mode canceled tickets don't exist as far as the chart is
  // concerned, so drop them from the population entirely.
  const canceledEpochs =
    canceledMode === "exclude" ? [] : sortEpochs(input.canceledPurchaseEpochs);

  // Bars show how many tickets were *bought* in each bucket (marginal volume):
  // live-only in "exclude" mode, live + canceled otherwise. This is the only
  // per-bucket quantity — it gives the eye a sense of where the sales actually
  // happened behind the composition bands.
  const soldMap = new Map<number, number>();
  for (const e of liveEpochs) {
    const k = Math.floor(e / intervalMs) * intervalMs;
    soldMap.set(k, (soldMap.get(k) ?? 0) + 1);
  }
  for (const e of canceledEpochs) {
    const k = Math.floor(e / intervalMs) * intervalMs;
    soldMap.set(k, (soldMap.get(k) ?? 0) + 1);
  }

  const soldBars: [number, number][] = [];
  // Each line point is [ts, pct, count, denom] so the tooltip can show n/total.
  // The composition is CUMULATIVE: at each bucket it reflects every ticket
  // bought up to that point, not just the ones in that bucket. A per-bucket
  // rate is pure noise once buckets get small — a bucket holding one ticket is
  // always 0% or 100% — so the raw view zig-zags between the extremes and says
  // nothing. The running total is smooth, reads as a distribution, and its
  // right edge is the event's final show-up / no-show / cancel split. The left
  // edge answers the actual question: how launch-window buyers turned out.
  const rateLine: RatePoint[] = []; // show-up (bottom band)
  const noShowLine: RatePoint[] = []; // no-show band (separate + exclude)
  const canceledLine: RatePoint[] = []; // canceled band (separate)
  const missLine: RatePoint[] = []; // no-show + canceled (as-noshow)

  let liveSeen = 0;
  let scannedSeen = 0;
  let canceledSeen = 0;
  for (let b = alignedStart; b <= winEnd; b += intervalMs) {
    // Everything bought through the end of this bucket. Epochs are sorted, so a
    // single forward pointer per series keeps the whole loop O(n).
    const cutoff = b + intervalMs;
    while (liveSeen < liveEpochs.length && liveEpochs[liveSeen] < cutoff)
      liveSeen++;
    while (
      scannedSeen < scannedEpochs.length &&
      scannedEpochs[scannedSeen] < cutoff
    )
      scannedSeen++;
    while (
      canceledSeen < canceledEpochs.length &&
      canceledEpochs[canceledSeen] < cutoff
    )
      canceledSeen++;

    soldBars.push([b, soldMap.get(b) ?? 0]);

    // Denominator: live + canceled (canceledSeen is 0 in "exclude" mode).
    const denom = liveSeen + canceledSeen;
    if (denom === 0) continue;

    // Scanned tickets are always a subset of live ones, so no-show can't go
    // negative; the guard only matters for degenerate synthetic inputs.
    const noShow = Math.max(liveSeen - scannedSeen, 0);
    rateLine.push([b, (scannedSeen / denom) * 100, scannedSeen, denom]);
    if (canceledMode === "as-noshow") {
      const miss = noShow + canceledSeen;
      missLine.push([b, (miss / denom) * 100, miss, denom]);
    } else if (canceledMode === "separate") {
      noShowLine.push([b, (noShow / denom) * 100, noShow, denom]);
      canceledLine.push([b, (canceledSeen / denom) * 100, canceledSeen, denom]);
    } else {
      // exclude: denom is live-only, two bands (show-up + no-show).
      noShowLine.push([b, (noShow / denom) * 100, noShow, denom]);
    }
  }

  return {
    intervalMs,
    intervalLabel: purchaseIntervalLabel(intervalMs),
    rangeStart,
    rangeEnd,
    mode: canceledMode,
    soldBars,
    rateLine,
    canceledLine: canceledMode === "separate" ? canceledLine : null,
    noShowLine: canceledMode === "as-noshow" ? null : noShowLine,
    missLine: canceledMode === "as-noshow" ? missLine : null,
  };
}
