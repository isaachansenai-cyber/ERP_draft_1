/** Whole-number quantity from 1 to `max`, with 44 px buttons and a typed field. */
export function QuantityStepper({
  label,
  value,
  max,
  onChange,
  min = 1,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (n: number) => void;
  min?: number;
}) {
  const set = (n: number) => onChange(Math.max(min, Math.min(max, Math.trunc(n) || min)));
  const button =
    'flex h-11 w-11 items-center justify-center rounded-full border-2 border-charcoal/30 text-xl font-bold disabled:opacity-40 focus-visible:outline focus-visible:outline-4 focus-visible:outline-ultramarine';
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      <button type="button" className={button} onClick={() => set(value - 1)} disabled={value <= min}>
        <span aria-hidden="true">−</span>
        <span className="sr-only">Fewer</span>
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        onChange={(e) => set(Number(e.target.value))}
        className="h-11 w-14 rounded border-2 border-charcoal/30 bg-paper text-center text-lg focus-visible:outline focus-visible:outline-4 focus-visible:outline-ultramarine"
      />
      <button type="button" className={button} onClick={() => set(value + 1)} disabled={value >= max}>
        <span aria-hidden="true">+</span>
        <span className="sr-only">More</span>
      </button>
    </div>
  );
}
