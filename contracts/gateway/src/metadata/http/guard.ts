import type { AllType, ReflectionTypes } from '@ez4/reflection';
import type { HttpAllow, HttpRoute, HttpService } from './types';

import { getFunctionSignature, getObjectMembers, getTupleElements, tryGetReferenceType } from '@ez4/common/library';
import { deepEqual, isAnyObject } from '@ez4/utils';

import {
  isModelProperty,
  isTypeBoolean,
  isTypeCallback,
  isTypeFunction,
  isTypeNumber,
  isTypeObject,
  isTypeReference,
  isTypeString,
  isTypeTuple
} from '@ez4/reflection';

import {
  ConflictingRouteAllowError,
  IncompleteGuardError,
  MissingRouteAllowError,
  UnguardedRouteAllowError
} from '../../errors/http/guard';

export const getHttpGuardMetadata = (type: AllType, errorList: Error[]) => {
  if (!isTypeCallback(type) && !isTypeFunction(type)) {
    return undefined;
  }

  const guard = getFunctionSignature(type);

  if (!guard) {
    errorList.push(new IncompleteGuardError(type.file));
  }

  return guard;
};

/**
 * The value a route's `allow` declares, or undefined when any part of it isn't a literal.
 */
export const getHttpAllowMetadata = (type: AllType, reflection: ReflectionTypes): HttpAllow | undefined => {
  if (isTypeReference(type)) {
    const declaration = tryGetReferenceType(type, reflection);

    return declaration && getHttpAllowMetadata(declaration, reflection);
  }

  if (isTypeString(type) || isTypeNumber(type) || isTypeBoolean(type)) {
    return type.literal;
  }

  if (isTypeTuple(type)) {
    const elements = getTupleElements(type).map((element) => getHttpAllowMetadata(element, reflection));

    return elements.every((element) => element !== undefined) ? elements : undefined;
  }

  if (isTypeObject(type)) {
    const members: Record<string, HttpAllow> = {};

    for (const member of getObjectMembers(type)) {
      const value = isModelProperty(member) ? getHttpAllowMetadata(member.value, reflection) : undefined;

      if (value === undefined) {
        return undefined;
      }

      members[member.name] = value;
    }

    return members;
  }

  return undefined;
};

/**
 * A service guard must cover every route, so a route without `allow` fails the build instead of going unguarded,
 * and an `allow` with no guard to enforce it would read as protection the route doesn't have.
 */
export const checkHttpRouteGuards = (service: HttpService, errorList: Error[]) => {
  const { file: fileName, defaults, routes } = service;

  const isGuarded = !!defaults?.guard;

  // Routes outside a group that share a handler share its function, built from the first one.
  const handlerRoutes = new Map<string, HttpRoute>();

  for (const route of routes) {
    if (isGuarded && route.allow === undefined) {
      errorList.push(new MissingRouteAllowError(route.path, fileName));
    }

    if (!isGuarded && route.allow !== undefined) {
      errorList.push(new UnguardedRouteAllowError(route.path, fileName));
    }

    if (route.group) {
      continue;
    }

    const { name: handlerName } = route.handler;

    const firstRoute = handlerRoutes.get(handlerName);

    if (!firstRoute) {
      handlerRoutes.set(handlerName, route);
      continue;
    }

    if (!isSameAllow(firstRoute.allow, route.allow)) {
      errorList.push(new ConflictingRouteAllowError(handlerName, [firstRoute.path, route.path], fileName));
    }
  }
};

const isSameAllow = (allow: HttpAllow | undefined, otherAllow: HttpAllow | undefined) => {
  if ((isAnyObject(allow) || Array.isArray(allow)) && (isAnyObject(otherAllow) || Array.isArray(otherAllow))) {
    return deepEqual(allow, otherAllow);
  }

  return allow === otherAllow;
};
