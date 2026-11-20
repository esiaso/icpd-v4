'use client';
import * as T from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export function Tabs({ tabs, defaultValue, value, onValueChange }: { tabs: { value: string; label: string; content: React.ReactNode }[]; defaultValue?: string; value?: string; onValueChange?: (v: string) => void }) {
  return (
    <T.Root defaultValue={defaultValue ?? tabs[0]?.value} value={value} onValueChange={onValueChange}>
      <T.List className="mb-4 flex gap-1 overflow-x-auto border-b">
        {tabs.map((t) => (
          <T.Trigger
            key={t.value}
            value={t.value}
            className={cn('whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-foreground')}
          >
            {t.label}
          </T.Trigger>
        ))}
      </T.List>
      {tabs.map((t) => (
        <T.Content key={t.value} value={t.value}>{t.content}</T.Content>
      ))}
    </T.Root>
  );
}
