import type { Client, Database, Index } from '@ez4/database';
import type { Environment, Service } from '@ez4/common';
import type { TestEngine } from '../common/engines';

import { Order } from '@ez4/database';

export declare class TestDatabase extends Database.Service<TestEngine> {
  client: Client<TestDatabase>;

  tables: [
    Database.UseTable<{
      name: 'tableA';
      relations: {
        // Secondary to primary
        'b_id@relation_b': 'tableB:id';

        // Primary to secondary
        'id@all_c': 'tableC:a_id';
      };
      indexes: {
        id: Index.Primary;
        b_id: Index.Secondary;
      };
      schema: {
        id: string;
        b_id?: string;
        value: number;
      };
    }>,
    Database.UseTable<{
      name: 'tableB';
      relations: {
        // Primary to secondary
        'id@all_a': 'tableA:b_id';
      };
      indexes: {
        id: Index.Primary;
      };
      schema: {
        id: string;
        value: string;
      };
    }>,
    Database.UseTable<{
      name: 'tableC';
      relations: {
        // Secondary to primary
        'a_id@relation_a': 'tableA:id';
      };
      indexes: {
        id: Index.Primary;
        a_id: Index.Secondary;
      };
      schema: {
        id: string;
        a_id: string;
        value: boolean;
      };
    }>
  ];

  services: {
    selfClient: Environment.Service<TestDatabase>;
  };
}

export const testWhere = async ({ selfClient }: Service.Context<TestDatabase>) => {
  // Three levels through the cycle tableA → tableB → tableA → tableB.
  await selfClient.tableA.findMany({
    select: {
      id: true
    },
    where: {
      value: 1,
      relation_b: {
        value: 'b',
        all_a: {
          value: 2,
          relation_b: {
            value: 'c'
          }
        }
      }
    }
  });

  // Seven levels through the same cycle.
  await selfClient.tableC.findMany({
    select: {
      id: true
    },
    where: {
      relation_a: {
        relation_b: {
          all_a: {
            relation_b: {
              all_a: {
                all_c: {
                  relation_a: {
                    value: 3
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  // No related record and some related record at an inner level.
  await selfClient.tableA.findMany({
    select: {
      id: true
    },
    where: {
      relation_b: {
        all_a: null
      },
      all_c: {
        relation_a: {}
      }
    }
  });

  // Logical operators around and inside nested relations.
  await selfClient.tableA.findMany({
    select: {
      id: true
    },
    where: {
      NOT: {
        relation_b: {
          all_a: null
        }
      },
      relation_b: {
        OR: [{ all_a: null }, { NOT: { all_a: { value: 1 } } }],
        AND: [{ value: 'b' }, { all_a: { all_c: { value: true } } }]
      }
    }
  });

  await selfClient.tableA.findMany({
    select: {
      id: true
    },
    where: {
      relation_b: {
        all_a: {
          // @ts-expect-error Unknown column in a nested relation.
          unknown: 1
        }
      }
    }
  });

  await selfClient.tableA.findMany({
    select: {
      id: true
    },
    where: {
      relation_b: {
        all_a: {
          // @ts-expect-error Wrong column type in a nested relation.
          value: 'a'
        }
      }
    }
  });

  await selfClient.tableA.findMany({
    select: {
      id: true
    },
    where: {
      relation_b: {
        all_a: {
          // @ts-expect-error The relation column is not a filter of its own relation.
          b_id: 'b'
        }
      }
    }
  });

  await selfClient.tableA.findMany({
    select: {
      id: true
    },
    where: {
      relation_b: {
        // @ts-expect-error Unknown relation in a nested relation.
        relation_c: {}
      }
    }
  });
};

export const testInclude = async ({ selfClient }: Service.Context<TestDatabase>) => {
  // Nested relation filters inside an include.
  await selfClient.tableB.findMany({
    select: {
      id: true,
      all_a: {
        value: true
      }
    },
    include: {
      all_a: {
        where: {
          value: 1,
          all_c: null,
          OR: [{ relation_b: { value: 'b' } }, { all_c: { relation_a: { value: 2 } } }]
        },
        order: {
          value: Order.Asc
        }
      }
    }
  });

  await selfClient.tableB.findMany({
    select: {
      id: true,
      all_a: {
        value: true
      }
    },
    include: {
      all_a: {
        order: {
          // @ts-expect-error A relation is not an order column.
          relation_b: Order.Asc
        }
      }
    }
  });
};

// Returned rather than awaited: the declaration emit has to name the inferred result, whose table
// metadata carries the relation cycle.
export const testDeclaration = ({ selfClient }: Service.Context<TestDatabase>) => {
  return Promise.all([
    selfClient.tableA.findMany({
      select: {
        id: true
      }
    }),
    selfClient.tableB.findMany({
      select: {
        id: true,
        all_a: {
          value: true,
          relation_b: {
            value: true
          }
        }
      }
    }),
    selfClient.tableA.updateOne({
      select: {
        id: true
      },
      data: {
        value: 1
      },
      where: {
        id: 'a'
      }
    })
  ]);
};

export const testWrite = async ({ selfClient }: Service.Context<TestDatabase>) => {
  // Nested relation filters in the other operations with a where.
  await selfClient.tableA.updateMany({
    data: {
      value: 1
    },
    where: {
      relation_b: {
        all_a: {
          value: 2
        }
      }
    }
  });

  await selfClient.tableA.deleteMany({
    where: {
      relation_b: {
        all_a: null
      }
    }
  });

  await selfClient.tableA.count({
    where: {
      all_c: {
        relation_a: {
          relation_b: {}
        }
      }
    }
  });

  await selfClient.tableA.exists({
    where: {
      all_c: {
        relation_a: {
          relation_b: null
        }
      }
    }
  });
};
