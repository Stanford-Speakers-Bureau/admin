"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useEventContext } from "@/app/EventContext";
import ReactECharts from "echarts-for-react";

// ── Types ────────────────────────────────────────────────────────────────

type TypeBreakdown = { total: number; scanned: number; flakeRate: number };
type ScannerEntry = { name: string; email: string; count: number };

type SummaryResponse = {
  eventName: string | null;
  eventDate: string | null;
  capacity: number;
  reserved: number;
  doorsOpen: string | null;
  startTime: string | null;
  standbyEnabled: boolean;
  totalTickets: number;
  scannedCount: number;
  unscannedCount: number;
  flakeRate: number;
  byType: Record<"STANDARD" | "VIP" | "EXTERNAL" | "STANDBY", TypeBreakdown>;
  scanTimestamps: string[];
  ticketTimestamps: string[];
  waitlistCount: number;
  averageArrivalOffsetMs: number | null;
  peakInterval: { start: string; end: string; count: number } | null;
  scannerLeaderboard: ScannerEntry[];
  earlyBirdFlake: { earlyFlakeRate: number; lateFlakeRate: number; earlyTotal: number; lateTotal: number } | null;
  referralAttendance: { referralShowRate: number; organicShowRate: number; referralTotal: number; organicTotal: number } | null;
  arrivalDistribution: { buckets: { label: string; count: number }[]; total: number } | null;
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

function bucketEpochs(
  epochs: number[],
  intervalMs: number,
  rangeStart: number,
  rangeEnd: number,
): [number, number, number][] {
  const alignedStart = Math.floor(rangeStart / intervalMs) * intervalMs;
  const result: [number, number, number][] = [];
  let cumulative = 0;
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

function formatDuration(ms: number): string {
  const totalMins = Math.floor(ms / 60_000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function formatTimeRange(start: string, end: string): string {
  const fmt = (s: string) =>
    new Date(s).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

function ProgressBar({ value, max, color = "#10b981" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full bg-zinc-800 rounded-full h-2.5 overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

const TYPE_CONFIG = [
  { key: "STANDARD" as const, label: "Standard", color: "#3b82f6", bg: "bg-blue-500/10 border-blue-500/20", text: "text-blue-400" },
  { key: "VIP" as const, label: "VIP", color: "#8b5cf6", bg: "bg-violet-500/10 border-violet-500/20", text: "text-violet-400" },
  { key: "EXTERNAL" as const, label: "External", color: "#10b981", bg: "bg-emerald-500/10 border-emerald-500/20", text: "text-emerald-400" },
  { key: "STANDBY" as const, label: "Standby", color: "#f59e0b", bg: "bg-amber-500/10 border-amber-500/20", text: "text-amber-400" },
];

const ARRIVAL_COLORS = ["#8b5cf6", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#f43f5e"];

// ── Main Component ───────────────────────────────────────────────────────

function SummaryContent({ eventId }: { eventId: string }) {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const chartRef = useRef<ReactECharts>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    async function fetchData() {
      try {
        setIsLoading(true);
        setError(null);
        const res = await fetch(`/api/events/${eventId}/summary`);
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Failed to fetch summary data");
        }
        setData(await res.json());
      } catch (err) {
        console.error("Error fetching summary:", err);
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setIsLoading(false);
      }
    }
    if (eventId) fetchData();
  }, [eventId]);

  // ── Chart: Sales vs Check-ins overlay ──

  const scanEpochs = useMemo(() => {
    if (!data) return [];
    return data.scanTimestamps.map((t) => new Date(t).getTime());
  }, [data]);

  const ticketEpochs = useMemo(() => {
    if (!data) return [];
    return data.ticketTimestamps.map((t) => new Date(t).getTime());
  }, [data]);

  const allEpochs = useMemo(() => {
    return [...ticketEpochs, ...scanEpochs].sort((a, b) => a - b);
  }, [ticketEpochs, scanEpochs]);

  const fullRange = useMemo<[number, number]>(() => {
    if (allEpochs.length === 0) return [Date.now(), Date.now()];
    return [allEpochs[0], Math.max(allEpochs[allEpochs.length - 1], allEpochs[0] + MIN)];
  }, [allEpochs]);

  const visibleRange = zoomRange ?? fullRange;
  const visibleSpan = visibleRange[1] - visibleRange[0];

  const { salesBucketed, checkinBucketed, seriesLabel } = useMemo(() => {
    if (allEpochs.length === 0)
      return {
        salesBucketed: [] as [number, number, number][],
        checkinBucketed: [] as [number, number, number][],
        seriesLabel: "Minute",
      };
    const interval = pickInterval(Math.max(visibleSpan, MIN));
    return {
      salesBucketed: ticketEpochs.length > 0 ? bucketEpochs(ticketEpochs, interval, fullRange[0], fullRange[1]) : [],
      checkinBucketed: scanEpochs.length > 0 ? bucketEpochs(scanEpochs, interval, fullRange[0], fullRange[1]) : [],
      seriesLabel: intervalLabel(interval),
    };
  }, [allEpochs, ticketEpochs, scanEpochs, fullRange, visibleSpan]);

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
        setZoomRange([fullRange[0] + (dz.start / 100) * span, fullRange[0] + (dz.end / 100) * span]);
      }
    }, 120);
  }, [fullRange]);

  const onEvents = useMemo(() => ({ datazoom: onDataZoom }), [onDataZoom]);

  const chartOption = useMemo(() => {
    if (salesBucketed.length === 0 && checkinBucketed.length === 0) return {};
    const salesLine = salesBucketed.map(([ts, , cum]) => [ts, cum]);
    const checkinLine = checkinBucketed.map(([ts, , cum]) => [ts, cum]);
    const checkinBar = checkinBucketed.map(([ts, count]) => [ts, count]);
    const zoomProps = zoomRange ? { startValue: zoomRange[0], endValue: zoomRange[1] } : {};

    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: "#18181b",
        borderColor: "#3f3f46",
        borderWidth: 1,
        textStyle: { color: "#fafafa", fontSize: 12 },
        axisPointer: { type: "cross" as const, crossStyle: { color: "#71717a" } },
      },
      legend: {
        data: ["Tickets Sold", "Check-ins", `Per ${seriesLabel}`],
        textStyle: { color: "#a1a1aa", fontSize: 12 },
        top: 0,
        left: "center",
        itemGap: 20,
        icon: "roundRect",
        itemWidth: 14,
        itemHeight: 8,
      },
      grid: { top: 40, right: 56, bottom: 80, left: 56, containLabel: false },
      xAxis: {
        type: "time" as const,
        axisLabel: { color: "#71717a", fontSize: 10, hideOverlap: true },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: "value" as const, name: "Cumulative",
          nameTextStyle: { color: "#71717a", fontSize: 10, padding: [0, 0, 0, -24] },
          axisLabel: { color: "#71717a", fontSize: 10 },
          axisLine: { show: false }, axisTick: { show: false },
          splitLine: { lineStyle: { color: "#27272a", type: "dashed" as const } },
          minInterval: 1,
        },
        {
          type: "value" as const, name: `Per ${seriesLabel}`,
          nameTextStyle: { color: "#71717a", fontSize: 10, padding: [0, -24, 0, 0] },
          axisLabel: { color: "#71717a", fontSize: 10 },
          axisLine: { show: false }, axisTick: { show: false },
          splitLine: { show: false },
          minInterval: 1,
        },
      ],
      dataZoom: [
        { type: "inside" as const, xAxisIndex: 0, filterMode: "none" as const, zoomOnMouseWheel: true, moveOnMouseMove: true, ...zoomProps },
        {
          type: "slider" as const, xAxisIndex: 0, filterMode: "none" as const, height: 24, bottom: 8,
          borderColor: "#3f3f46", backgroundColor: "#18181b", fillerColor: "rgba(59,130,246,0.15)",
          handleStyle: { color: "#3b82f6", borderColor: "#3b82f6" },
          dataBackground: { lineStyle: { color: "#3f3f46" }, areaStyle: { color: "#27272a" } },
          selectedDataBackground: { lineStyle: { color: "#3b82f6" }, areaStyle: { color: "rgba(59,130,246,0.15)" } },
          textStyle: { color: "#71717a", fontSize: 10 }, moveHandleStyle: { color: "#3f3f46" }, ...zoomProps,
        },
      ],
      series: [
        {
          name: `Per ${seriesLabel}`, type: "bar" as const, yAxisIndex: 1, data: checkinBar,
          itemStyle: { color: "rgba(16,185,129,0.4)", borderRadius: [2, 2, 0, 0] },
          emphasis: { itemStyle: { color: "#10b981" } }, barMaxWidth: 28, large: true, z: 1,
        },
        {
          name: "Tickets Sold", type: "line" as const, yAxisIndex: 0, data: salesLine,
          smooth: true, symbol: "none", lineStyle: { width: 2, color: "#3b82f6" },
          areaStyle: {
            color: {
              type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: "rgba(59,130,246,0.15)" }, { offset: 1, color: "rgba(59,130,246,0)" }],
            },
          },
          z: 2,
        },
        {
          name: "Check-ins", type: "line" as const, yAxisIndex: 0, data: checkinLine,
          smooth: true, symbol: "none", lineStyle: { width: 2, color: "#10b981" },
          areaStyle: {
            color: {
              type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: "rgba(16,185,129,0.15)" }, { offset: 1, color: "rgba(16,185,129,0)" }],
            },
          },
          z: 3,
        },
      ],
    };
  }, [salesBucketed, checkinBucketed, seriesLabel, zoomRange]);

  // ── Loading / Error states ──

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-zinc-400">
          <div className="w-5 h-5 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
          <span className="text-sm">Loading summary...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <div className="text-center">
          <svg className="w-10 h-10 text-rose-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-rose-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!data || data.totalTickets === 0) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <div className="text-center">
          <svg className="w-10 h-10 text-zinc-600 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-zinc-400 text-sm">No ticket data for this event</p>
        </div>
      </div>
    );
  }

  const {
    totalTickets, scannedCount, unscannedCount, flakeRate, byType,
    waitlistCount, averageArrivalOffsetMs, peakInterval, capacity, standbyEnabled,
    scannerLeaderboard, earlyBirdFlake, referralAttendance, arrivalDistribution,
  } = data;

  const attendanceRate = totalTickets > 0 ? (scannedCount / totalTickets) * 100 : 0;
  const capacityFill = capacity > 0 ? (scannedCount / capacity) * 100 : 0;

  // VIP vs Standard show-up comparison
  const vipShowUp = byType.VIP.total > 0 ? (byType.VIP.scanned / byType.VIP.total) * 100 : null;
  const stdShowUp = byType.STANDARD.total > 0 ? (byType.STANDARD.scanned / byType.STANDARD.total) * 100 : null;
  const standbyConversion = byType.STANDBY.total > 0 ? (byType.STANDBY.scanned / byType.STANDBY.total) * 100 : null;

  return (
    <div className="space-y-5">
      {/* ── Big numbers row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Attendance */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Attendance</p>
          <p className={`text-3xl font-bold ${attendanceRate >= 75 ? "text-emerald-400" : attendanceRate >= 50 ? "text-blue-400" : "text-amber-400"}`}>
            {attendanceRate.toFixed(1)}%
          </p>
          <p className="text-sm text-zinc-400 mt-1">{scannedCount} / {totalTickets} showed up</p>
          {capacity > 0 && (
            <p className="text-xs text-zinc-500 mt-0.5">{capacityFill.toFixed(1)}% of {capacity} capacity</p>
          )}
          <div className="mt-3">
            <ProgressBar value={scannedCount} max={totalTickets} color={attendanceRate >= 75 ? "#10b981" : attendanceRate >= 50 ? "#3b82f6" : "#f59e0b"} />
          </div>
        </div>

        {/* Flake rate */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Flake Rate</p>
          <p className={`text-3xl font-bold ${flakeRate <= 15 ? "text-emerald-400" : flakeRate <= 30 ? "text-amber-400" : "text-rose-400"}`}>
            {flakeRate.toFixed(1)}%
          </p>
          <p className="text-sm text-zinc-400 mt-1">{unscannedCount} no-shows</p>
          <div className="mt-3">
            <ProgressBar value={unscannedCount} max={totalTickets} color={flakeRate <= 15 ? "#10b981" : flakeRate <= 30 ? "#f59e0b" : "#f43f5e"} />
          </div>
        </div>

        {/* Avg arrival */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Avg Arrival</p>
          {averageArrivalOffsetMs != null ? (
            <>
              <p className="text-3xl font-bold text-blue-400">{formatDuration(averageArrivalOffsetMs)}</p>
              <p className="text-sm text-zinc-400 mt-1">after doors open</p>
            </>
          ) : (
            <p className="text-xl text-zinc-600">N/A</p>
          )}
        </div>

        {/* Peak check-in */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Peak Window</p>
          {peakInterval ? (
            <>
              <p className="text-3xl font-bold text-violet-400">{peakInterval.count}</p>
              <p className="text-sm text-zinc-400 mt-1">check-ins in 15 min</p>
              <p className="text-xs text-zinc-500 mt-0.5">{formatTimeRange(peakInterval.start, peakInterval.end)}</p>
            </>
          ) : (
            <p className="text-xl text-zinc-600">N/A</p>
          )}
        </div>

      </div>

      {/* ── Per-type flake breakdown ── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h3 className="text-sm font-semibold text-zinc-300 mb-4">Attendance by Ticket Type</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {TYPE_CONFIG.map(({ key, label, color, bg, text }) => {
            const t = byType[key];
            if (t.total === 0) return null;
            const showRate = t.total > 0 ? (t.scanned / t.total) * 100 : 0;
            const flaked = t.total - t.scanned;
            return (
              <div key={key} className={`rounded-xl border p-4 ${bg}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-semibold uppercase tracking-wider ${text}`}>{label}</span>
                  <span className={`text-lg font-bold ${text}`}>{showRate.toFixed(0)}%</span>
                </div>
                <p className="text-sm text-zinc-300 mb-1">{t.scanned} / {t.total} attended</p>
                <p className="text-xs text-zinc-500 mb-2">{flaked} flaked ({t.flakeRate.toFixed(0)}%)</p>
                <ProgressBar value={t.scanned} max={t.total} color={color} />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Arrival Distribution ── */}
      {arrivalDistribution && arrivalDistribution.total > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h3 className="text-sm font-semibold text-zinc-300 mb-4">Arrival Distribution</h3>
          <ReactECharts
            option={{
              backgroundColor: "transparent",
              animation: true,
              animationDuration: 600,
              animationEasing: "cubicOut",
              grid: { top: 16, right: 16, bottom: 24, left: 16, containLabel: true },
              xAxis: {
                type: "category",
                data: arrivalDistribution.buckets.map((b) => b.label),
                axisLabel: { color: "#a1a1aa", fontSize: 11 },
                axisLine: { show: false },
                axisTick: { show: false },
              },
              yAxis: {
                type: "value",
                axisLabel: { color: "#71717a", fontSize: 10 },
                axisLine: { show: false },
                axisTick: { show: false },
                splitLine: { lineStyle: { color: "#27272a", type: "dashed" } },
                minInterval: 1,
              },
              tooltip: {
                trigger: "axis",
                backgroundColor: "#18181b",
                borderColor: "#3f3f46",
                borderWidth: 1,
                textStyle: { color: "#fafafa", fontSize: 12 },
                formatter: (params: { name: string; value: number }[]) => {
                  const p = params[0];
                  const pct = arrivalDistribution.total > 0
                    ? ((p.value / arrivalDistribution.total) * 100).toFixed(0)
                    : "0";
                  return `<b>${p.name}</b><br/>${p.value} (${pct}%)`;
                },
              },
              series: [
                {
                  type: "bar",
                  barWidth: "60%",
                  data: arrivalDistribution.buckets.map(({ count }, i) => ({
                    value: count,
                    itemStyle: {
                      color: {
                        type: "linear",
                        x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [
                          { offset: 0, color: ARRIVAL_COLORS[i % ARRIVAL_COLORS.length] },
                          { offset: 1, color: ARRIVAL_COLORS[i % ARRIVAL_COLORS.length] + "33" },
                        ],
                      },
                      borderRadius: [8, 8, 0, 0],
                    },
                  })),
                  label: {
                    show: true,
                    position: "top",
                    color: "#a1a1aa",
                    fontSize: 11,
                    fontWeight: "bold",
                    formatter: (p: { value: number }) => String(p.value),
                  },
                },
              ],
            }}
            style={{ height: 200 }}
            opts={{ renderer: "canvas" }}
          />
        </div>
      )}

      {/* ── Insights row ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {vipShowUp != null && stdShowUp != null && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">VIP vs Standard</p>
            <div className="flex items-end gap-3">
              <div>
                <p className="text-xs text-violet-400 mb-0.5">VIP</p>
                <p className="text-xl font-bold text-violet-400">{vipShowUp.toFixed(0)}%</p>
              </div>
              <div className="text-zinc-600 text-sm pb-0.5">vs</div>
              <div>
                <p className="text-xs text-blue-400 mb-0.5">Standard</p>
                <p className="text-xl font-bold text-blue-400">{stdShowUp.toFixed(0)}%</p>
              </div>
            </div>
          </div>
        )}

        {standbyEnabled && standbyConversion != null && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Standby Conversion</p>
            <p className="text-xl font-bold text-amber-400">{standbyConversion.toFixed(0)}%</p>
            <p className="text-xs text-zinc-500 mt-1">{byType.STANDBY.scanned} / {byType.STANDBY.total} admitted</p>
          </div>
        )}

        {/* Early-bird flake */}
        {earlyBirdFlake && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Early vs Late Buyers</p>
            <div className="flex items-end gap-3">
              <div>
                <p className="text-xs text-emerald-400 mb-0.5">First 24h ({earlyBirdFlake.earlyTotal})</p>
                <p className="text-xl font-bold text-emerald-400">{earlyBirdFlake.earlyFlakeRate.toFixed(0)}%</p>
              </div>
              <div className="text-zinc-600 text-sm pb-0.5">vs</div>
              <div>
                <p className="text-xs text-rose-400 mb-0.5">Last 24h ({earlyBirdFlake.lateTotal})</p>
                <p className="text-xl font-bold text-rose-400">{earlyBirdFlake.lateFlakeRate.toFixed(0)}%</p>
              </div>
            </div>
            <p className="text-[10px] text-zinc-600 mt-1">flake rate: early buyers vs last-minute</p>
          </div>
        )}

        {/* Referral attendance */}
        {referralAttendance && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Referral Attendance</p>
            <div className="flex items-end gap-3">
              <div>
                <p className="text-xs text-cyan-400 mb-0.5">Referral ({referralAttendance.referralTotal})</p>
                <p className="text-xl font-bold text-cyan-400">{referralAttendance.referralShowRate.toFixed(0)}%</p>
              </div>
              <div className="text-zinc-600 text-sm pb-0.5">vs</div>
              <div>
                <p className="text-xs text-zinc-400 mb-0.5">Organic ({referralAttendance.organicTotal})</p>
                <p className="text-xl font-bold text-zinc-300">{referralAttendance.organicShowRate.toFixed(0)}%</p>
              </div>
            </div>
            <p className="text-[10px] text-zinc-600 mt-1">show-up rate comparison</p>
          </div>
        )}

        {waitlistCount > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Waitlist Size</p>
            <p className="text-xl font-bold text-rose-400">{waitlistCount}</p>
            <p className="text-xs text-zinc-500 mt-1">people who missed out</p>
          </div>
        )}

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">Tickets Sold</p>
          <p className="text-xl font-bold text-blue-400">{totalTickets}</p>
          {capacity > 0 && (
            <p className="text-xs text-zinc-500 mt-1">{((totalTickets / capacity) * 100).toFixed(0)}% of capacity</p>
          )}
        </div>
      </div>

      {/* ── Scanner Performance ── */}
      {scannerLeaderboard.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-zinc-300">Scanner Performance</h3>
            <div className="flex items-center gap-4 text-xs text-zinc-500">
              <span>{scannerLeaderboard.length} scanner{scannerLeaderboard.length !== 1 ? "s" : ""}</span>
              <span>{scannedCount > 0 ? Math.round(scannedCount / scannerLeaderboard.length) : 0} avg scans</span>
            </div>
          </div>
          <div className="space-y-3">
            {scannerLeaderboard.map((scanner, i) => {
              const pct = scannedCount > 0 ? (scanner.count / scannedCount) * 100 : 0;
              return (
                <div key={scanner.email || scanner.name} className="flex items-center gap-3">
                  <span className={`text-sm font-bold w-6 text-right ${i < 3 ? ["text-amber-400", "text-zinc-300", "text-amber-600"][i] : "text-zinc-500"}`}>
                    #{i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-white truncate">{scanner.name}</span>
                      <span className="text-xs text-zinc-400 shrink-0 ml-2">
                        {scanner.count} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${(scanner.count / scannerLeaderboard[0].count) * 100}%`,
                          backgroundColor: i === 0 ? "#f59e0b" : i === 1 ? "#a1a1aa" : i === 2 ? "#b45309" : "#3b82f6",
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Sales vs Check-ins chart ── */}
      {(salesBucketed.length > 0 || checkinBucketed.length > 0) && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h3 className="text-sm font-semibold text-zinc-300 mb-1">Sales vs Check-ins</h3>
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
      )}
    </div>
  );
}

// ── Wrapper ──────────────────────────────────────────────────────────────

export default function SummaryClient() {
  const { events, selectedEventId } = useEventContext();
  const currentEvent = events.find((e) => e.id === selectedEventId);

  return (
    <div className="px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
          Summary
        </h1>
        {currentEvent && (
          <p className="text-zinc-400">{currentEvent.name || "Unnamed Event"}</p>
        )}
      </div>

      {!selectedEventId ? (
        <div className="text-center py-16 bg-zinc-900/50 rounded-2xl border border-zinc-800">
          <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <p className="text-zinc-400 text-lg mb-2">No event selected</p>
          <p className="text-zinc-600 text-sm">Select an event from the sidebar to view summary data</p>
        </div>
      ) : (
        <SummaryContent eventId={selectedEventId} />
      )}
    </div>
  );
}
