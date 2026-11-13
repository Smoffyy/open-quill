import { presetById } from './presets.js';

export const LAYOUTS = Object.freeze({
  card: Object.freeze({
    id: 'card',
    modelPicker: 'composer',
    toolChips: 'inline',
    floatingComposer: false,
    sendIcon: 'enter',
    replyIcon: 'last',
    reasoning: 'rolling',
    instantReveal: false,
    keepQuickPromptSpace: false,
    incognitoWording: 'incognito',
    cursor: Object.freeze({ on: false, style: 'block' })
  }),
  pill: Object.freeze({
    id: 'pill',
    modelPicker: 'topbar',
    toolChips: 'below',
    floatingComposer: true,
    sendIcon: 'arrow',
    replyIcon: 'every',
    reasoning: 'card',
    instantReveal: true,
    keepQuickPromptSpace: true,
    incognitoWording: 'temporary',
    cursor: Object.freeze({ on: true, style: 'circle' })
  })
});

export function layoutOf(preset) {
  return LAYOUTS[presetById(preset).layout];
}