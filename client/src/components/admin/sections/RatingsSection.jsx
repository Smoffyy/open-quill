import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../api.js';
import { Block, Btn, Table, Stats, Badge, Empty, fmtInt, fmtAgo } from '../ui.jsx';
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

  return (
    <>
      <Block>
        <Stats items={[
          { k: t('Rated replies'), v: fmtInt(total) },
          { k: t('Positive'), v: fmtInt(counts.up), n: total ? Math.round((counts.up / total) * 100) + '%' : undefined },
          { k: t('Negative'), v: fmtInt(counts.down), n: total ? Math.round((counts.down / total) * 100) + '%' : undefined }
        ]} />
      </Block>

      <Block title={t('Ratings')}
        sub={t('Newest first. Read the negatives against the model’s system prompt: most of them point at an instruction that is missing rather than a bad model.')}
        actions={<>
          <Btn size="sm" kind={only === 'all' ? 'primary' : undefined} onClick={() => setOnly('all')}>{t('All')}</Btn>
          <Btn size="sm" kind={only === 'up' ? 'primary' : undefined} onClick={() => setOnly('up')}>{t('Positive')}</Btn>
          <Btn size="sm" kind={only === 'down' ? 'primary' : undefined} onClick={() => setOnly('down')}>{t('Negative')}</Btn>
        </>}>
        {rows == null && <Empty title={t('Loading')} />}
        {rows != null && shown.length === 0 && (
          <Empty title={t('Nothing rated')}>{t('Ratings members leave on replies show up here.')}</Empty>
        )}
        {rows != null && shown.length > 0 && (
          <Table head={[
            { label: t('Rating'), fit: true },
            { label: t('When'), fit: true, mono: true },
            { label: t('Member'), mono: true },
            { label: t('Model'), mono: true },
            { label: t('Reply') },
            { label: t('Comment') }
          ]}>
            {shown.map(f => (
              <tr key={f.id}>
                <td className="fit"><Badge tone={f.rating === 1 ? 'good' : 'bad'}>{f.rating === 1 ? '+1' : '−1'}</Badge></td>
                <td className="mono dim">{fmtAgo(f.ts)}</td>
                <td className="mono">{f.user}</td>
                <td className="mono dim">{f.model}</td>
                <td>{f.snippet || <span className="dim">{t('(empty)')}</span>}</td>
                <td className="dim">{f.comment || '—'}</td>
              </tr>
            ))}
          </Table>
        )}
        <div className="cp-acts" style={{ marginTop: 14 }}>
          <Btn size="sm" disabled={offset === 0} onClick={() => load(Math.max(0, offset - PAGE))}>{t('Newer')}</Btn>
          <Btn size="sm" disabled={(rows || []).length < PAGE} onClick={() => load(offset + PAGE)}>{t('Older')}</Btn>
        </div>
      </Block>
    </>
  );
}
