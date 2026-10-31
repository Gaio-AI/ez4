import type { Database, Index, TimestampsMode } from '@ez4/database';
import type { String } from '@ez4/schema';
import type { TestEngineTimestamps } from '../common/engines';

export declare class TestDatabase extends Database.Service<TestEngineTimestamps<TimestampsMode.Supported>> {
  // @ts-expect-error The timestamps take only created and updated.
  tables: [
    // The column has to be in the schema.
    Database.UseTable<{
      name: 'missing';
      timestamps: {
        updated: 'updated_at';
      };
      schema: {
        id: string;
      };
      indexes: {
        id: Index.Primary;
      };
    }>,
    // The column has to be a date-time.
    Database.UseTable<{
      name: 'format';
      timestamps: {
        created: 'created_at';
      };
      schema: {
        id: string;
        created_at: String.Date;
      };
      indexes: {
        id: Index.Primary;
      };
    }>,
    // The column can't be optional.
    Database.UseTable<{
      name: 'optional';
      timestamps: {
        updated: 'updated_at';
      };
      schema: {
        id: string;
        updated_at?: String.DateTime;
      };
      indexes: {
        id: Index.Primary;
      };
    }>,
    // The column can't take null.
    Database.UseTable<{
      name: 'nullable';
      timestamps: {
        updated: 'updated_at';
      };
      schema: {
        id: string;
        updated_at: String.DateTime | null;
      };
      indexes: {
        id: Index.Primary;
      };
    }>,
    // The column can't be the primary key.
    Database.UseTable<{
      name: 'primary';
      timestamps: {
        created: 'created_at';
      };
      schema: {
        created_at: String.DateTime;
      };
      indexes: {
        created_at: Index.Primary;
      };
    }>,
    // The column can't be renamed while the table has timestamps.
    Database.UseTable<{
      name: 'renamed';
      renamedFrom: {
        columns: {
          updated_at: 'modified_at';
        };
      };
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
    }>,
    // One column can't be both timestamps.
    Database.UseTable<{
      name: 'same';
      timestamps: {
        created: 'stamped_at';
        updated: 'stamped_at';
      };
      schema: {
        id: string;
        stamped_at: String.DateTime;
      };
      indexes: {
        id: Index.Primary;
      };
    }>,
    // Only the creation and update timestamps are written by the database.
    // @ts-expect-error The timestamps take only created and updated.
    Database.UseTable<{
      name: 'option';
      timestamps: {
        deleted: 'deleted_at';
      };
      schema: {
        id: string;
        deleted_at: String.DateTime;
      };
      indexes: {
        id: Index.Primary;
      };
    }>
  ];
}
