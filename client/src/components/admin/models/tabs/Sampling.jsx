import { useAdmin } from '../../store.jsx';
import { Card, Fields } from '../../ui.jsx';
import { useEditor, NumberField, LongText, When } from '../bind.jsx';
import { t, tk } from '../../../../i18n.jsx';

const BANKS = [
  [tk('Core'), tk('Randomness and length. The ones worth touching first.'), [
    ['temperature', '0.0 – 2.0'], ['top_p', '0.0 – 1.0'], ['top_k', '40'], ['min_p', '0.0 – 1.0'],
    ['max_tokens', '2048'], ['seed', 'integer']
  ]],
  [tk('Repetition'), tk('Discourage the model from looping. DRY is llama.cpp only; its other settings appear once its multiplier is above 0.'), [
    ['repetition_penalty', '1.1'], ['presence_penalty', '-2.0 – 2.0'], ['frequency_penalty', '-2.0 – 2.0'],
    ['dry_multiplier', '0 = off'], ['dry_base', '1.75', 'dry_multiplier'], ['dry_allowed_length', '2', 'dry_multiplier'],
    ['dry_penalty_last_n', '-1 = all', 'dry_multiplier']
  ]],
  [tk('Experimental'), tk('XTC and Mirostat change how tokens are picked. Their other settings appear once each is switched on.'), [
    ['xtc_probability', '0 = off'], ['xtc_threshold', '0.1', 'xtc_probability'],
    ['mirostat', '0, 1, or 2'], ['mirostat_tau', '5.0', 'mirostat'], ['mirostat_eta', '0.1', 'mirostat']
  ]]
];

const INFO = {
  temperature: tk("Scales how random each word choice is. The model scores every possible next token, and temperature stretches or flattens those odds before one is picked. Low values (0.1 to 0.5) keep it on the most likely words, so replies are focused, consistent and can feel repetitive. Around 0.7 to 1.0 is balanced. Higher values give rarer words a real chance, which reads as more creative but drifts off topic and makes more mistakes. 0 always picks the single most likely word."),
  top_p: tk("Nucleus sampling. The model ranks the next tokens by probability, keeps only the smallest group whose chances add up to this value, and picks from that group. 0.9 drops the long tail of unlikely words while keeping variety, lower values such as 0.5 make replies safer and plainer, and 1.0 turns it off. Adjust either this or temperature rather than both, since they pull on the same thing."),
  top_k: tk("Keeps only the K most likely next tokens and discards the rest before picking. 40 is a common default. Small values such as 5 to 10 make the model cautious and predictable, while large values or 0 (off) leave room for unusual wording. Unlike Top P it ignores how confident the model is, so it cuts the same number of options whether the next word is obvious or wide open."),
  min_p: tk("Drops any token whose probability is below this fraction of the most likely one. At 0.05, a word survives only if it is at least 5% as likely as the top choice. It adapts to confidence: when the model is sure, nearly everything else is cut, and when many words fit, more of them stay. Values from 0.02 to 0.1 work well and pair nicely with a higher temperature for creative writing that stays coherent."),
  max_tokens: tk("The most tokens the model may write in one reply, where a token is roughly three quarters of an English word. It limits length and cost, not quality: the model does not plan to fill it and simply stops when it reaches the limit, sometimes mid-sentence. Reasoning models spend part of this budget thinking, so give them more room. Leave it blank to let the backend decide."),
  seed: tk("Fixes the random number generator used for sampling. With the same seed, prompt and settings, many backends return the same reply every time, which helps when testing a prompt or comparing models fairly. Leave it blank for a different reply on each run. Hosted providers often treat it as best effort, and any change to the prompt or settings changes the output anyway."),
  repetition_penalty: tk("Makes tokens that already appear in the recent text less likely to be picked again. 1.0 is off, and 1.05 to 1.15 gently stops loops and repeated phrases. Much higher values push the model away from common words it genuinely needs, such as articles or a variable name in code, and the writing turns strange. Mostly used by local backends; OpenAI-style providers use the presence and frequency penalties instead."),
  presence_penalty: tk("Applies one flat penalty to every token that has appeared at least once so far, however often. Positive values (0.1 to 1.0) nudge the model toward new words and topics so it is less likely to circle back to what it already said. Negative values encourage it to stay on familiar ground. Values above 1.5 can make replies wander or avoid terms they need."),
  frequency_penalty: tk("Penalises a token more each time it repeats, so a word used five times is pushed down harder than one used once. This targets verbatim repetition and filler phrases while still letting a word appear a few times. 0.1 to 0.5 is usually enough to break loops, and negative values make repetition more likely. Unlike the presence penalty, it grows with the count."),
  dry_multiplier: tk("DRY (Do not Repeat Yourself) penalises repeating whole sequences rather than single words. When the text so far ends with the start of a passage that already appeared, the token that would continue the copy is penalised, more strongly the longer the match. This sets its overall strength: 0 is off and 0.8 is a good starting point. It breaks long loops without punishing ordinary words."),
  dry_base: tk("How fast the DRY penalty grows as a repeated sequence gets longer. The penalty is the multiplier times this base raised to the number of matching tokens beyond the allowed length. 1.75 is standard. Raising it makes long repeats nearly impossible while barely touching short ones, and lowering it makes the penalty climb gently."),
  dry_allowed_length: tk("How many tokens may repeat before DRY starts penalising. Short repeats are normal, such as names, code keywords and common phrases, so the default of 2 leaves those alone. Raise it to 3 or 4 if the model avoids terms it needs to repeat, or lower it to catch repetition sooner."),
  dry_penalty_last_n: tk("How far back, in tokens, DRY looks for earlier sequences to match against. -1 searches the whole context, which catches repeats from long ago at a small cost per token. A smaller window such as 1024 only stops recent loops and lets the model reuse wording from much earlier in the conversation."),
  xtc_probability: tk("XTC (Exclude Top Choices) sometimes removes the most predictable tokens, forcing the model off its most obvious path. This is the chance it triggers on any given token: 0 is off and around 0.5 is typical. It makes creative writing less formulaic but can hurt accuracy, so leave it off for code, maths and facts."),
  xtc_threshold: tk("When XTC triggers, every token at or above this probability is removed except the least likely of them, so one sensible choice always remains. 0.1 is standard. Lower thresholds cut more of the obvious options and push the style further, while 0.5 or above rarely finds two candidates to cut and has little effect."),
  mirostat: tk("Mirostat replaces Top P, Top K and similar filters with a feedback loop that keeps the text at a steady level of surprise, measured as perplexity. 0 is off, 1 is the original algorithm and 2 is the simpler version most backends recommend. Use it when long replies swing between dull and incoherent. While it is on, the other filtering settings are mostly ignored."),
  mirostat_tau: tk("The level of surprise Mirostat aims for. Lower values such as 3 give focused, predictable text, and higher values such as 7 or 8 give more varied, creative text. 5 is the usual default."),
  mirostat_eta: tk("How quickly Mirostat corrects itself when the text drifts from its target. Higher values such as 0.2 react fast but can overshoot and wobble, while lower values such as 0.05 adjust slowly and smoothly. 0.1 is the usual default.")
};

