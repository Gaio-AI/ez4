export const getIndentedOutput = (input: string[]) => {
  return input.map((line) => (line.length ? `  ${line}` : ``));
};

export const getMultilineOutput = (input: string) => {
  // JSON escaping is valid inside a double-quoted YAML string.
  return JSON.stringify(input.replaceAll('\r', '')).slice(1, -1);
};

export const getNameOutput = (input: string) => {
  if (/^[a-zA-Z0-9_-]+$/.test(input)) {
    return input;
  }

  return `'${input}'`;
};
