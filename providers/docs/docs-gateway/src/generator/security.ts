import type { AuthHandler, HttpService } from '@ez4/gateway/library';

import { getIndentedOutput, getNameOutput } from '../utils/format';
import { isEmptyObject } from '@ez4/utils';

export const getSecurityOutput = (service: HttpService) => {
  const output: Record<string, string[]> = {};

  for (const route of service.routes) {
    const { authorizer } = route;

    if (authorizer) {
      Object.assign(output, getSecuritySchemes(authorizer));
    }
  }

  if (isEmptyObject(output)) {
    return [];
  }

  return [
    'securitySchemes:',
    ...getIndentedOutput(Object.entries(output).flatMap(([name, lines]) => [`${getNameOutput(name)}:`, ...getIndentedOutput(lines)])),
    ''
  ];
};

export const getSecuritySchemes = (authorizer: AuthHandler): Record<string, string[]> => {
  const { name, request } = authorizer;

  const schemes: [string, string, string[]][] = [];

  if (request?.headers) {
    for (const headerKey in request.headers.properties) {
      if (headerKey.toLowerCase() !== 'authorization') {
        schemes.push(['header', headerKey, [`type: apiKey`, 'in: header', `name: ${getNameOutput(headerKey)}`]]);
      } else {
        schemes.push(['header', headerKey, [`type: http`, 'scheme: bearer']]);
      }
    }
  }

  if (request?.query) {
    for (const queryKey in request.query.properties) {
      schemes.push(['query', queryKey, [`type: apiKey`, 'in: query', `name: ${getNameOutput(queryKey)}`]]);
    }
  }

  if (schemes.length === 1) {
    const [[, , lines]] = schemes;

    return {
      [name]: lines
    };
  }

  // Each key is a scheme of its own, the gateway requires all of them.
  return Object.fromEntries(schemes.map(([target, key, lines]) => [`${name}.${target}.${getSchemeName(key)}`, lines]));
};

const getSchemeName = (key: string) => {
  return key.replaceAll(/[^a-zA-Z0-9._-]/g, '_');
};
