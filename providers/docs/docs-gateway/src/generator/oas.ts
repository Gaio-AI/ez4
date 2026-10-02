import type { HttpService } from '@ez4/gateway/library';

import { isEmptyObject } from '@ez4/utils';

import { getIndentedOutput } from '../utils/format';
import { getServiceRoutesOutput } from './route';
import { getSecurityOutput } from './security';
import { getRequestSchemas } from './request';
import { getResponseSchemas } from './response';
import { getErrorSchemas } from './errors';

export namespace OpenApiGenerator {
  export const getGatewayOutput = (service: HttpService) => {
    const output = [
      '# Auto-generated Open API specification, any manual modifications will be lost during regeneration.',
      'openapi: 3.1.0'
    ];

    output.push(...getInformationOutput(service));
    output.push(...getServiceRoutesOutput(service));

    const components = [...getSecurityOutput(service), ...getSchemasOutput(service)];

    if (components.length) {
      output.push('components:', ...getIndentedOutput(components));
    }

    return output.join('\n');
  };

  const getInformationOutput = (service: HttpService) => {
    return ['info:', ...getIndentedOutput([`title: ${service.displayName ?? service.name}`, 'version: 1.0.0']), ''];
  };

  const getSchemasOutput = (service: HttpService) => {
    const schemas = {
      ...getResponseSchemas(service),
      ...getRequestSchemas(service),
      ...getErrorSchemas(service)
    };

    if (isEmptyObject(schemas)) {
      return [];
    }

    return [
      'schemas:',
      ...getIndentedOutput(Object.entries(schemas).flatMap(([name, lines]) => [`${name}:`, ...getIndentedOutput(lines)])),
      ''
    ];
  };
}
