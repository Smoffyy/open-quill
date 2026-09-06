const REPEAT_LIMIT = 2;

export function createLoopGuard({ repeatLimit = REPEAT_LIMIT } = {}) {
  let prevSig = '';
  let prevShape = '';
  let repeats = 0;

  return {
    note({ calls = [], ok = 0, failed = 0, failKinds = [] } = {}) {
      const sig = calls.map(c => c.name + ':' + (c.argsText || '')).join('|');
      const barren = ok === 0 && failed > 0;
      const shape = barren ? [...failKinds].sort().join(',') : '';
      repeats = shape && shape === prevShape ? repeats + 1 : 0;
      const stuck = (barren && sig === prevSig) || repeats >= repeatLimit;
      prevSig = sig;
      prevShape = shape;
      return stuck;
    }
  };
}

export const STUCK_NOTE = '\n\nI stopped because the last actions kept failing in the same way. Tell me how you would like to proceed.';
