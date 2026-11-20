'use client';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SERIES: [string, string, string][] = [
  ['registrations', 'Registrations', '#0f5132'],
  ['activities', 'Activities', '#2b8a6e'],
  ['claims', 'Claims', '#c08a1e'],
  ['nonToken', 'Non-token claims', '#7a5195'],
];

export function DashboardCharts({ monthly }: { monthly: Record<string, number[]> }) {
  const rows = MONTHS.map((m, i) => Object.fromEntries([['month', m], ...SERIES.map(([k]) => [k, monthly[k]?.[i] ?? 0])]));
  return (
    <div className="mt-6 grid gap-4 xl:grid-cols-2">
      {SERIES.map(([k, label, color]) => (
        <Card key={k}>
          <CardHeader><CardTitle className="text-base">{label} per month</CardTitle></CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} width={32} />
                <Tooltip />
                <Legend />
                <Bar dataKey={k} name={label} fill={color} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
