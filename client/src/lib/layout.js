export const LAYOUTS = Object.freeze({
  card: Object.freeze({
    id: 'card',
    floatingComposer: false,
    pickerInTopbar: false,
    chipsBelowComposer: false,
    composerGauge: true,
    sendShowsEnter: true,
    replyIconOnEvery: false,
    rollingReasoning: true,
    instantReveal: false,
    keepQuickPromptSpace: false,
    temporaryChatLabel: false,
    cursor: Object.freeze({ on: false, style: 'block' })
  }),
  pill: Object.freeze({
    id: 'pill',
    floatingComposer: true,
    pickerInTopbar: true,
    chipsBelowComposer: true,
    composerGauge: false,
    sendShowsEnter: false,
    replyIconOnEvery: true,
    rollingReasoning: false,
    instantReveal: true,
    keepQuickPromptSpace: true,
    temporaryChatLabel: true,
    cursor: Object.freeze({ on: true, style: 'circle' })
  })
});

export function layoutOf(preset) {
  return preset === 'openai' ? LAYOUTS.pill : LAYOUTS.card;
}