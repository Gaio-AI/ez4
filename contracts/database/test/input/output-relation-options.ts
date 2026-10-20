import type { Database, Index } from '@ez4/database';
import type { TestEngine } from '../common/engines';

export declare class TestDatabase extends Database.Service<TestEngine> {
  tables: [
    Database.UseTable<{
      name: 'tableA';
      schema: {
        id_a: string;
        id_b: string;
        id_c?: string | null;
      };
      relations: {
        // Source alone, as the string form
        'id_b@relation_b': {
          source: 'tableB:id_b';
        };

        // Every option
        'id_c@relation_c': {
          source: 'tableC:id_c';
          onDelete: 'set null';
          foreignKey: true;
        };
      };
      indexes: {
        id_a: Index.Primary;
        id_b: Index.Secondary;
        id_c: Index.Secondary;
      };
    }>,
    Database.UseTable<{
      name: 'tableB';
      schema: {
        id_b: string;
      };
      relations: {
        'id_b@relations_a': {
          source: 'tableA:id_b';
          foreignKey: false;
        };
      };
      indexes: {
        id_b: Index.Primary;
      };
    }>,
    Database.UseTable<{
      name: 'tableC';
      schema: {
        id_c: string;
      };
      relations: {
        'id_c@relations_a': {
          source: 'tableA:id_c';
          onDelete: 'restrict';
        };
      };
      indexes: {
        id_c: Index.Primary;
      };
    }>
  ];
}
