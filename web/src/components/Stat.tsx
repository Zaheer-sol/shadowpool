export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel px-5 py-4">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">{label}</p>
      <p className="num mt-1.5 text-xl text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-ink-3">{sub}</p>}
    </div>
  );
}
