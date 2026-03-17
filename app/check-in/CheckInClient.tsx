"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useEventContext } from "@/app/EventContext";
import ReactECharts from "echarts-for-react";

// ── Types ────────────────────────────────────────────────────────────────

type TypeBreakdown = { total: number; scanned: number };

type RecentScan = {
  name: string | null;
  type: string | null;
  scanTime: string;
  scannedBy: string | null;
};

type ScannerEntry = { name: string; email: string; count: number };

type CheckInResponse = {
  scanTimestamps: string[];
  totalTickets: number;
  scannedCount: number;
  isLive: boolean;
  capacity: number;
  doorsOpen: string | null;
  startTime: string | null;
  standbyEnabled: boolean;
  waitlistCount: number;
  byType: Record<"STANDARD" | "VIP" | "EXTERNAL" | "STANDBY", TypeBreakdown>;
  recentScans: RecentScan[];
  standbyTimestamps: string[];
  scannerLeaderboard: ScannerEntry[];
  peakScansPerMin: number;
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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hrs > 0) return `${hrs}h ${remainMins}m`;
  return `${mins}m`;
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
    <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

const TYPE_CONFIG = [
  { key: "STANDARD" as const, label: "Standard", color: "#3b82f6", ring: "ring-blue-500/30", bg: "bg-blue-500/10", text: "text-blue-400" },
  { key: "VIP" as const, label: "VIP", color: "#8b5cf6", ring: "ring-violet-500/30", bg: "bg-violet-500/10", text: "text-violet-400" },
  { key: "EXTERNAL" as const, label: "External", color: "#10b981", ring: "ring-emerald-500/30", bg: "bg-emerald-500/10", text: "text-emerald-400" },
  { key: "STANDBY" as const, label: "Standby", color: "#f59e0b", ring: "ring-amber-500/30", bg: "bg-amber-500/10", text: "text-amber-400" },
];

const TYPE_BADGE: Record<string, string> = {
  STANDARD: "bg-blue-500/20 text-blue-300",
  VIP: "bg-violet-500/20 text-violet-300",
  EXTERNAL: "bg-emerald-500/20 text-emerald-300",
  STANDBY: "bg-amber-500/20 text-amber-300",
};

const MEDAL_COLORS = ["text-amber-400", "text-zinc-300", "text-amber-600"];

// ── Main Component ───────────────────────────────────────────────────────

