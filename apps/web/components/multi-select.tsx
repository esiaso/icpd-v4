'use client';
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Input } from './ui';

/** Lightweight searchable multi-select for id lists (specialities, providers). */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Search…',
}: {
  options: { id: number | string; name: string }[];
  value: (number | string)[];
  onChange: (v: (number | string)[]) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const selected = options.filter((o) => value.map(String).includes(String(o.id)));
  const matches = useMemo(
    () => options.filter((o) => !value.map(String).includes(String(o.id)) && o.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8),
    [options, value, q],
  );
  return (
    <div className="space-y-2">
      {!!selected.length && (
        <div className="flex flex-wrap gap-1">
          {selected.map((o) => (
            <span key={o.id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {o.name}
              <button type="button" aria-label={`Remove ${o.name}`} onClick={() => onChange(value.filter((v) => String(v) !== String(o.id)))}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {q && (
        <div className="max-h-48 overflow-y-auto rounded-md border">
          {matches.map((o) => (
            <button type="button" key={o.id} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-secondary" onClick={() => { onChange([...value, o.id]); setQ(''); }}>
              {o.name}
            </button>
          ))}
          {!matches.length && <p className="px-3 py-2 text-sm text-muted-foreground">No matches</p>}
        </div>
      )}
    </div>
  );
}
