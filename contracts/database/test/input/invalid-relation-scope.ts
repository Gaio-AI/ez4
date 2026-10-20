import type { Database, Index } from '@ez4/database';
import type { TestEngine } from '../common/engines';

export declare class TestDatabase extends Database.Service<TestEngine> {
  tables: [
    Database.UseTable<{
      name: 'messages';
      schema: {
        id: string;
        account_id: string;
        contact_id: string;
      };
      relations: {
        // The scope column has to be in both tables.
        'contact_id@contact': {
          source: 'contacts:id';
          scope: ['account_id'];
        };
      };
      indexes: {
        id: Index.Primary;
      };
    }>,
    Database.UseTable<{
      name: 'contacts';
      schema: {
        id: string;
      };
      indexes: {
        id: Index.Primary;
      };
    }>
  ];
}
