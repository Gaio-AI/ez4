import type { DynamoDbEngine } from '@ez4/aws-dynamodb/client';
import type { Database, Client, Index } from '@ez4/database';

declare class RecordSchema implements Database.Schema {
  id: string;
}

export declare class RecoveryDb extends Database.Service<DynamoDbEngine> {
  client: Client<typeof this>;

  options: {
    pointInTimeRecovery: true;
  };

  tables: [
    Database.UseTable<{
      name: 'records';
      schema: RecordSchema;
      indexes: {
        id: Index.Primary;
      };
    }>
  ];
}

export declare class PlainDb extends Database.Service<DynamoDbEngine> {
  client: Client<typeof this>;

  tables: [
    Database.UseTable<{
      name: 'records';
      schema: RecordSchema;
      indexes: {
        id: Index.Primary;
      };
    }>
  ];
}
