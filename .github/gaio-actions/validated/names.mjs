export const DEFAULT_LEG_NAME = '{task} {package} {shard}';

export const DEFAULT_NAMES = {
  changeset: 'Changeset status',
  lint: 'Lint',
  setup: 'Set up',
  services: 'Start services',
  env: 'Export env',
  prepare: 'Prepare',
  run: 'Run',
  check: 'Check'
};

const LEG_VARS = ['task', 'package', 'shard'];

export function legLabel(template, vars) {
  for (const [, name] of template.matchAll(/\{([^}]*)\}/g)) {
    if (!LEG_VARS.includes(name)) throw new Error(`leg-name: unknown variable {${name}}`);
  }
  const label = template.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '').replace(/\s+/g, ' ').trim();
  if (label === '') throw new Error('leg-name: renders an empty name');
  return label;
}

export function resolveNames(configured = {}) {
  for (const [key, value] of Object.entries(configured)) {
    if (!(key in DEFAULT_NAMES)) throw new Error(`names.${key}: unknown stage; expected one of ${Object.keys(DEFAULT_NAMES).join(', ')}`);
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`names.${key}: must be a non-empty string`);
  }
  return { ...DEFAULT_NAMES, ...configured };
}

export function resolveNaming(config) {
  const legName = config['leg-name'] ?? DEFAULT_LEG_NAME;
  legLabel(legName, { task: 'task', package: 'package', shard: 'shard' });
  return { names: resolveNames(config.names), legName };
}
