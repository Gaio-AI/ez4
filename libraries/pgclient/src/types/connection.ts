export type ClientConnection = ClientConnectionOptions &
  (
    | {
        database: string;
        /**
         * Password, or a function that gives one for each new connection (e.g. an IAM authentication token).
         */
        password: string | (() => string | Promise<string>);
        user: string;
        host: string;
        port?: number;
        connectionString?: undefined;
      }
    | {
        database: string;
        connectionString: string;
      }
  );

export type ClientConnectionOptions = {
  ssl?: boolean | object;

  /**
   * Maximum number of connections in the pool (default: `2`).
   */
  poolSize?: number;

  /**
   * Milliseconds a connection stays idle in the pool before it's closed (default: `15000`).
   */
  idleTimeout?: number;

  /**
   * Make the connection behave like the Aurora Data API (default: `false`).
   */
  dataApi?: boolean | ClientDataApiOptions;
};

export type ClientDataApiOptions = {
  /**
   * Statement timeout in milliseconds, `0` disables it (default: `45000`).
   */
  statementTimeout?: number;
};
