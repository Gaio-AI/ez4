import type { Database, Index } from '@ez4/database';
import type { TestEngine } from '../common/engines';

export declare class TestDatabase extends Database.Service<TestEngine> {
  tables: [
    Database.UseTable<{
      name: 'testTable';
      indexes: {
        // Only the listed index methods are allowed.
        value: {
          type: Index.Secondary;
          method: 'bloom';
        };
      };
      schema: {
        value: string;
      };
    }>
  ];
}
