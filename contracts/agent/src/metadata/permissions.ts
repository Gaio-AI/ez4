import type { ModelProperty, TypeClass } from '@ez4/reflection';
import { isTypeObject } from '@ez4/reflection';
import { getPropertyStringList } from '@ez4/common/library';
import type { Agent } from '../services/contract';
import type { AgentService } from './types';
import { UnknownPresetError } from '../errors/permissions';

const VALID_PRESETS: Record<string, true> = {
  'logs-read': true,
  'lambda-read': true,
  'ecs-read': true,
  'cloudformation-read': true
};

export const validatePermissions = (
  members: Record<string, ModelProperty>,
  declaration: TypeClass,
  service: AgentService,
  errorList: Error[]
) => {
  const member = members.permissions;
  if (!member || !isTypeObject(member.value)) {
    return;
  }

  const permMembers = member.value.members;
  if (!Array.isArray(permMembers)) {
    return;
  }

  const permMap: Record<string, ModelProperty> = {};
  for (const m of permMembers) {
    if (m && typeof m === 'object' && 'name' in m && typeof m.name === 'string') {
      permMap[m.name] = m as ModelProperty;
    }
  }

  const presets = permMap.presets ? getPropertyStringList(permMap.presets) : undefined;
  if (presets) {
    for (const preset of presets) {
      if (!VALID_PRESETS[preset]) {
        errorList.push(new UnknownPresetError(preset, declaration.file));
      }
    }
    service.permissions = {
      ...service.permissions,
      presets: presets as Agent.Preset[]
    };
  }
};
