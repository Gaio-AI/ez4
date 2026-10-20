import type { Database, Index } from '@ez4/database';
import type { TestEngine } from '../common/engines';

export declare class TestDatabase extends Database.Service<TestEngine> {
  tables: [
    Database.UseTable<{
      name: 'contacts';
      renamedFrom: {
        columns: {
          // The renamed column has to be in the schema.
          missing: 'name';

          // The previous name can't be a column of the schema.
          full_name: 'id';

          // Only one column can come from each previous name.
          first_name: 'name';
          last_name: 'name';
        };
      };
      schema: {
        id: string;
        full_name: string;
        first_name: string;
        last_name: string;
      };
      indexes: {
        id: Index.Primary;
      };
    }>
  ];
}
