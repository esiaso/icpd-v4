'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Empty, Progress, Select } from '../ui';
import { download, get } from '@/lib/api';
import { fmtDate, pts } from '@/lib/utils';

const COLORS = ['#0f5132', '#2b8a6e', '#c08a1e', '#7a5195', '#ef5675', '#3b6fb6', '#8c6d31', '#5f9ea0'];

function Gauge({ value }: { value: number }) {
  const v = Math.min(100, value);
  const r = 52;
  const c = Math.PI * r;
  return (
    <svg viewBox="0 0 120 70" className="h-28 w-48" role="img" aria-label={`${value}% of the annual requirement`}>
      <path d="M8 62 A52 52 0 0 1 112 62" fill="none" stroke="hsl(var(--secondary))" strokeWidth="12" strokeLinecap="round" />
      <path d="M8 62 A52 52 0 0 1 112 62" fill="none" stroke={v >= 100 ? '#059669' : 'hsl(var(--primary))'} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
      <text x="60" y="58" textAnchor="middle" className="fill-current text-[18px] font-bold">{value}%</text>
    </svg>
  );
}

/** Bucket progress bars and plain-language explanations (spec 5.7.2). */
export function ComplianceView({ base, year }: { base: string; year: number }) {
  const { data: c } = useQuery({ queryKey: [`${base}/compliance`, year], queryFn: () => get(`${base}/compliance?year=${year}`) });
  if (!c) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          Compliance {year}
          {c.exempted ? <Badge variant="warning">exempted</Badge> : c.compliant ? <Badge variant="success">compliant</Badge> : <Badge variant="destructive">not yet compliant</Badge>}
          <span className="text-xs font-normal text-muted-foreground">Rules: {c.frameworkName}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {c.exemption && <Alert variant="warning">Exempted for {year}: {c.exemption.reason}</Alert>}
        <div>
          <div className="mb-1 flex justify-between text-sm"><span>Countable points</span><span>{pts(c.countablePoints)} of {pts(c.totalRequired)}{c.rawPoints !== c.countablePoints ? ` (${pts(c.rawPoints)} recorded)` : ''}</span></div>
          <Progress value={(c.countablePoints / Math.max(1, c.totalRequired)) * 100} />
        </div>
        {c.buckets.map((b: any) => (
          <div key={b.bucketId}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="font-medium">{b.name}</span>
              <span>{pts(b.points)} of {pts(b.required)} · {b.distinctTypes}/{b.requiredDistinctTypes} activity types</span>
            </div>
            <Progress value={(b.points / Math.max(1, b.required)) * 100} />
            <p className={`mt-1 text-xs ${b.passed ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300'}`}>{b.message}</p>
          </div>
        ))}
        {!c.compliant && !c.buckets.length && c.reasons.map((r: string) => <p key={r} className="text-sm text-amber-700 dark:text-amber-300">{r}</p>)}
      </CardContent>
    </Card>
  );
}

