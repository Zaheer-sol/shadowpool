"use client";

/**
 * FTSO price line for a pair. Single series — the panel title names it, so no
 * legend. Crosshair + time/price readout come with the chart library.
 */
import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { PricePoint } from "@/lib/types";

const ACCENT = "#2cbfae";

export function PriceChart({ history, height = 320 }: { history: PricePoint[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

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
        vertLines: { color: "rgba(35,41,53,0.55)" },
        horzLines: { color: "rgba(35,41,53,0.55)" },
      },
      rightPriceScale: { borderColor: "#232935" },
      timeScale: { borderColor: "#232935", timeVisible: true, secondsVisible: true },
      crosshair: {
        vertLine: { color: "#5f6a7d", labelBackgroundColor: "#1c212b" },
        horzLine: { color: "#5f6a7d", labelBackgroundColor: "#1c212b" },
      },
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: ACCENT,
      lineWidth: 2,
      topColor: "rgba(44,191,174,0.18)",
      bottomColor: "rgba(44,191,174,0.0)",
      priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
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
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current || history.length === 0) return;
    // De-duplicate timestamps (the relay polls faster than 1s resolution).
    const seen = new Set<number>();
    const data = history
      .filter((p) => (seen.has(p.t) ? false : (seen.add(p.t), true)))
      .map((p) => ({ time: p.t as UTCTimestamp, value: Number(p.price) / 1e18 }));
    seriesRef.current.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [history]);

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}
