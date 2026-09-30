import type { AuthHandler, HttpHandler, HttpErrors, HttpPreferences } from '@ez4/gateway/library';
import type { EmulatorRequestEvent, LinkedVariables } from '@ez4/project/library';
import type { ServiceListener } from '@ez4/common/library';
import type { Runtime } from '@ez4/common';

export type RouteData = {
  httpErrors?: HttpErrors | null;
  preferences?: HttpPreferences;
  variables?: LinkedVariables | null;
  authorizer?: AuthHandler | null;
  listener?: ServiceListener | null;
  scope?: Runtime.ScopeHeaders;
  timeout?: number;
  handler: HttpHandler;
};

export type MatchingRoute = RouteData & EmulatorRequestEvent & { parameters?: Record<string, string> };

type RoutePathMatch = {
  parameters: Record<string, string>;
  segments: SegmentType[];
  greedy: boolean;
};

// Ordered by precedence: in the same position, a literal segment wins over a path parameter, and both over a greedy one.
const enum SegmentType {
  Greedy,
  Parameter,
  Literal
}

export const getMatchingRoute = (
  routes: Record<string, Record<string, RouteData>>,
  request: EmulatorRequestEvent
): MatchingRoute | undefined => {
  let bestRoute: RouteData | undefined;
  let bestMatch: RoutePathMatch | undefined;

  // Method routes come before `ANY` ones, so they win when both are as specific.
  for (const method of [request.method, 'ANY']) {
    const methodRoutes = routes[method] ?? {};

    for (const pattern in methodRoutes) {
      const match = matchRoutePath(pattern, request.path);

      if (match && (!bestMatch || isMoreSpecific(match, bestMatch))) {
        bestRoute = methodRoutes[pattern];
        bestMatch = match;
      }
    }
  }

  if (!bestRoute || !bestMatch) {
    return undefined;
  }

  return {
    ...bestRoute,
    ...request,
    parameters: bestMatch.parameters
  };
};

// API Gateway picks the most specific route: a full match before a greedy one, then the first segment that differs.
const isMoreSpecific = (match: RoutePathMatch, current: RoutePathMatch) => {
  if (match.greedy !== current.greedy) {
    return !match.greedy;
  }

  const length = Math.min(match.segments.length, current.segments.length);

  for (let index = 0; index < length; index++) {
    if (match.segments[index] !== current.segments[index]) {
      return match.segments[index] > current.segments[index];
    }
  }

  return false;
};

const matchRoutePath = (pattern: string, path: string): RoutePathMatch | undefined => {
  const patternParts = pattern.split('/').filter((part) => !!part);
  const pathParts = path.split('/').filter((part) => !!part);

  const parameters: Record<string, string> = {};
  const segments: SegmentType[] = [];

  for (let index = 0; index < patternParts.length; index++) {
    const patternPart = patternParts[index];
    const pathPart = pathParts[index];

    if (pathPart === undefined) {
      return undefined;
    }

    if (!patternPart.startsWith('{') || !patternPart.endsWith('}')) {
      if (patternPart !== pathPart) {
        return undefined;
      }

      segments.push(SegmentType.Literal);
      continue;
    }

    const parameterName = patternPart.slice(1, -1);

    // A greedy path parameter (such as `{proxy+}`) ends the route and takes the rest of the path.
    if (parameterName.endsWith('+')) {
      parameters[parameterName.slice(0, -1)] = pathParts.slice(index).join('/');
      segments.push(SegmentType.Greedy);

      return {
        greedy: true,
        parameters,
        segments
      };
    }

    parameters[parameterName] = pathPart;
    segments.push(SegmentType.Parameter);
  }

  if (patternParts.length !== pathParts.length) {
    return undefined;
  }

  return {
    greedy: false,
    parameters,
    segments
  };
};
