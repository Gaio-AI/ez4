import type { Database, Index, TimestampsMode } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { TestEngineTimestamps } from '../common/engines';

export declare class TestDatabase extends Database.Service<TestEngineTimestamps<TimestampsMode.Supported>> {
  tables: [
    Database.UseTable<{
      name: 'contacts';
      timestamps: {
        created: 'created_at';
        updated: 'updated_at';
      };
      schema: {
        id: string;
        created_at: String.DateTime;
        updated_at: String.DateTime;
      };
      indexes: {
        id: Index.Primary;
      };
    }>,
    Database.UseTable<{
      name: 'events';
      timestamps: {
        created: 'created_at';
      };
      schema: {
        id: string;
        created_at: String.DateTime;
      };
      indexes: {
        id: Index.Primary;
      };
    }>
  ];
}
