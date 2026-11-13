import { useReasonCodes } from '../lib/referenceData';
import { Field, inputClass } from './ui';

/** Reason-code picker filtered to one use; notes are required for codes that say so (server enforces). */
export function ReasonSelect({
  use,
  id,
  value,
  onChange,
  label = 'Reason',
}: {
  use: string;
  id: string;
  value: string;
  onChange: (code: string, requiresNote: boolean) => void;
  label?: string;
}) {
  const codes = useReasonCodes(use);
  return (
    <Field label={label} htmlFor={id}>
      <select
        id={id}
        className={inputClass}
        value={value}
        onChange={(e) => {
          const c = codes.data?.find((r) => r.code === e.target.value);
          onChange(e.target.value, Boolean(c?.requires_note));
        }}
      >
        <option value="">Choose…</option>
        {(codes.data ?? []).map((r) => (
          <option key={r.code} value={r.code}>
            {r.description}
            {r.requires_note ? ' (note required)' : ''}
          </option>
        ))}
      </select>
    </Field>
  );
}
