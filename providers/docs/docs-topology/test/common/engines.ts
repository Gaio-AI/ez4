import type {
  ParametersMode,
  TransactionMode,
  InsensitiveMode,
  UndefinedMode,
  PaginationMode,
  RelationMode,
  OrderMode,
  StreamMode,
  LockMode,
  AggregateMode
} from '@ez4/database';

export type TestEngine = {
  parametersMode: ParametersMode.OnlyIndex;
  transactionMode: TransactionMode.Static;
  insensitiveMode: InsensitiveMode.Unsupported;
  undefinedMode: UndefinedMode.Unsupported;
  paginationMode: PaginationMode.Offset;
  relationMode: RelationMode.Supported;
  streamMode: StreamMode.Unsupported;
  orderMode: OrderMode.AnyColumns;
  lockMode: LockMode.Unsupported;
  aggregateMode: AggregateMode.Unsupported;
  options: never;
  name: 'test';
};
