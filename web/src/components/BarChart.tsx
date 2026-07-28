"use client";

/**
 * Daily bar chart (volume or counts). Single series, single hue — the panel
 * title carries identity; per-bar values surface in the crosshair tooltip.
 */
import { useEffect, useRef } from "react";
import {
  ColorType,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";

export function BarChart({
  points,
  height = 220,
  format = "count",
}: {
  points: { day: string; value: number }[];
  height?: number;
  format?: "usd" | "count";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#5f6a7d",
        fontFamily: "var(--font-jetbrains-mono), monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "rgba(35,41,53,0.55)" },
      },
      rightPriceScale: { borderColor: "#232935" },
      timeScale: { borderColor: "#232935" },
      crosshair: {
        vertLine: { color: "#5f6a7d", labelBackgroundColor: "#1c212b" },
        horzLine: { color: "#5f6a7d", labelBackgroundColor: "#1c212b" },
      },
    });
    const series = chart.addSeries(HistogramSeries, {
      color: "#2cbfae",
      priceFormat:
        format === "usd"
          ? { type: "volume" }
          : { type: "price", precision: 0, minMove: 1 },
    });
    chartRef.current = chart;
    seriesRef.current = series;
    const resize = () => chart.applyOptions({ width: el.clientWidth });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height, format]);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(
      points.map((p) => ({
        time: (Date.parse(p.day) / 1000) as UTCTimestamp,
        value: p.value,
      })),
    );
    chartRef.current?.timeScale().fitContent();
  }, [points]);

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}
