const REPEAT_LIMIT = 2;
const IDLE_LIMIT = 3;

export function createLoopGuard({ repeatLimit = REPEAT_LIMIT, idleLimit = IDLE_LIMIT } = {}) {
  let prevSig = '';
  let prevShape = '';
  let repeats = 0;
  let idle = 0;

  return {
    note({ calls = [], ok = 0, failed = 0, failKinds = [], repeated = 0 } = {}) {
      const sig = calls.map(c => c.name + ':' + (c.argsText || '')).join('|');
      const barren = ok === 0 && failed > 0;
      const shape = barren ? [...failKinds].sort().join(',') : '';
      repeats = shape && shape === prevShape ? repeats + 1 : 0;
      idle = calls.length > 0 && failed === 0 && repeated >= calls.length ? idle + 1 : 0;
      const failing = (barren && sig === prevSig) || repeats >= repeatLimit;
      prevSig = sig;
      prevShape = shape;
      if (failing) return 'failing';
      if (idle >= idleLimit) return 'repeating';
      return '';
    }
  };
}

export const STUCK_NOTES = {
  failing: '\n\nI stopped because the last actions kept failing in the same way. Tell me how you would like to proceed.',
  repeating: '\n\nI stopped because I kept repeating the same action and getting the same result. Tell me how you would like to proceed.'
};

export const REPEAT_NOTE = '\n(NOTE: you already made this exact call in this reply and got this same result. Nothing has changed, so do not call it again. Continue with the next part of the task, or answer the user now.)';