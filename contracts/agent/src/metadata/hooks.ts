import type { AllType, ModelProperty, ReflectionTypes, TypeClass } from '@ez4/reflection';
import { isTypeCallback, isTypeFunction, isTypeReference } from '@ez4/reflection';
import { getFunctionSignature, getReferenceType } from '@ez4/common/library';
import type { AgentService } from './types';

export const parseAgentHooks = (
  members: Record<string, ModelProperty>,
  _declaration: TypeClass,
  service: AgentService,
  reflection: ReflectionTypes,
  _errorList: Error[]
) => {
  if (members.prepare) {
    const prepare = resolveHookSignature(members.prepare.value, reflection);
    if (prepare) {
      service.prepare = prepare;
    }
  }
  if (members.finish) {
    const finish = resolveHookSignature(members.finish.value, reflection);
    if (finish) {
      service.finish = finish;
    }
  }
};

const resolveHookSignature = (type: AllType, reflection: ReflectionTypes) => {
  let target: AllType | undefined = type;
  if (isTypeReference(target)) {
    target = getReferenceType(target, reflection);
  }
  if (target && (isTypeFunction(target) || isTypeCallback(target))) {
    return getFunctionSignature(target);
  }
  return undefined;
};
