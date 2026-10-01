import type { LogColor } from '../types/color';

const Reset = '\x1b[0m';
const Bold = '\x1b[1m';

export namespace LogFormat {
  export const toBold = (text: string) => {
    return hasColors() ? Bold + text + Reset : text;
  };

  export const toColor = (color: LogColor, text: string) => {
    return hasColors() ? color + text + Reset : text;
  };
}

// Colors only a terminal, so piped output (a log file, a plan to compare) is plain text, unless
// FORCE_COLOR or NO_COLOR says otherwise.
const hasColors = () => {
  const { FORCE_COLOR, NO_COLOR } = process.env;

  if (FORCE_COLOR) {
    return FORCE_COLOR !== '0' && FORCE_COLOR !== 'false';
  }

  if (NO_COLOR) {
    return false;
  }

  return process.stdout.isTTY === true;
};
