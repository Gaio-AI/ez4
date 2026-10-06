import type { ModelProperty, ReflectionTypes, TypeModel } from '@ez4/reflection';

import { isModelProperty, isTypeModel } from '@ez4/reflection';

/**
 * Own and inherited properties of a class or interface, own ones winning. A heritage clause with
 * type arguments carries its members already; one without them only names the base, which is then
 * read from the reflection (and its own heritage, recursively).
 */
export const getModelProperties = (type: TypeModel, reflection: ReflectionTypes, visited = new Set<TypeModel>()) => {
  const membersMap = new Map<string, ModelProperty>();

  visited.add(type);

  type.heritage?.forEach((heritage) => {
    const base = reflection[heritage.path];

    const inherited = heritage.members
      ? heritage.members.filter(isModelProperty)
      : base && isTypeModel(base) && !visited.has(base)
        ? getModelProperties(base, reflection, visited)
        : [];

    inherited.forEach((member) => membersMap.set(member.name, member));
  });

  type.members?.forEach((member) => {
    if (isModelProperty(member)) {
      membersMap.set(member.name, member);
    }
  });

  return [...membersMap.values()];
};
