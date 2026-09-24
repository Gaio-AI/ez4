import type { ModelProperty } from '@ez4/reflection';

import { getObjectMembers, getPropertyObject, getPropertyString } from '@ez4/common/library';
import { isModelProperty } from '@ez4/reflection';

import { InvalidScopeHeaderError } from '../errors/scope';

export const getWebScopeMetadata = (member: ModelProperty, errorList: Error[]) => {
  const object = getPropertyObject(member);

  if (!object) {
    return undefined;
  }

  const scope: Record<string, string> = {};

  for (const scopeMember of getObjectMembers(object)) {
    if (!isModelProperty(scopeMember)) {
      continue;
    }

    const header = getPropertyString(scopeMember);

    if (header) {
      scope[scopeMember.name] = header;
    } else {
      errorList.push(new InvalidScopeHeaderError(scopeMember.name, object.file));
    }
  }

  return scope;
};
