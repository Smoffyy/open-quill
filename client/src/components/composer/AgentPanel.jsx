import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Chevron, ListChecks } from '../ui/icons.jsx';
import { t, tk } from '../../i18n.jsx';

const STATUS = {
  completed: tk('Done'),
  in_progress: tk('In progress'),
  pending: tk('Not started')
};

function Steps({ items }) {
  const ref = useRef(null);
  const active = items.findIndex(it => it.status === 'in_progress');
  useLayoutEffect(() => {
    const list = ref.current;
    const el = list && active >= 0 ? list.children[active] : null;
    if (!el) return;
    const top = el.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - (list.clientHeight - el.offsetHeight) / 2);
    }
  }, [active, items.length]);
  return (
    <ul className="ap-list" ref={ref}>
      {items.map((it, i) => (
        <li key={i} className={'ap-item ' + it.status}>
          <span className="ap-mark" aria-hidden="true">{it.status === 'completed' && <Check />}</span>
          <span className="ap-text">{it.content}</span>
          <span className="sr-only">{t(STATUS[it.status] || STATUS.pending)}</span>
        </li>
      ))}
    </ul>
  );
}

function Plan({ plan }) {
  const complete = plan.done === plan.total;
  const [pinned, setPinned] = useState(null);
  useEffect(() => { setPinned(null); }, [complete]);
  const open = pinned ?? !complete;
  return (
    <section className={'ap-plan ap-enter' + (open ? ' open' : '')}>
      <button type="button" className="ap-plan-head" aria-expanded={open} onClick={() => setPinned(!open)}>
        <ListChecks className="ap-ic" aria-hidden="true" />
        <span className="ap-title">{t('Plan')}</span>
        <span className="ap-count">{t('{done} of {total} done', { done: plan.done, total: plan.total })}</span>
        <Chevron className="ap-chev" aria-hidden="true" />
      </button>
      {open && plan.items.length > 0 && <Steps items={plan.items} />}
    </section>
  );
}

function PreviousPlan({ plan }) {
  return (
    <section className="ap-plan ap-prev open">
      <div className="ap-plan-head static">
        <ListChecks className="ap-ic" aria-hidden="true" />
        <span className="ap-title">{t('Previous plan')}</span>
        <span className="ap-count">{t('{done} of {total} done', { done: plan.done, total: plan.total })}</span>
      </div>
      {plan.items.length > 0 && <Steps items={plan.items} />}
    </section>
  );
}

function Question({ question, onAnswer, onSkip }) {
  const [picked, setPicked] = useState([]);
  const toggle = (o) => setPicked(p => (p.includes(o) ? p.filter(x => x !== o) : [...p, o]));
  const send = () => onAnswer(question.options.filter(o => picked.includes(o)).join(', '));
  return (
    <section className="ap-question" role="group" aria-label={question.question || t('Question')}>
      {question.question && <div className="ap-q">{question.question}</div>}
      <div className="ap-options">
        {question.options.map((o, i) => (question.multiple
          ? <button key={i} type="button" className="ap-opt" aria-pressed={picked.includes(o)} onClick={() => toggle(o)}>{o}</button>
          : <button key={i} type="button" className="ap-opt" onClick={() => onAnswer(o)}>{o}</button>))}
        <span className="ap-actions">
          <button type="button" className="ap-skip" onClick={onSkip}>{t('Skip')}</button>
          {question.multiple && (
            <button type="button" className="ap-send" disabled={!picked.length} onClick={send}>{t('Send')}</button>
          )}
        </span>
      </div>
      <div className="ap-hint">{question.multiple ? t('Pick one or more, then send. Or type your own below.') : t('Pick an answer, or type your own below.')}</div>
    </section>
  );
}

export default function AgentPanel({ plan, previousPlan, question, onAnswer, onSkip }) {
  const [showPrev, setShowPrev] = useState(false);
  const prevKey = previousPlan?.key || '';
  useEffect(() => { setShowPrev(false); }, [prevKey]);
  const withPrev = showPrev && !!previousPlan;
  if (!plan && !question && !previousPlan) return null;
  const label = withPrev ? t('Hide previous plan') : t('Show previous plan');
  return (
    <div className="agent-dock">
      {previousPlan && (
        <button type="button" className={'ap-prev-toggle' + (withPrev ? ' open' : '')} aria-expanded={withPrev}
          aria-label={label} title={label} onClick={() => setShowPrev(v => !v)}>
          <Chevron aria-hidden="true" />
        </button>
      )}
      {(plan || question || withPrev) && (
        <div className="agent-panel">
          {withPrev && <PreviousPlan plan={previousPlan} />}
          {plan && <Plan key={plan.key} plan={plan} />}
          {question && <Question key={question.id} question={question} onAnswer={onAnswer} onSkip={onSkip} />}
        </div>
      )}
    </div>
  );
}
