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
        'contact_id@contact': {
          source: 'contacts:id';
          scope: ['account_id'];
        };
      };
      indexes: {
        id: Index.Primary;
        contact_id: Index.Secondary;
      };
    }>,
    Database.UseTable<{
      name: 'contacts';
      schema: {
        id: string;
        account_id: string;
      };
      indexes: {
        id: Index.Primary;
        'account_id:id': Index.Unique;
      };
    }>
  ];
}