function CheckInContent({ eventId }: { eventId: string }) {
  const { events, updateEvent } = useEventContext();
  const router = useRouter();

  const [data, setData] = useState<CheckInResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isTogglingLive, setIsTogglingLive] = useState(false);

  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const chartRef = useRef<ReactECharts>(null);
  const standbyChartRef = useRef<ReactECharts>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const currentEvent = events.find((e) => e.id === eventId);
  const isLive = currentEvent?.live ?? false;

  const fetchData = useCallback(
    async (showLoading = false) => {
      try {
        if (showLoading) setIsLoading(true);
        setError(null);
        const res = await fetch(`/api/events/${eventId}/checkin`);
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Failed to fetch check-in data");
        }
        const json: CheckInResponse = await res.json();
        setData(json);
        return json;
      } catch (err) {
        console.error("Error fetching check-in data:", err);
        setError(err instanceof Error ? err.message : "Failed to load data");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [eventId],
  );

  // Initial fetch + polling
  useEffect(() => {
    let cancelled = false;
    fetchData(true).then((result) => {
      if (cancelled) return;
      if (result?.isLive) {
        setIsPolling(true);
        pollRef.current = setInterval(() => {
          if (!cancelled) fetchData(false);
        }, 15_000);
      }
    });
    return () => {
      cancelled = true;
      clearInterval(pollRef.current);
      pollRef.current = undefined;
      setIsPolling(false);
    };
  }, [fetchData]);

  // Sync polling with live status
  useEffect(() => {
    if (isLive && !pollRef.current) {
      setIsPolling(true);
      pollRef.current = setInterval(() => fetchData(false), 15_000);
    } else if (!isLive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = undefined;
      setIsPolling(false);
    }
  }, [isLive, fetchData]);

  async function handleToggleLive() {
    if (!eventId) return;
    setIsTogglingLive(true);
    try {
      const newLive = !isLive;
      const res = await fetch("/api/events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: eventId, live: newLive }),
      });
      const result = await res.json();
      if (res.ok && result.event) {
        updateEvent(eventId, { live: newLive });
        if (newLive) {
          events.forEach((e) => {
            if (e.id !== eventId && e.live) updateEvent(e.id, { live: false });
          });
        }
        router.refresh();
        fetchData(false);
      } else {
        setError(result.error || "Failed to update live status");
      }
    } catch {
      setError("Failed to update live status");
    } finally {
      setIsTogglingLive(false);
    }
  }

  // ── Chart data ──

  const scanEpochs = useMemo(() => {
    if (!data) return [];
    return data.scanTimestamps.map((t) => new Date(t).getTime());
  }, [data]);

  const fullRange = useMemo<[number, number]>(() => {
    if (scanEpochs.length === 0) return [Date.now(), Date.now()];
    return [scanEpochs[0], Math.max(scanEpochs[scanEpochs.length - 1], scanEpochs[0] + MIN)];
  }, [scanEpochs]);

  const visibleRange = zoomRange ?? fullRange;
  const visibleSpan = visibleRange[1] - visibleRange[0];

  const { bucketedData, seriesLabel } = useMemo(() => {
    if (scanEpochs.length === 0)
      return { bucketedData: [] as [number, number, number][], seriesLabel: "Minute" };
    const interval = pickInterval(Math.max(visibleSpan, MIN));
    return {
      bucketedData: bucketEpochs(scanEpochs, interval, fullRange[0], fullRange[1]),
      seriesLabel: intervalLabel(interval),
    };
  }, [scanEpochs, fullRange, visibleSpan]);

  // Scan velocity: scans in last 5 minutes
  const scanVelocity = useMemo(() => {
    if (!data || scanEpochs.length === 0) return 0;
    const fiveMinAgo = Date.now() - 5 * MIN;
    const recent = scanEpochs.filter((e) => e >= fiveMinAgo).length;
    return Math.round(recent / 5);
  }, [data, scanEpochs]);

  // Time since doors opened
  const doorsDuration = useMemo(() => {
    if (!data?.doorsOpen) return null;
    const doorsMs = new Date(data.doorsOpen).getTime();
    const diff = Date.now() - doorsMs;
    return diff > 0 ? diff : null;
  }, [data]);

  // Estimated completion time
  const estimatedCompletion = useMemo(() => {
    if (!data || scanVelocity <= 0) return null;
    const remaining = data.totalTickets - data.scannedCount;
    if (remaining <= 0) return null;
    return Math.ceil(remaining / scanVelocity);
  }, [data, scanVelocity]);

  // Live scan rate chart: per-minute counts for last 30 minutes
  const scanRateChartOption = useMemo(() => {
    if (scanEpochs.length === 0) return null;
    const now = Date.now();
    const windowStart = now - 30 * MIN;
    const recentEpochs = scanEpochs.filter((e) => e >= windowStart);
    if (recentEpochs.length === 0) return null;

    const barData: [number, number][] = [];
    for (let t = Math.floor(windowStart / MIN) * MIN; t <= now; t += MIN) {
      const count = recentEpochs.filter((e) => e >= t && e < t + MIN).length;
      barData.push([t, count]);
    }

    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: "#18181b",
        borderColor: "#3f3f46",
        borderWidth: 1,
        textStyle: { color: "#fafafa", fontSize: 12 },
      },
      grid: { top: 10, right: 10, bottom: 30, left: 40, containLabel: false },
      xAxis: {
        type: "time" as const,
        axisLabel: { color: "#71717a", fontSize: 10, hideOverlap: true },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value" as const,
        axisLabel: { color: "#71717a", fontSize: 10 },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#27272a", type: "dashed" as const } },
        minInterval: 1,
      },
      series: [
        {
          type: "bar" as const,
          data: barData,
          itemStyle: { color: "rgba(16,185,129,0.6)", borderRadius: [2, 2, 0, 0] },
          emphasis: { itemStyle: { color: "#10b981" } },
          barMaxWidth: 12,
        },
      ],
    };
  }, [scanEpochs]);

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

  const onEvents = useMemo(() => ({ datazoom: onDataZoom }), [onDataZoom]);

  // Main check-in chart
  const chartOption = useMemo(() => {
    if (bucketedData.length === 0) return {};
    const barData = bucketedData.map(([ts, count]) => [ts, count]);
    const lineData = bucketedData.map(([ts, , cum]) => [ts, cum]);
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
        data: ["Cumulative", `Per ${seriesLabel}`],
        textStyle: { color: "#a1a1aa", fontSize: 12 },
        top: 0,
        left: "center",
        itemGap: 24,
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
          type: "value" as const,
          name: "Cumulative",
          nameTextStyle: { color: "#71717a", fontSize: 10, padding: [0, 0, 0, -24] },
          axisLabel: { color: "#71717a", fontSize: 10 },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: "#27272a", type: "dashed" as const } },
          minInterval: 1,
        },
        {
          type: "value" as const,
          name: `Per ${seriesLabel}`,
          nameTextStyle: { color: "#71717a", fontSize: 10, padding: [0, -24, 0, 0] },
          axisLabel: { color: "#71717a", fontSize: 10 },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          minInterval: 1,
        },
      ],
      dataZoom: [
        { type: "inside" as const, xAxisIndex: 0, filterMode: "none" as const, zoomOnMouseWheel: true, moveOnMouseMove: true, ...zoomProps },
        {
          type: "slider" as const, xAxisIndex: 0, filterMode: "none" as const, height: 24, bottom: 8,
          borderColor: "#3f3f46", backgroundColor: "#18181b", fillerColor: "rgba(16,185,129,0.15)",
          handleStyle: { color: "#10b981", borderColor: "#10b981" },
          dataBackground: { lineStyle: { color: "#3f3f46" }, areaStyle: { color: "#27272a" } },
          selectedDataBackground: { lineStyle: { color: "#10b981" }, areaStyle: { color: "rgba(16,185,129,0.15)" } },
          textStyle: { color: "#71717a", fontSize: 10 }, moveHandleStyle: { color: "#3f3f46" }, ...zoomProps,
        },
      ],
      series: [
        {
          name: `Per ${seriesLabel}`, type: "bar" as const, yAxisIndex: 1, data: barData,
          itemStyle: { color: "rgba(16,185,129,0.5)", borderRadius: [2, 2, 0, 0] },
          emphasis: { itemStyle: { color: "#10b981" } }, barMaxWidth: 28, large: true, z: 1,
        },
        {
          name: "Cumulative", type: "line" as const, yAxisIndex: 0, data: lineData, smooth: true, symbol: "none",
          lineStyle: { width: 2, color: "#3b82f6" },
          areaStyle: {
            color: {
              type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: "rgba(59,130,246,0.25)" }, { offset: 1, color: "rgba(59,130,246,0)" }],
            },
          },
          z: 2,
        },
      ],
    };
  }, [bucketedData, seriesLabel, zoomRange]);

  // Standby growth chart
  const standbyEpochs = useMemo(() => {
    if (!data) return [];
    return data.standbyTimestamps.map((t) => new Date(t).getTime());
  }, [data]);

  const standbyChartOption = useMemo(() => {
    if (standbyEpochs.length === 0) return null;
    const sorted = [...standbyEpochs].sort((a, b) => a - b);
    const lineData = sorted.map((ts, i) => [ts, i + 1]);
    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: "#18181b",
        borderColor: "#3f3f46",
        borderWidth: 1,
        textStyle: { color: "#fafafa", fontSize: 12 },
      },
      grid: { top: 20, right: 20, bottom: 30, left: 50, containLabel: false },
      xAxis: {
        type: "time" as const,
        axisLabel: { color: "#71717a", fontSize: 10, hideOverlap: true },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value" as const,
        axisLabel: { color: "#71717a", fontSize: 10 },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#27272a", type: "dashed" as const } },
        minInterval: 1,
      },
      series: [
        {
          type: "line" as const, data: lineData, smooth: true, symbol: "none",
          lineStyle: { width: 2, color: "#f59e0b" },
          areaStyle: {
            color: {
              type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: "rgba(245,158,11,0.25)" }, { offset: 1, color: "rgba(245,158,11,0)" }],
            },
          },
        },
      ],
    };
  }, [standbyEpochs]);

  // ── Loading / Error states ──

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-zinc-400">
          <div className="w-5 h-5 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
          <span className="text-sm">Loading check-in data...</span>
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

  if (!data) return null;

  const { totalTickets, scannedCount, byType, recentScans, waitlistCount, capacity, scannerLeaderboard, peakScansPerMin } = data;
  const checkInRate = totalTickets > 0 ? (scannedCount / totalTickets) * 100 : 0;
  const capacityRate = capacity > 0 ? (scannedCount / capacity) * 100 : 0;
  const topScanner = scannerLeaderboard.length > 0 ? scannerLeaderboard[0] : null;

  return (
    <div className="space-y-5">
      {/* ── Top bar: Live toggle + metrics ── */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        {/* Live toggle */}
        <button
          onClick={handleToggleLive}
          disabled={isTogglingLive}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-colors text-sm disabled:opacity-50 ${
            isLive
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30"
              : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
          }`}
        >
          <div className={`w-8 h-4 rounded-full relative transition-colors ${isLive ? "bg-emerald-500" : "bg-zinc-600"}`}>
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${isLive ? "translate-x-4" : "translate-x-0.5"}`} />
          </div>
          {isLive ? "Live" : "Not Live"}
        </button>

        <div className="h-8 w-px bg-zinc-700 hidden sm:block" />

        {/* Scan velocity */}
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="text-white font-bold text-lg">{scanVelocity}</span>
          <span className="text-zinc-400 text-sm">scans/min</span>
        </div>

        {/* Peak scans/min */}
        {peakScansPerMin > 0 && (
          <>
            <div className="h-8 w-px bg-zinc-700 hidden sm:block" />
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              <span className="text-white font-bold text-lg">{peakScansPerMin}</span>
              <span className="text-zinc-400 text-sm">peak/min</span>
            </div>
          </>
        )}

        {/* Best scanner */}
        {topScanner && (
          <>
            <div className="h-8 w-px bg-zinc-700 hidden sm:block" />
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
              <span className="text-white text-sm font-medium truncate max-w-[120px]">{topScanner.name}</span>
              <span className="text-zinc-400 text-sm">({topScanner.count})</span>
            </div>
          </>
        )}

        {/* Estimated completion */}
        {estimatedCompletion != null && (
          <>
            <div className="h-8 w-px bg-zinc-700 hidden sm:block" />
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-zinc-300 text-sm">~{estimatedCompletion} min left</span>
            </div>
          </>
        )}

        {/* Doors duration */}
        {doorsDuration && (
          <>
            <div className="h-8 w-px bg-zinc-700 hidden sm:block" />
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-zinc-300 text-sm">Doors open {formatDuration(doorsDuration)} ago</span>
            </div>
          </>
        )}

        {/* Polling indicator */}
        {isPolling && (
          <>
            <div className="h-8 w-px bg-zinc-700 hidden sm:block" />
            <div className="flex items-center gap-2 text-xs text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              Updating every 15s
            </div>
          </>
        )}
      </div>

      {/* ── Overall check-in rate ── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-lg font-semibold text-white">
              {scannedCount}
              <span className="text-zinc-400 font-normal text-sm"> / {totalTickets} checked in</span>
            </h3>
            {capacity > 0 && (
              <p className="text-xs text-zinc-500 mt-0.5">
                {capacityRate.toFixed(1)}% of venue capacity ({capacity})
              </p>
            )}
          </div>
          <span className={`text-3xl font-bold ${checkInRate >= 75 ? "text-emerald-400" : checkInRate >= 40 ? "text-blue-400" : "text-amber-400"}`}>
            {checkInRate.toFixed(1)}%
          </span>
        </div>
        <ProgressBar
          value={scannedCount}
          max={totalTickets}
          color={checkInRate >= 75 ? "#10b981" : checkInRate >= 40 ? "#3b82f6" : "#f59e0b"}
        />
      </div>

      {/* ── Per-type breakdown + waitlist ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {TYPE_CONFIG.map(({ key, label, color, bg, text }) => {
          const t = byType[key];
          if (t.total === 0) return null;
          const pct = t.total > 0 ? (t.scanned / t.total) * 100 : 0;
          return (
            <div key={key} className={`rounded-xl border border-zinc-800 p-4 ${bg}`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-semibold uppercase tracking-wider ${text}`}>{label}</span>
                <span className={`text-lg font-bold ${text}`}>{pct.toFixed(0)}%</span>
              </div>
              <p className="text-sm text-zinc-300 font-medium mb-2">
                {t.scanned} / {t.total}
              </p>
              <ProgressBar value={t.scanned} max={t.total} color={color} />
            </div>
          );
        })}
        {/* Waitlist card */}
        {waitlistCount > 0 && (
          <div className="rounded-xl border border-zinc-800 p-4 bg-rose-500/5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-rose-400">Waitlist</span>
              <svg className="w-4 h-4 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-2xl text-white font-bold">{waitlistCount}</p>
            <p className="text-xs text-zinc-500 mt-1">people waiting</p>
          </div>
        )}
      </div>

      {/* ── Live Scan Rate Chart ── */}
      {scanRateChartOption && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-sm font-semibold text-zinc-300">Live Scan Rate</h3>
            <span className="text-xs text-zinc-500">Last 30 minutes, per minute</span>
            {isPolling && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            )}
          </div>
          <ReactECharts
            option={scanRateChartOption}
            style={{ height: 160 }}
            opts={{ renderer: "canvas" }}
            notMerge
          />
        </div>
      )}

      {/* ── Scanner Leaderboard ── */}
      {scannerLeaderboard.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h3 className="text-sm font-semibold text-zinc-300 mb-4">Scanner Leaderboard</h3>
          <div className="space-y-3">
            {scannerLeaderboard.map((scanner, i) => {
              const pct = scannedCount > 0 ? (scanner.count / scannedCount) * 100 : 0;
              return (
                <div key={scanner.email || scanner.name} className="flex items-center gap-3">
                  <span className={`text-sm font-bold w-6 text-right ${i < 3 ? MEDAL_COLORS[i] : "text-zinc-500"}`}>
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

      {/* ── Two-column: Chart + Recent Scans ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Check-in timeline chart */}
        <div className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h3 className="text-sm font-semibold text-zinc-300 mb-1">Check-in Timeline</h3>
          {scanEpochs.length > 0 ? (
            <>
              <p className="text-[10px] text-zinc-600 mb-1">
                Scroll to zoom &middot; Drag to pan &middot; Click legend to toggle
              </p>
              <ReactECharts
                ref={chartRef}
                option={chartOption}
                style={{ height: 350 }}
                opts={{ renderer: "canvas" }}
                onEvents={onEvents}
                notMerge
              />
            </>
          ) : (
            <div className="flex items-center justify-center h-[350px] text-zinc-600 text-sm">
              No check-ins yet
            </div>
          )}
        </div>

        {/* Recent scans live feed */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-zinc-300">Recent Scans</h3>
            {isPolling && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            )}
          </div>
          {recentScans.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
              No scans yet
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-1.5 max-h-[340px]">
              {recentScans.map((scan, i) => (
                <div
                  key={`${scan.scanTime}-${i}`}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-800/50 ${i === 0 && isPolling ? "ring-1 ring-emerald-500/30" : ""}`}
                >
                  <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-300 shrink-0">
                    {(scan.name || "?")[0].toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{scan.name || "Unknown"}</p>
                    <p className="text-[11px] text-zinc-500">
                      {formatTime(scan.scanTime)}
                      {scan.scannedBy && <span className="text-zinc-600"> &middot; by {scan.scannedBy}</span>}
                    </p>
                  </div>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${TYPE_BADGE[scan.type?.toUpperCase() ?? "STANDARD"] ?? TYPE_BADGE.STANDARD}`}>
                    {scan.type ?? "STD"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Standby line growth (if applicable) ── */}
      {data.standbyEnabled && standbyChartOption && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center gap-3 mb-3">
            <h3 className="text-sm font-semibold text-zinc-300">Standby Line Growth</h3>
            <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
              {byType.STANDBY.total} total
            </span>
            <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
              {byType.STANDBY.scanned} scanned
            </span>
          </div>
          <ReactECharts
            ref={standbyChartRef}
            option={standbyChartOption}
            style={{ height: 200 }}
            opts={{ renderer: "canvas" }}
            notMerge
          />
        </div>
      )}
    </div>
  );
}

// ── Wrapper ──────────────────────────────────────────────────────────────

export default function CheckInClient() {
  const { events, selectedEventId } = useEventContext();
  const currentEvent = events.find((e) => e.id === selectedEventId);

  return (
    <div className="px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
          Check-in
        </h1>
        {currentEvent && (
          <p className="text-zinc-400">{currentEvent.name || "Unnamed Event"}</p>
        )}
      </div>

      {!selectedEventId ? (
        <div className="text-center py-16 bg-zinc-900/50 rounded-2xl border border-zinc-800">
          <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-zinc-400 text-lg mb-2">No event selected</p>
          <p className="text-zinc-600 text-sm">Select an event from the sidebar to view check-in data</p>
        </div>
      ) : (
        <CheckInContent eventId={selectedEventId} />
      )}
    </div>
  );
}
