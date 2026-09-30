import type { EmulatorResponse } from '@ez4/project/library';

export const getDisabledResponse = (): EmulatorResponse => {
  return getDistributionErrorResponse(403, 'The distribution is disabled.');
};

export const getOriginErrorResponse = (): EmulatorResponse => {
  return getDistributionErrorResponse(502, `CloudFront wasn't able to connect to the origin.`);
};

export const getBucketErrorResponse = (status: number, code: string, message: string, objectKey?: string): EmulatorResponse => {
  const keyElement = objectKey !== undefined ? `<Key>${escapeXml(objectKey)}</Key>` : '';

  return {
    status,
    headers: {
      ['content-type']: 'application/xml'
    },
    body: `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${message}</Message>${keyElement}</Error>`
  };
};

const getDistributionErrorResponse = (status: number, message: string): EmulatorResponse => {
  return {
    status,
    headers: {
      ['content-type']: 'text/html'
    },
    body: `<html><head><title>ERROR: The request could not be satisfied</title></head><body><h1>${status} ERROR</h1><h2>The request could not be satisfied.</h2><p>${message}</p></body></html>`
  };
};

const escapeXml = (value: string) => {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
};
