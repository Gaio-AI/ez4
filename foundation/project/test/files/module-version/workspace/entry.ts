import { source } from '@fixture/source';
import { built } from '@fixture/built';

export const check = () => {
  return `${source} ${built}`;
};
