export type ClientConnection = ClientConnectionOptions &
  (
    | {
        database: string;
        password: string;
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
