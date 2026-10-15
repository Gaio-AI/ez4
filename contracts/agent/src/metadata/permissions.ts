import type { ModelProperty, TypeClass } from '@ez4/reflection';
import { isModelProperty, isTypeObject, isTypeTuple } from '@ez4/reflection';
import { getPropertyStringIn, getPropertyStringList } from '@ez4/common/library';
import type { Agent } from '../services/contract';
import type { AgentService } from './types';
import { UnknownPresetError } from '../errors/permissions';
import { IncompleteServiceError } from '../errors/service';

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

  if (permMap.statements) {
    const value = permMap.statements.value;
    const statements: Agent.Statement[] = [];
    let valid = false;
    if (isTypeTuple(value)) {
      valid = true;
      for (const element of value.elements) {
        if (!isTypeObject(element) || !Array.isArray(element.members) || !element.members.every(isModelProperty)) {
          valid = false;
          break;
        }
        const fields = Object.fromEntries(element.members.map((field) => [field.name, field]));
        const actions = fields.actions && getPropertyStringList(fields.actions);
        const resources = fields.resources && getPropertyStringList(fields.resources);
        const effect = fields.effect && getPropertyStringIn(fields.effect, ['allow', 'deny']);
        if (
          !actions ||
          !resources ||
          (fields.effect && !effect) ||
          !isTypeTuple(fields.actions.value) ||
          !isTypeTuple(fields.resources.value) ||
          actions.length !== fields.actions.value.elements.length ||
          resources.length !== fields.resources.value.elements.length
        ) {
          valid = false;
          break;
        }
        statements.push({ ...(effect && { effect }), actions, resources });
      }
    }
    if (!valid) {
      errorList.push(new IncompleteServiceError([`${declaration.name}.permissions.statements`], declaration.file));
    } else {
      service.permissions = { ...service.permissions, statements };
    }
  }
};
