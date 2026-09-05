import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../api.js';
import { Card, Btn, Seg, Table, Stats, Badge, Empty, fmtInt, fmtAgo } from '../ui.jsx';
import { Star } from '../../icons.jsx';
import { t } from '../../../i18n.jsx';

const PAGE = 50;

export default function RatingsSection() {
  const [rows, setRows] = useState(null);
  const [counts, setCounts] = useState({ up: 0, down: 0 });
  const [offset, setOffset] = useState(0);
  const [only, setOnly] = useState('all');

  const load = useCallback(async (off) => {
    try {
      const d = await api.get('/api/admin/feedback?offset=' + off);
      setRows(d.feedback || []);
      setCounts(d.counts || { up: 0, down: 0 });
      setOffset(off);
    } catch { setRows([]); }
  }, []);

  useEffect(() => { load(0); }, [load]);

  const shown = (rows || []).filter(f => only === 'all' || (only === 'up' ? f.rating === 1 : f.rating !== 1));
  const total = counts.up + counts.down;
  const pct = (n) => (total ? Math.round((n / total) * 100) + '%' : undefined);

  return (
    <>
      <Stats items={[
        { k: t('Rated replies'), v: fmtInt(total) },
        { k: t('Positive'), v: fmtInt(counts.up), n: pct(counts.up) },
        { k: t('Negative'), v: fmtInt(counts.down), n: pct(counts.down) }
      ]} />

      <Card title={t('Ratings')} flush
        sub={t('Newest first. Read the negatives against the model’s system prompt: most of them point at an instruction that is missing rather than a bad model.')}
        actions={
          <Seg value={only} label={t('Rating filter')} onChange={setOnly}
            options={[
              { value: 'all', label: t('All') },
              { value: 'up', label: t('Positive') },
              { value: 'down', label: t('Negative') }
            ]} />
        }
        foot={<>
          <Btn size="sm" disabled={offset === 0} onClick={() => load(Math.max(0, offset - PAGE))}>{t('Newer')}</Btn>
          <Btn size="sm" disabled={(rows || []).length < PAGE} onClick={() => load(offset + PAGE)}>{t('Older')}</Btn>
        </>}>
        {rows == null && <Empty icon={Star} title={t('Loading')} />}
        {rows != null && shown.length === 0 && (
          <Empty icon={Star} title={t('Nothing rated')}>{t('Ratings members leave on replies show up here.')}</Empty>
        )}
        {rows != null && shown.length > 0 && (
          <Table head={[
            { label: t('Rating'), fit: true },
            { label: t('When'), fit: true },
            { label: t('Member'), mono: true },
            { label: t('Model'), mono: true },
            { label: t('Reply') },
            { label: t('Comment') }
          ]}>
            {shown.map(f => (
              <tr key={f.id}>
                <td className="fit"><Badge tone={f.rating === 1 ? 'good' : 'bad'}>{f.rating === 1 ? '+1' : '−1'}</Badge></td>
                <td className="dim">{fmtAgo(f.ts)}</td>
                <td className="mono">{f.user}</td>
                <td className="mono dim">{f.model}</td>
                <td className="wrap">{f.snippet || <span className="dim">{t('(empty)')}</span>}</td>
                <td className="dim wrap">{f.comment || '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
