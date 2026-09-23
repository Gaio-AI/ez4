import { IncompleteTypeError, IncorrectTypeError, InvalidTypeError } from '@ez4/common/library';

export class IncompleteCacheRuleError extends IncompleteTypeError {
  constructor(properties: string[], fileName?: string) {
    super('Incomplete bucket cache rule', properties, fileName);
  }
}

export class InvalidCacheRuleTypeError extends InvalidTypeError {
  constructor(fileName?: string) {
    super('Invalid bucket cache rule type', undefined, 'Bucket.CacheRule', fileName);
  }
}

export class IncorrectCacheRuleTypeError extends IncorrectTypeError {
  constructor(
    public ruleType: string,
    fileName?: string
  ) {
    super('Incorrect bucket cache rule type', ruleType, 'Bucket.CacheRule', fileName);
  }
}
