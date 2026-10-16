import type { ModelProperty, TypeClass } from '@ez4/reflection';
import { isTypeObject } from '@ez4/reflection';
import { getPropertyNumber } from '@ez4/common/library';
import type { Agent } from '../services/contract';
import type { AgentService } from './types';
import { InvalidCpuMemoryCombinationError, InvalidResourceBoundsError } from '../errors/resources';

const VALID_FARGATE_CPU_MEMORY: Record<number, number[]> = {
  256: [512, 1024, 2048],
  512: [1024, 2048, 3072, 4096],
  1024: [2048, 3072, 4096, 5120, 6144, 7168, 8192],
  2048: [4096, 5120, 6144, 7168, 8192, 9216, 10240, 11264, 12288, 13312, 14336, 15360, 16384],
  4096: [8192, 10240, 12288, 14336, 16384, 18432, 20480, 22528, 24576, 26624, 28672, 30720],
  8192: [16384, 20480, 24576, 28672, 32768, 36864, 40960, 45056, 49152, 53248, 57344, 61440],
  16384: [32768, 40960, 49152, 57344, 65536, 73728, 81920, 90112, 98304, 106496, 114688, 122880]
};

export const validateResources = (
  members: Record<string, ModelProperty>,
  declaration: TypeClass,
  service: AgentService,
  errorList: Error[]
) => {
  const member = members.resources;
  if (!member || !isTypeObject(member.value)) {
    return;
  }

  const resMembers = member.value.members;
  if (!Array.isArray(resMembers)) {
    return;
  }

  const resMap: Record<string, ModelProperty> = {};
  for (const m of resMembers) {
    if (m && typeof m === 'object' && 'name' in m && typeof m.name === 'string') {
      resMap[m.name] = m as ModelProperty;
    }
  }

  const cpu = (resMap.cpu && getPropertyNumber(resMap.cpu)) ?? 1024;
  const memory = (resMap.memory && getPropertyNumber(resMap.memory)) ?? 2048;
  const storage = (resMap.storage && getPropertyNumber(resMap.storage)) ?? 21;
  const timeout = (resMap.timeout && getPropertyNumber(resMap.timeout)) ?? 3600;

  const validMemories = VALID_FARGATE_CPU_MEMORY[cpu];
  if (!validMemories || !validMemories.includes(memory)) {
    errorList.push(new InvalidCpuMemoryCombinationError(cpu, memory, declaration.file));
  }

  if (storage < 21 || storage > 200) {
    errorList.push(new InvalidResourceBoundsError('storage', storage, [21, 200], declaration.file));
  }

  if (timeout < 60 || timeout > 86400) {
    errorList.push(new InvalidResourceBoundsError('timeout', timeout, [60, 86400], declaration.file));
  }

  service.resources = {
    cpu: cpu as Agent.Resources['cpu'],
    memory,
    storage,
    timeout
  };
};
