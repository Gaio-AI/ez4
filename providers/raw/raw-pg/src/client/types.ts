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

/**
 * Default Postgres engine settings for raw-pg.
 *
 * Targets any Postgres-compatible server reachable via TCP (Supabase, Neon, RDS direct, etc.).
 * Connection is supplied at runtime via `localOptions.<service>.connectionString` (dev/emulator)
 * or env var (prod).
 */
export type PostgresEngine = {
  parametersMode: ParametersMode.NameAndIndex;
  transactionMode: TransactionMode.Interactive;
  insensitiveMode: InsensitiveMode.Enabled;
  undefinedMode: UndefinedMode.Unsupported;
  paginationMode: PaginationMode.Offset;
  relationMode: RelationMode.Supported;
  orderMode: OrderMode.AnyColumns;
  streamMode: StreamMode.Unsupported;
  lockMode: LockMode.Supported;
  aggregateMode: AggregateMode.Supported;
  options: ServiceOptions;
  name: 'raw-pg';
};

/**
 * Database service options.
 */
export type ServiceOptions = {
  /**
   * Whether the deploy migrates the tables (default `true`). Off, it leaves tables, indexes and
   * constraints to migrations run outside of it, and never drops the database.
   */
  migration?: boolean;
};
