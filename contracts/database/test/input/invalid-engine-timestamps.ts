import type { Database, Index } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { TestEngine } from '../common/engines';

// An engine without timestamps doesn't write them for any table.
export declare class TestDatabase extends Database.Service<TestEngine> {
  // @ts-expect-error An engine without timestamps doesn't take them.
  tables: [
    Database.UseTable<{
      name: 'contacts';
      timestamps: {
        updated: 'updated_at';
      };
      schema: {
        id: string;
        updated_at: String.DateTime;
      };
      indexes: {
        id: Index.Primary;
      };
    }>
  ];
}
