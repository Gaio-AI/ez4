import type {
  ParametersMode,
  TransactionMode,
  InsensitiveMode,
  UndefinedMode,
  PaginationMode,
  RelationMode,
  OrderMode,
  StreamMode,
  LockMode
} from '@ez4/database';

/**
 * Postgres connection mode.
 */
export const enum ConnectionMode {
  Native = 'native',
  Api = 'api'
}

/**
 * Service client options.
 */
export type ClientOptions = {
  connectionMode?: ConnectionMode;

  /**
   * Database user of a native connection, authenticated with IAM: the role must be granted `rds_iam`, and
   * the deploy turns IAM database authentication on in the cluster. Without it, a native connection signs
   * in with the cluster's master secret.
   */
  user?: string;
};

/**
 * Default Postgres engine settings.
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
  options: ClientOptions;
  name: 'aurora';
};
