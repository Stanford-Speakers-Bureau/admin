"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import ReactECharts from "echarts-for-react";

// ── Types ────────────────────────────────────────────────────────────────

type Milestone = {
  percent: number;
  reached: boolean;
  ticketNumber: number;
  reachedAt: string | null;
};

type SalesResponse = {
  timestamps: string[];
  totalTickets: number;
  capacity: number;
  vipCount: number;
  standardCount: number;
  milestones: Milestone[];
};

type TicketSalesGraphProps = {
  eventId: string;
  capacity: number;
};

// ── Helpers ──────────────────────────────────────────────────────────────

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function pickInterval(spanMs: number): number {
  if (spanMs <= 3 * HOUR) return MIN;
  if (spanMs <= 12 * HOUR) return 5 * MIN;
  if (spanMs <= 3 * DAY) return 15 * MIN;
  if (spanMs <= 14 * DAY) return HOUR;
  return DAY;
}

function intervalLabel(ms: number): string {
  if (ms <= MIN) return "Minute";
  if (ms < HOUR) return `${ms / MIN} Min`;
  if (ms === HOUR) return "Hour";
  if (ms === DAY) return "Day";
  return `${ms / HOUR}h`;
}

/** Bucket pre-parsed epoch-ms timestamps into [ts, sold, cumulative] tuples */
function bucketEpochs(
  epochs: number[],
  intervalMs: number,
  rangeStart: number,
  rangeEnd: number,
): [number, number, number][] {
  const alignedStart = Math.floor(rangeStart / intervalMs) * intervalMs;
  const result: [number, number, number][] = [];
  let cumulative = 0;

  // Count tickets before visible range
  let idx = 0;
  while (idx < epochs.length && epochs[idx] < alignedStart) {
    cumulative++;
    idx++;
  }

  let bucketStart = alignedStart;
  while (bucketStart <= rangeEnd) {
    const bucketEnd = bucketStart + intervalMs;
    let count = 0;
    while (idx < epochs.length && epochs[idx] < bucketEnd) {
      count++;
      idx++;
    }
    cumulative += count;
    result.push([bucketStart, count, cumulative]);
    bucketStart = bucketEnd;
  }

  return result;
}

function formatFullDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function ProgressBar({
  value,
  max,
  color = "#10b981",
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full bg-zinc-800 rounded-full h-2.5 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────

export default function TicketSalesGraph({
  eventId,
  capacity,
}: TicketSalesGraphProps) {
  const [salesData, setSalesData] = useState<SalesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Visible time range (epoch ms); null = full range
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const chartRef = useRef<ReactECharts>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    async function fetchSalesData() {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch(`/api/events/${eventId}/sales`);
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to fetch sales data");
        }
        setSalesData(await response.json());
      } catch (err) {
        console.error("Error fetching sales data:", err);
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setIsLoading(false);
      }
    }
    if (eventId) fetchSalesData();
  }, [eventId]);

  // Pre-parse timestamps to epoch ms once
  const epochs = useMemo(() => {
    if (!salesData) return [];
    return salesData.timestamps.map((t) => new Date(t).getTime());
  }, [salesData]);

  const fullRange = useMemo<[number, number]>(() => {
    if (epochs.length === 0) return [Date.now(), Date.now()];
    return [epochs[0], Math.max(epochs[epochs.length - 1], epochs[0] + MIN)];
  }, [epochs]);

  const visibleRange = zoomRange ?? fullRange;
  const visibleSpan = visibleRange[1] - visibleRange[0];

  // Bucket the FULL range, but at a granularity driven by the VISIBLE span
  const { bucketedData, seriesLabel } = useMemo(() => {
    if (epochs.length === 0)
      return {
        bucketedData: [] as [number, number, number][],
        seriesLabel: "Minute",
      };
    const interval = pickInterval(Math.max(visibleSpan, MIN));
    return {
      bucketedData: bucketEpochs(
        epochs,
        interval,
        fullRange[0],
        fullRange[1],
      ),
      seriesLabel: intervalLabel(interval),
    };
  }, [epochs, fullRange, visibleSpan]);

  // Handle dataZoom events — debounced to avoid re-bucketing every frame
  const onDataZoom = useCallback(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const instance = chartRef.current?.getEchartsInstance();
      if (!instance) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const opt = instance.getOption() as any;
      const dz = opt.dataZoom?.[0];
      if (!dz) return;

      if (dz.startValue != null && dz.endValue != null) {
        setZoomRange([dz.startValue, dz.endValue]);
      } else if (dz.start != null && dz.end != null) {
        const span = fullRange[1] - fullRange[0];
        setZoomRange([
          fullRange[0] + (dz.start / 100) * span,
          fullRange[0] + (dz.end / 100) * span,
        ]);
      }
    }, 120);
  }, [fullRange]);

  const onEvents = useMemo(
    () => ({ datazoom: onDataZoom }),
    [onDataZoom],
  );

  // Build ECharts option
  const chartOption = useMemo(() => {
    if (bucketedData.length === 0) return {};

    const barData = bucketedData.map(([ts, sold]) => [ts, sold]);
    const lineData = bucketedData.map(([ts, , cum]) => [ts, cum]);

    const zoomProps = zoomRange
      ? { startValue: zoomRange[0], endValue: zoomRange[1] }
      : {};

    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: "#18181b",
        borderColor: "#3f3f46",
        borderWidth: 1,
        textStyle: { color: "#fafafa", fontSize: 12 },
        axisPointer: {
          type: "cross" as const,
          crossStyle: { color: "#71717a" },
        },
      },
      legend: {
        data: ["Cumulative", `Per ${seriesLabel}`],
        textStyle: { color: "#a1a1aa", fontSize: 12 },
        top: 0,
        left: "center",
        itemGap: 24,
        icon: "roundRect",
        itemWidth: 14,
        itemHeight: 8,
      },
      grid: {
        top: 40,
        right: 56,
        bottom: 80,
        left: 56,
        containLabel: false,
      },
      xAxis: {
        type: "time" as const,
        axisLabel: { color: "#71717a", fontSize: 10, hideOverlap: true },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: "value" as const,
          name: "Cumulative",
          nameTextStyle: {
            color: "#71717a",
            fontSize: 10,
            padding: [0, 0, 0, -24],
          },
          axisLabel: { color: "#71717a", fontSize: 10 },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: {
            lineStyle: { color: "#27272a", type: "dashed" as const },
          },
          minInterval: 1,
        },
        {
          type: "value" as const,
          name: `Per ${seriesLabel}`,
          nameTextStyle: {
            color: "#71717a",
            fontSize: 10,
            padding: [0, -24, 0, 0],
          },
          axisLabel: { color: "#71717a", fontSize: 10 },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          minInterval: 1,
        },
      ],
      dataZoom: [
        {
          type: "inside" as const,
          xAxisIndex: 0,
          filterMode: "none" as const,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          ...zoomProps,
        },
        {
          type: "slider" as const,
          xAxisIndex: 0,
          filterMode: "none" as const,
          height: 24,
          bottom: 8,
          borderColor: "#3f3f46",
          backgroundColor: "#18181b",
          fillerColor: "rgba(59,130,246,0.15)",
          handleStyle: { color: "#3b82f6", borderColor: "#3b82f6" },
          dataBackground: {
            lineStyle: { color: "#3f3f46" },
            areaStyle: { color: "#27272a" },
          },
          selectedDataBackground: {
            lineStyle: { color: "#3b82f6" },
            areaStyle: { color: "rgba(59,130,246,0.15)" },
          },
          textStyle: { color: "#71717a", fontSize: 10 },
          moveHandleStyle: { color: "#3f3f46" },
          ...zoomProps,
        },
      ],
      series: [
        {
          name: `Per ${seriesLabel}`,
          type: "bar" as const,
          yAxisIndex: 1,
          data: barData,
          itemStyle: {
            color: "rgba(16,185,129,0.5)",
            borderRadius: [2, 2, 0, 0],
          },
          emphasis: { itemStyle: { color: "#10b981" } },
          barMaxWidth: 28,
          large: true,
          z: 1,
        },
        {
          name: "Cumulative",
          type: "line" as const,
          yAxisIndex: 0,
          data: lineData,
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2, color: "#3b82f6" },
          areaStyle: {
            color: {
              type: "linear" as const,
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(59,130,246,0.25)" },
                { offset: 1, color: "rgba(59,130,246,0)" },
              ],
            },
          },
          z: 2,
        },
      ],
    };
  }, [bucketedData, seriesLabel, zoomRange]);

  // ── Loading / Error / Empty states ──

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-zinc-400">
          <div className="w-5 h-5 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
          <span className="text-sm">Loading sales data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <div className="text-center">
          <svg
            className="w-10 h-10 text-rose-400 mx-auto mb-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-rose-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!salesData || salesData.totalTickets === 0) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <div className="text-center">
          <svg
            className="w-10 h-10 text-zinc-600 mx-auto mb-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
          <p className="text-zinc-400 text-sm">No ticket sales yet</p>
        </div>
      </div>
    );
  }

  const { totalTickets, vipCount, standardCount, milestones } = salesData;
  const effectiveCapacity = capacity > 0 ? capacity : salesData.capacity;
  const fillRate = effectiveCapacity > 0 ? (totalTickets / effectiveCapacity) * 100 : 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 space-y-5 overflow-y-auto pr-1">
      {/* Fill Rate Banner */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-white">
            {totalTickets}{" "}
            <span className="text-zinc-400 font-normal text-sm">
              / {effectiveCapacity} tickets sold
            </span>
          </h3>
          <span
            className={`text-2xl font-bold ${
              fillRate >= 90
                ? "text-emerald-400"
                : fillRate >= 50
                  ? "text-blue-400"
                  : "text-amber-400"
            }`}
          >
            {fillRate.toFixed(1)}%
          </span>
        </div>
        <ProgressBar
          value={totalTickets}
          max={effectiveCapacity}
          color={
            fillRate >= 90
              ? "#10b981"
              : fillRate >= 50
                ? "#3b82f6"
                : "#f59e0b"
          }
        />
        <div className="flex justify-between mt-2">
          {milestones.map((m) => (
            <div key={m.percent} className="text-center">
              <div
                className={`text-xs font-medium ${
                  m.reached ? "text-emerald-400" : "text-zinc-600"
                }`}
              >
                {m.percent}%
              </div>
              {m.reached && m.reachedAt && (
                <div className="text-[10px] text-zinc-500">
                  {formatFullDateTime(m.reachedAt)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Ticket Type Breakdown */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="flex gap-4 items-center">
          <div className="flex-1 flex h-3 rounded-full overflow-hidden bg-zinc-800">
            {standardCount > 0 && (
              <div
                className="bg-blue-500 transition-all duration-500"
                style={{
                  width: `${(standardCount / totalTickets) * 100}%`,
                }}
              />
            )}
            {vipCount > 0 && (
              <div
                className="bg-violet-500 transition-all duration-500"
                style={{
                  width: `${(vipCount / totalTickets) * 100}%`,
                }}
              />
            )}
          </div>
          <div className="flex gap-4 text-xs flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span className="text-zinc-300">
                Standard{" "}
                <span className="text-zinc-500">({standardCount})</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
              <span className="text-zinc-300">
                VIP <span className="text-zinc-500">({vipCount})</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Sales Chart */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <p className="text-[10px] text-zinc-600 mb-1">
          Scroll to zoom &middot; Drag to pan &middot; Click legend to toggle
        </p>
        <ReactECharts
          ref={chartRef}
          option={chartOption}
          style={{ height: 400 }}
          opts={{ renderer: "canvas" }}
          onEvents={onEvents}
          notMerge
        />
      </div>
    </div>
  );
}
