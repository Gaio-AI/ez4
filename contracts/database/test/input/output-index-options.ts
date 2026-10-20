import type { Database, Index } from '@ez4/database';
import type { TestEngine } from '../common/engines';

export declare class TestDatabase extends Database.Service<TestEngine> {
  tables: [
    Database.UseTable<{
      name: 'tableA';
      schema: {
        id: string;
        account_id: string;
        status: string;
        created_at: string;
        deleted_at?: string | null;
      };
      indexes: {
        id: Index.Primary;

        // Plain form beside the object form
        status: Index.Secondary;

        'account_id:created_at': {
          type: Index.Secondary;
          name: 'table_a_active_by_account';
          where: { deleted_at: null; status: { isIn: ['open', 'pending'] } };
          include: ['status'];
          order: { created_at: 'desc' };
        };

        account_status: {
          type: Index.Unique;
          columns: ['account_id', 'status'];
          nullsNotDistinct: true;
          method: 'btree';
        };
      };
    }>
  ];
}
