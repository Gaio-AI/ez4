import { ok, equal } from 'assert/strict';
import { describe, it } from 'node:test';

import {
  registerTriggers,
  ConflictingGroupVariableError,
  GroupNameCollisionError,
  IncorrectGroupTypeError,
  InvalidGroupNameError,
  InvalidRouteGroupError,
  UnusedGroupError
} from '@ez4/gateway/library';

import { InvalidServicePropertyError } from '@ez4/common/library';

import { parseFile } from './common/parser';

describe('http route group metadata errors', () => {
  registerTriggers();

  it('assert :: route setting apart from its group', () => {
    const errors = parseFile('invalid-group-setting', 4);

    const settings = errors.map((error) => {
      ok(error instanceof InvalidRouteGroupError);
      equal(error.groupName, 'tags');

      return `${error.routePath} ${error.propertyName}`;
    });

    equal(settings.sort().join(', '), 'DELETE /tags timeout, GET /tags memory, POST /tags logLevel, PUT /tags listener');
  });

  it('assert :: group variable with two values', () => {
    const [error1] = parseFile('invalid-group-variables', 1);

    ok(error1 instanceof ConflictingGroupVariableError);
    equal(error1.groupName, 'tags');
    equal(error1.variableName, 'TAGS_TABLE');
  });

  it('assert :: group function name too long', () => {
    const [error1] = parseFile('invalid-group-name', 1);

    ok(error1 instanceof InvalidGroupNameError);
    equal(error1.functionName, 'group-a-group-name-long-enough-to-push-the-function-name-past-the-limit');
  });

  it('assert :: group function name taken', () => {
    const [error1, error2] = parseFile('collided-group', 2);

    ok(error1 instanceof GroupNameCollisionError);
    equal(error1.groupName, 'tags');
    equal(error1.functionName, 'group-tags');

    ok(error2 instanceof GroupNameCollisionError);
    equal(error2.groupName, 'help-center');
    equal(error2.functionName, 'group-help-center');
  });

  it('assert :: group settings without routes', () => {
    const [error1] = parseFile('unused-group', 1);

    ok(error1 instanceof UnusedGroupError);
    equal(error1.groupName, 'chats');
  });

  it('assert :: invalid group type', () => {
    const [error1, error2] = parseFile('invalid-group-type', 2);

    ok(error1 instanceof IncorrectGroupTypeError);
    equal(error1.groupType, 'ChatGroup');

    ok(error2 instanceof InvalidServicePropertyError);
    equal(error2.propertyName, 'invalid_property');
  });
});
