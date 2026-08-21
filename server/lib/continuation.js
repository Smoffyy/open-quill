// A step that makes no tool call ends the agentic turn, which is correct almost
// always: no call means the model is talking to the user. The exception is
// common enough to be worth catching. Small models routinely end the turn one
// sentence AFTER announcing the work — "Now I'll create the remaining files." —
// and the user has to type "keep going" to get what they already asked for.
//
// This recognises that one shape: a forward-looking statement, with no question
// to the user and no sign of being finished. It is deliberately narrow. Stopping
// is always the safe outcome, so anything ambiguous stops; a false positive
// costs a wasted step and a model told to continue work it already completed.

// The model handed control back on purpose. Checked first, so "let me know if
// you want anything else" never reads as "let me ...".
const HANDBACK = /\b(let me know|would you like|do you want|shall i|should i|anything else|what would you|if you(?:'d| would) like|feel free|hope (?:this|that) helps)\b/i;

// The model says it is done. Trust it.
const FINISHED = /\b(that'?s everything|that'?s all|everything is (?:created|done|in place|ready)|all (?:the )?(?:files|of them)[^.!?]{0,40}(?:are|have been|were) (?:created|written|done|added)|(?:^|[.!?\s])(?:done|finished|complete)[.!])/i;

// The model says it is about to do something.
const INTENT = /\b(?:i'?ll|i will|i'?m going to|i am going to|let me|let'?s|then i'?ll|next i'?ll)\s+(?:now\s+)?[a-z]/i;

function finalSentence(s) {
  const parts = s.split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : s;
}

export function announcedMoreWork(text) {
  const s = String(text == null ? '' : text).replace(/\s+$/, '');
  if (!s) return false;
  // A question is a hand-back whatever else it contains.
  if (s.endsWith('?')) return false;
  if (HANDBACK.test(s.slice(-300))) return false;
  // Only how the reply ENDS can vote for continuing. An intent stated up front
  // and then carried out ("I'll create the config file. … All three files are
  // created.") is a finished turn, not a stall.
  const last = finalSentence(s);
  if (FINISHED.test(last)) return false;
  return INTENT.test(last);
}

export const MAX_CONTINUES = 2;

export const CONTINUE_INSTRUCTION =
  'You described what you would do next but made no tool call, so nothing happened. Make the real tool calls now and keep going until the task is actually finished. If it is already finished, reply with one short sentence saying so.';