const FALLBACK = ['temperature', 'top_p', 'top_k', 'min_p', 'repetition_penalty', 'presence_penalty', 'frequency_penalty', 'seed', 'max_tokens'];

export default function Sampling() {
  const { catalog } = useAdmin();
  const { providers, providerTypes } = catalog;
  const { models } = useEditor();

  const types = new Set();
  const allowed = new Set();
  for (const m of models) {
    const conn = providers.find(p => p.id === m.provider_id) || providers[0];
    const type = conn ? providerTypes[conn.type] : null;
    if (type) types.add(type.label);
    for (const k of (type?.samplers || FALLBACK)) allowed.add(k);
  }

  return (
    <>
      <Card title={t('Sampling')}
        sub={types.size === 1
          ? t('Blank uses the backend default. Only parameters {name} accepts are shown.', { name: [...types][0] })
          : t('Blank uses the backend default.')}>
        <LongText k="stop" mono rows={3} label={t('Stop sequences')} placeholder={'</s>\n<|im_end|>'}
          hint={t('One per line, up to 8. Generation stops as soon as one appears and the sequence itself is not shown.')} />
      </Card>
      {BANKS.map(([title, note, fields]) => {
        const shown = fields.filter(([k]) => allowed.has(k));
        if (!shown.length) return null;
        return (
          <Card key={title} title={t(title)} sub={t(note)}>
            <Fields cols={3}>
              {shown.map(([k, ph, parent]) => (parent
                ? (
                  <When key={k} test={m => Number(m[parent]) > 0} keep={k}>
                    <NumberField k={k} label={k} placeholder={ph} info={t(INFO[k])} />
                  </When>
                )
                : <NumberField key={k} k={k} label={k} placeholder={ph} info={t(INFO[k])} />))}
            </Fields>
          </Card>
        );
      })}
    </>
  );
}