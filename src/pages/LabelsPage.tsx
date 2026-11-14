// Printable Code 128 labels for every item (PRD §5, §13; AC28). The barcode
// encodes the internal item ID (CODE128_INTERNAL), never a manufacturer code.
import { useQuery } from '@tanstack/react-query';
import JsBarcode from 'jsbarcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Field, inputClass, Loading, Notice, QueryError } from '../components/ui';
import { supabase } from '../lib/supabase';

interface LabelItem {
  item_id: string;
  name: string;
  base_unit: string;
  category: string;
  item_type: string;
  barcode: string;
  barcode_type: string;
}

function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current) {
      JsBarcode(ref.current, value, { format: 'CODE128', displayValue: false, height: 48, width: 2, margin: 0 });
    }
  }, [value]);
  return <svg ref={ref} role="img" aria-label={`Code 128 barcode for ${value}`} data-barcode={value} />;
}

function ScannerTest({ items }: { items: LabelItem[] }) {
  const [value, setValue] = useState('');
  const [result, setResult] = useState<{ code: string; item: LabelItem | null } | null>(null);
  return (
    <form
      data-print="hide"
      className="flex flex-wrap items-end gap-2 rounded-md border border-slate-400 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const code = value.trim().toUpperCase();
        setResult({ code, item: items.find((i) => i.barcode === code) ?? null });
        setValue('');
      }}
    >
      <Field
        label="Scanner test"
        htmlFor="scanner-test"
        hint="Scan a label with a keyboard-wedge scanner (it types the code and Enter)"
      >
        <input
          id="scanner-test"
          className={inputClass}
          value={value}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <Button type="submit" variant="secondary">
        Check
      </Button>
      {result ? (
        <p className="w-full text-sm" role="status" data-testid="scanner-result">
          {result.item ? (
            <>
              Read <span className="font-mono font-semibold">{result.code}</span>: {result.item.name} (
              {result.item.base_unit})
              {result.item.item_type === 'ingredient' ? ' · ingredient — not sellable at the POS' : ''}
            </>
          ) : (
            <>
              Read <span className="font-mono">{result.code}</span>: no item has this code.
            </>
          )}
        </p>
      ) : null}
    </form>
  );
}

export function LabelsPage() {
  const items = useQuery({
    queryKey: ['label-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items')
        .select('item_id, name, base_unit, category, item_type, barcode, barcode_type')
        .is('archived_at', null)
        .order('item_id');
      if (error) throw error;
      return data as LabelItem[];
    },
  });
  const [category, setCategory] = useState('');
  const categories = useMemo(() => [...new Set((items.data ?? []).map((i) => i.category))].sort(), [items.data]);
  const shown = (items.data ?? []).filter((i) => !category || i.category === category);
  return (
    <section aria-labelledby="labels-heading" className="flex flex-col gap-4">
      <h1 id="labels-heading" className="text-2xl font-bold">
        Barcode labels
      </h1>
      <p className="text-sm text-slate-700" data-print="hide">
        Code 128 labels encode the internal item ID. They are not manufacturer UPC/GTIN codes.
      </p>
      {items.isPending ? (
        <Loading />
      ) : items.error ? (
        <QueryError error={items.error} onRetry={() => void items.refetch()} />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2" data-print="hide">
            <Field label="Category" htmlFor="label-category">
              <select
                id="label-category"
                className={inputClass}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All categories ({items.data.length} items)</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Button onClick={() => window.print()}>Print {shown.length} label(s)</Button>
          </div>
          <ScannerTest items={items.data} />
          <ul className="label-sheet grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" data-testid="label-sheet">
            {shown.map((i) => (
              <li
                key={i.item_id}
                className="label flex flex-col items-center gap-1 rounded border border-slate-400 bg-white p-2 text-center"
                data-testid={`label-${i.item_id}`}
              >
                <Barcode value={i.barcode} />
                <span className="font-mono text-base font-bold">{i.item_id}</span>
                <span className="text-xs leading-tight">{i.name}</span>
                <span className="text-xs">
                  Base unit: {i.base_unit} {i.item_type === 'ingredient' ? <Badge>ingredient</Badge> : null}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {items.data && items.data.length === 0 ? <Notice tone="warning">No items imported yet.</Notice> : null}
    </section>
  );
}
