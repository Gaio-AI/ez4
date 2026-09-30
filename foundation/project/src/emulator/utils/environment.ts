import type { LinkedVariables } from '@ez4/project/library';

import { AsyncLocalStorage } from 'node:async_hooks';

import { Logger } from '@ez4/logger';

export type VariablesOptions = {
  strict?: boolean;
  allowed?: string[];
};

type VariablesScope = {
  variables: LinkedVariables;
};

// Every Lambda gets these from its runtime, whatever its function declares.
const RUNTIME_VARIABLES = [/^AWS_/, /^LAMBDA_/, /^_HANDLER$/, /^NODE_/, /^TZ$/, /^LANG$/, /^LC_/, /^PATH$/, /^HOME$/, /^TMPDIR$/, /^PWD$/];

const variablesScope = new AsyncLocalStorage<VariablesScope>();

const settings = {
  strict: false,
  allowed: new Set<string>()
};

const warnedVariables = new Set<string>();

let isWatching = false;

/**
 * Set how invocations read variables: in strict mode an invocation sees only the variables it declares, the
 * runtime ones and the allowed ones, as a Lambda does.
 */
export const configureVariables = (options: VariablesOptions) => {
  settings.strict = !!options.strict;
  settings.allowed = new Set(options.allowed);

  watchProcessVariables();
};

/**
 * Run the callback in a scope where `process.env` shows the given variables on top of the ones the callback
 * inherits, without changing what concurrent invocations see.
 */
export const runWithVariables = <T>(variables: LinkedVariables, callback: () => Promise<T> | T) => {
  watchProcessVariables();

  const parentScope = variablesScope.getStore();

  // A service invoked inside another one runs in the same process on AWS, so it sees the outer variables too.
  const scope = {
    variables: {
      ...parentScope?.variables,
      ...getDefinedVariables(variables)
    }
  };

  return variablesScope.run(scope, callback);
};

const getDefinedVariables = (variables: LinkedVariables) => {
  const definedVariables: LinkedVariables = {};

  for (const variableName in variables) {
    const variableValue = variables[variableName];

    if (variableValue) {
      definedVariables[variableName] = variableValue;
    }
  }

  return definedVariables;
};

const isVisibleVariable = (variableName: string) => {
  if (!settings.strict) {
    return true;
  }

  return settings.allowed.has(variableName) || RUNTIME_VARIABLES.some((pattern) => pattern.test(variableName));
};

const reportHiddenVariable = (variableName: string) => {
  if (!warnedVariables.has(variableName)) {
    warnedVariables.add(variableName);

    Logger.warn(`Variable ${variableName} isn't declared for the handler reading it, so its Lambda wouldn't have it.`);
  }
};

// Handlers keep reading `process.env`: a proxy answers each read from the scope of the invocation making it.
const watchProcessVariables = () => {
  if (isWatching) {
    return;
  }

  const target = process.env;

  isWatching = true;

  process.env = new Proxy(target, {
    set: (_target, property, value) => {
      const scope = variablesScope.getStore();

      if (scope && typeof property === 'string' && property in scope.variables) {
        scope.variables[property] = `${value}`;
        return true;
      }

      return Reflect.set(target, property, value);
    },

    deleteProperty: (_target, property) => {
      const scope = variablesScope.getStore();

      if (scope && typeof property === 'string' && property in scope.variables) {
        delete scope.variables[property];
        return true;
      }

      return Reflect.deleteProperty(target, property);
    },

    get: (_target, property) => {
      const scope = variablesScope.getStore();

      if (!scope || typeof property !== 'string') {
        return Reflect.get(target, property);
      }

      if (property in scope.variables) {
        return scope.variables[property];
      }

      if (!isVisibleVariable(property)) {
        if (property in target) {
          reportHiddenVariable(property);
        }

        return undefined;
      }

      return Reflect.get(target, property);
    },

    has: (_target, property) => {
      const scope = variablesScope.getStore();

      if (!scope || typeof property !== 'string') {
        return Reflect.has(target, property);
      }

      return property in scope.variables || (isVisibleVariable(property) && Reflect.has(target, property));
    },

    ownKeys: () => {
      const scope = variablesScope.getStore();

      if (!scope) {
        return Reflect.ownKeys(target);
      }

      const visibleKeys = Reflect.ownKeys(target).filter((key) => typeof key !== 'string' || isVisibleVariable(key));

      return [...new Set([...visibleKeys, ...Object.keys(scope.variables)])];
    },

    getOwnPropertyDescriptor: (_target, property) => {
      const scope = variablesScope.getStore();

      if (!scope || typeof property !== 'string') {
        return Reflect.getOwnPropertyDescriptor(target, property);
      }

      if (property in scope.variables) {
        return {
          value: scope.variables[property],
          configurable: true,
          enumerable: true,
          writable: true
        };
      }

      if (!isVisibleVariable(property)) {
        return undefined;
      }

      return Reflect.getOwnPropertyDescriptor(target, property);
    }
  });
};