/** Points grouped by activity type: table + chart with drill-down (spec 5.7.1). */
export function TypeSummary({ base, year, onPick, picked }: { base: string; year: number; onPick?: (id: number | null) => void; picked?: number | null }) {
  const { data: s } = useQuery({ queryKey: [`${base}/diary/summary`, year], queryFn: () => get(`${base}/diary/summary?year=${year}`) });
  if (!s) return null;
  if (!s.byType.length) return <Empty>No points recorded for {year} yet.</Empty>;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Points by activity type</CardTitle></CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground"><tr><th className="py-1">Activity type</th><th className="text-right">Claims</th><th className="text-right">Points</th><th className="text-right">Countable</th><th className="text-right">Share</th></tr></thead>
            <tbody>
              {s.byType.map((r: any) => (
                <tr key={r.activityTypeId} className={`cursor-pointer border-t hover:bg-secondary/40 ${picked === r.activityTypeId ? 'bg-primary/5' : ''}`} onClick={() => onPick?.(picked === r.activityTypeId ? null : r.activityTypeId)}>
                  <td className="py-1.5 text-primary underline-offset-2 hover:underline">{r.activityTypeName}</td>
                  <td className="text-right">{r.claims}</td>
                  <td className="text-right">{pts(r.rawPoints)}</td>
                  <td className={`text-right ${r.countablePoints < r.rawPoints ? 'text-amber-700 dark:text-amber-300' : ''}`}>{pts(r.countablePoints)}</td>
                  <td className="text-right">{r.share}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {s.split && (
            <p className="mt-3 text-xs text-muted-foreground">
              Speciality-related: {pts(s.split.specialityRelated.countable)} countable of {pts(s.split.specialityRelated.raw)}. Other areas: {pts(s.split.other.countable)} of {pts(s.split.other.raw)}.
            </p>
          )}
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={s.byType} layout="vertical" margin={{ left: 10, right: 10 }}>
              <XAxis type="number" fontSize={11} />
              <YAxis type="category" dataKey="activityTypeName" width={130} fontSize={11} tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)} />
              <Tooltip formatter={(v: any) => pts(v)} />
              <Bar dataKey="rawPoints" name="Points" onClick={(d: any) => onPick?.(d.activityTypeId)} cursor="pointer">
                {s.byType.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function DiaryTable({ base, year, activityTypeId }: { base: string; year: number; activityTypeId?: number | null }) {
  const { data = [] } = useQuery({ queryKey: [`${base}/diary`, year, activityTypeId], queryFn: () => get<any[]>(`${base}/diary?year=${year}${activityTypeId ? `&activityTypeId=${activityTypeId}` : ''}`) });
  if (!data.length) return <Empty>No diary entries{activityTypeId ? ' of this type' : ''} for {year}.</Empty>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-secondary/60 text-left"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Activity</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Method</th><th className="px-3 py-2 text-right">Points</th></tr></thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.id} className="border-t">
              <td className="whitespace-nowrap px-3 py-2">{fmtDate(d.claimedAt)}</td>
              <td className="px-3 py-2"><p>{d.name}</p><p className="text-xs text-muted-foreground">{d.provider}</p></td>
              <td className="px-3 py-2 text-xs">{d.activityType?.name}</td>
              <td className="px-3 py-2"><Badge variant="secondary">{d.method}</Badge></td>
              <td className="px-3 py-2 text-right font-medium">{pts(d.cpdPoints)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Portfolio: gauge, compliance, grouped summary, diary (practitioner or regulator view). */
export function PortfolioView({ base, pdfBase, certificate }: { base: string; pdfBase: string; certificate?: boolean }) {
  const [year, setYear] = useState<number | null>(null);
  const [type, setType] = useState<number | null>(null);
  const { data: p } = useQuery({ queryKey: [`${base}/portfolio`, year], queryFn: () => get(`${base}/portfolio${year ? `?year=${year}` : ''}`) });
  if (!p) return null;
  const y = p.year as number;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="CPD year" className="w-32" value={y} onChange={(e) => { setYear(Number(e.target.value)); setType(null); }}>
          {p.years.map((yy: number) => <option key={yy} value={yy}>{yy}</option>)}
        </Select>
        <Button variant="outline" size="sm" onClick={() => download(`${pdfBase}/diary/pdf?year=${y}`, `cpd-diary-${y}.pdf`)}>Download diary (PDF)</Button>
        {certificate && <Button variant="outline" size="sm" onClick={() => download(`${pdfBase}/certificate/pdf?year=${y}`, `cpd-certificate-${y}.pdf`)}>Certificate of compliance</Button>}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col items-center pt-5">
            <Gauge value={p.performance} />
            <p className="text-2xl font-bold">{pts(p.points)} <span className="text-base font-normal text-muted-foreground">of {pts(p.required)} points</span></p>
            <p className="text-xs text-muted-foreground">{y} · {pts(p.countablePoints)} countable</p>
          </CardContent>
        </Card>
        <div className="lg:col-span-2"><ComplianceView base={base} year={y} /></div>
      </div>
      <TypeSummary base={base} year={y} onPick={setType} picked={type} />
      <div>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="font-semibold">Diary {y}</h2>
          {type && <Button size="sm" variant="outline" onClick={() => setType(null)}>Show all types ✕</Button>}
        </div>
        <DiaryTable base={base} year={y} activityTypeId={type} />
      </div>
      {!!p.pendingClaims.length && (
        <div>
          <h2 className="mb-2 font-semibold">Claims awaiting approval or rejected</h2>
          <Card className="divide-y">
            {p.pendingClaims.map((c: any) => (
              <a key={c.id} href={base === '/me' ? `/practitioner/portfolio/claims/${c.id}` : '#'} className="flex items-center justify-between gap-2 p-3 text-sm hover:bg-secondary/40">
                <div>
                  <p className="font-medium">{c.activityName}</p>
                  <p className="text-xs text-muted-foreground">{c.activityType.name} · submitted {fmtDate(c.claimDate)}{c.reason ? ` · Reason: ${c.reason}` : ''}</p>
                </div>
                <Badge variant={c.status === 'Pending' ? 'warning' : 'destructive'}>{c.status}</Badge>
              </a>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
