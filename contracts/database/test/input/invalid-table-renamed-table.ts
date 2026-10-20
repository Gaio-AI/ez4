import type { Database, Index } from '@ez4/database';
import type { TestEngine } from '../common/engines';

export declare class TestDatabase extends Database.Service<TestEngine> {
  tables: [
    Database.UseTable<{
      name: 'contacts';
      renamedFrom: {
        // The previous name can't be a table of the database.
        table: 'people';
      };
      schema: {
        id: string;
      };
      indexes: {
        id: Index.Primary;
      };
    }>,
    Database.UseTable<{
      name: 'people';
      schema: {
        id: string;
      };
      indexes: {
        id: Index.Primary;
      };
    }>
  ];
}
