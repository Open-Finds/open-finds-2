import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, ThumbsDown } from 'lucide-react';
import { Button } from './ui/button';
import { copyToClipboard } from '../lib/invite';
import {
  fetchAiSaveResults, likeRate, REASON_LABELS, rightFirstTimeRate, summarize, testSetRows,
  type AiSaveResult, type Tally,
} from '../lib/aiSaveResults';

const pct = (value: number | null) => (value === null ? '–' : `${value}%`);

function TallyTable({ title, groups }: { title: string; groups: Record<string, Tally> }) {
  const names = Object.keys(groups).sort((a, b) => groups[b].total - groups[a].total);
  if (!names.length) return null;
  return <section className="grid gap-2">
    <h3 className="text-heading text-foreground">{title}</h3>
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-small">
        <thead className="text-left text-muted-foreground">
          <tr><th className="p-3 font-medium">Group</th><th className="p-3 font-medium">Saves</th><th className="p-3 font-medium">Rated</th>
            <th className="p-3 font-medium">👍 of rated</th><th className="p-3 font-medium">Right first time (est.)</th></tr>
        </thead>
        <tbody>
          {names.map(name => {
            const tally = groups[name];
            return <tr key={name} className="border-t border-border tabular-nums">
              <td className="p-3 capitalize text-foreground">{name}</td>
              <td className="p-3">{tally.total}</td>
              <td className="p-3">{tally.likes + tally.dislikes}</td>
              <td className="p-3">{pct(likeRate(tally))}</td>
              <td className="p-3">{pct(rightFirstTimeRate(tally))}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </section>;
}

/** The admin "AI Save results" tab: the success rate, by site and by how the venue was found, and the 👎 posts to turn into tests. */
export function AiSaveResultsPanel() {
  const [rows, setRows] = useState<AiSaveResult[]>();
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try { setRows(await fetchAiSaveResults()); }
    catch { setError('Could not load the results. Only an admin can see them.'); setRows([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => summarize(rows ?? []), [rows]);
  const disliked = useMemo(() => (rows ?? []).filter(row => row.rating === 'dislike'), [rows]);
  if (!rows) return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-muted-foreground" aria-label="Loading" /></div>;

  const { all } = summary;
  const stats: [string, string, string][] = [
    ['Saves tracked', String(all.total), 'The latest 1,000 AI Save results.'],
    ['Rated', String(all.likes + all.dislikes), `${all.likes} 👍  ${all.dislikes} 👎`],
    ['👍 of rated', pct(likeRate(all)), 'What people told us.'],
    ['Right first time (est.)', pct(rightFirstTimeRate(all)), 'Thumbs, plus saves that needed no help.'],
  ].map(([a, b, c]) => [a as string, b as string, c as string]);

  return <div className="grid gap-6">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-title text-foreground">AI Save results</h2>
      <Button type="button" size="sm" variant="outline" onClick={() => void load()}><RefreshCw aria-hidden="true" /> Refresh</Button>
    </div>
    {error && <p role="alert" className="rounded-md border border-destructive-text/30 bg-destructive-soft px-4 py-3 text-sm text-destructive-text">{error}</p>}
    {!error && all.total === 0 && <p className="rounded-lg border border-border bg-card p-6 text-center text-muted-foreground">No results yet. They appear as people use AI Save.</p>}
    {all.total > 0 && <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, value, hint]) => <div key={label} className="rounded-lg border border-border bg-card p-4">
          <p className="text-small text-muted-foreground">{label}</p>
          <p className="text-title tabular-nums text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>)}
      </div>
      <TallyTable title="By site and kind of post" groups={summary.byGroup} />
      <TallyTable title="By how the venue was found" groups={summary.byFoundBy} />
      <section className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-heading text-foreground">Marked wrong ({disliked.length})</h3>
          <Button type="button" size="sm" variant="outline" disabled={!disliked.some(row => row.link)}
            onClick={async () => setCopied(await copyToClipboard(testSetRows(disliked).join('\n')))}>
            {copied ? 'Copied' : 'Copy as test-set rows'}
          </Button>
        </div>
        {disliked.length === 0 ? <p className="text-small text-muted-foreground">Nothing marked wrong yet.</p> : <ul className="grid gap-2">
          {disliked.slice(0, 30).map(row => <li key={`${row.user_id}:${row.attempt_id}`} className="rounded-lg border border-border bg-card p-3 text-small">
            <p className="flex items-center gap-2 text-foreground"><ThumbsDown size={14} aria-hidden="true" />
              <span className="capitalize">{row.platform}{row.post_kind !== 'unknown' ? ` ${row.post_kind}` : ''}</span>
              <span className="text-muted-foreground">· saved {row.venue_name ?? 'nothing'} ({row.outcome}, {row.found_by.replace('_', ' ')})</span></p>
            <p className="text-muted-foreground">{row.reason ? REASON_LABELS[row.reason] : 'No reason given'}{row.note ? ` · “${row.note}”` : ''}</p>
            {row.link && <a className="break-all text-info underline" href={row.link} target="_blank" rel="noopener noreferrer">{row.link}</a>}
          </li>)}
        </ul>}
      </section>
    </>}
  </div>;
}
