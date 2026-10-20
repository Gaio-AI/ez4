import type { Database } from '@ez4/database';
import type { TestEngine } from '../common/engines';

export declare class TestDatabase extends Database.Service<TestEngine> {
  tables: [
    Database.UseTable<{
      name: 'testTable';
      relations: {
        // Only the listed delete actions are allowed.
        'foo_id@foo': {
          source: 'testTable:id';
          onDelete: 'nullify';
        };
      };
      indexes: {};
      schema: {
        id: string;
        foo_id: string;
      };
    }>
  ];
}
