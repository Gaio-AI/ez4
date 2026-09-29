import type { Node, NodeArray, Type, TypeChecker } from 'typescript';
import type { ResolverEvents, ResolverOptions } from '../resolver';
import type { AllType, EveryType } from '../types';

export type Context = {
  events: ResolverEvents;
  options: ResolverOptions;
  checker: TypeChecker;
  pending: Set<Node>;
  cache: WeakMap<Node | NodeArray<Node>, AllType>;
};

export type TypeMap = {
  [name: string]: EveryType | undefined;
};

export type TypeState = {
  types: TypeMap;
};

export type ArrayState = {
  spread?: boolean;
};

export type InstanceState = {
  instance?: {
    node: Node;
    type: Type;
  };
};

export type State = TypeState & ArrayState & InstanceState;

export const getNewState = (partial?: Partial<State>): State => {
  return {
    types: {},
    ...partial
  };
};
