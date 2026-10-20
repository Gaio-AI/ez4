# EZ4: Database

The Database contract defines a database service for your application. It uses EZ4's [reflection](../../foundation/reflection/) system to analyze your engine, tables, indexes, relations, and scalability configuration, then generates the infrastructure and runtime bindings required to store and query data.

## Getting started

#### Install

```sh
npm install @ez4/database @ez4/local-database @ez4/aws-aurora -D
```

> You can use `@ez4/aws-dynamodb` instead of `@ez4/aws-aurora` for NoSQL database.

#### Create database

Here's a minimal example of a database service with a single table.

```ts
import type { Environment, Service } from '@ez4/common';
import type { Database } from '@ez4/database';

// MyDb table
type MyTableSchema = {
  foo: string;
  bar: number;
};

// MyDb declaration
export declare class MyDb extends Database.Service<PostgresEngine> {
  client: Client<MyDb>;

  tables: [
    Database.UseTable<{
      name: 'test_table';
      schema: MyTableSchema;
      indexes: {
        foo: Index.Primary;
      };
    }>
  ];
}
```

#### Use database

Any handler with access to the database service can perform queries.

```ts
import type { Service } from '@ez4/common';
import type { MyDb } from './db';

// Any other handler that has injected MyDb service
export async function anotherHandler(_request: any, { myDb }: Service.Context<AnotherService>) {
  // Insert one record
  await myDb.test_table.insertOne({
    data: {
      foo: 'foo',
      bar: 123
    }
  });

  // Find one record
  const result = await myDb.test_table.findOne({
    select: {
      bar: true
    },
    where: {
      foo: 'foo'
    }
  });
}
```

With your database service defined, EZ4 handles provisioning, migrations, scaling, and runtime wiring automatically according to your contract.

## Database properties

#### Service

| Name        | Type                      | Description                                           |
| ----------- | ------------------------- | ----------------------------------------------------- |
| scalability | Database.UseScalability<> | Scalability configuration.                            |
| tables      | Database.UseTable<>       | Defines all tables available in the database service. |
| engine      | Database.UseEngine<>      | Determines which database engine to use.              |
| variables   | object                    | Environment variables associated with all streams.    |
| services    | object                    | Injected services associated with all streams.        |

> Use type helpers for `scalability` and `tables` properties.

#### Tables

| Name      | Type                      | Description                 |
| --------- | ------------------------- | --------------------------- |
| stream    | Database.UseTableStream<> | Table stream configuration. |
| name      | string                    | Table name.                 |
| schema    | object                    | Table schema.               |
| relations | object                    | Table relations.            |
| indexes   | object                    | Table indexes.              |

#### Indexes

Each index is keyed by its columns, joined by `:`, and takes its type:

```ts
indexes: {
  id: Index.Primary;
  'account_id:created_at': Index.Secondary;
};
```

An object declares the index with options (Aurora Postgres):

```ts
indexes: {
  'account_id:created_at': {
    type: Index.Secondary;
    name: 'messages_active_by_account';
    where: { deleted_at: null };
    include: ['status'];
    order: { created_at: 'desc' };
  };
};
```

| Name             | Type                                             | Description                                                                                      |
| ---------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| type             | Index                                            | Index type.                                                                                      |
| columns          | string[]                                         | Index columns, when the key is a name rather than the columns (two indexes on the same columns). |
| name             | string                                           | Index name in the database, instead of one made of the table, the key and the type.              |
| where            | object                                           | Indexes only the matching rows (a partial index), with literal values as in a query `where`.     |
| include          | string[]                                         | Columns stored in the index besides its key, so a query that reads only them needs no table.     |
| order            | object                                           | Descending (`'desc'`) or ascending (`'asc'`) order of each index column.                         |
| nullsNotDistinct | boolean                                          | A unique index that takes rows with the same columns as duplicates even when they are null.      |
| method           | `'btree' \| 'hash' \| 'gin' \| 'gist' \| 'brin'` | Index method, instead of `btree` (or `gin` for a single object or array column).                 |

A partial unique index doesn't identify a record, so queries can't look a record up by it and an upsert doesn't use it as its conflict target. Postgres uses a partial index only for a query whose filters include its `where`. The deploy fails on options a method doesn't take (a unique index other than `btree`, for example), and the plan warns about a new secondary index that another index covers.

A primary key and a TTL index take no options besides `columns`.

#### Relations

Each relation is keyed by `'<column>@<alias>'`, the table's column and the name the relation takes in queries, and points to `'<table>:<column>'`, the related table and column:

```ts
relations: {
  'account_id@account': 'accounts:id';
};
```

The indexes of both columns decide what the relation is: a column that holds the primary or unique key of another table relates to one record of it, and a key that other records hold relates to many of them. On Aurora Postgres, the table that holds the key of a primary or unique column gets a foreign key. When that column takes null, deleting the related record sets it to null; otherwise it deletes the record too.

An object declares the relation with options:

```ts
relations: {
  'account_id@account': {
    source: 'accounts:id';
    onDelete: 'restrict';
  };
};
```

| Name       | Type                                                   | Description                                                                                   |
| ---------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| source     | string                                                 | Related table and column (`'<table>:<column>'`).                                              |
| onDelete   | `'cascade' \| 'set null' \| 'restrict' \| 'no action'` | What deleting the related record does to the record holding its key (Aurora Postgres).        |
| foreignKey | boolean                                                | Whether the relation has a foreign key, overriding what the indexes decide (Aurora Postgres). |

`foreignKey: true` gives a foreign key to a relation between two primary keys (a table that extends another by its key), and `foreignKey: false` keeps one off a relation. A foreign key needs a primary or unique column on the related table and columns of the same type, and `'set null'` needs a column that takes null: the deploy fails otherwise.

#### Streams (DynamoDB only)

| Name         | Type             | Description                                                 |
| ------------ | ---------------- | ----------------------------------------------------------- |
| listener     | function         | Life-cycle listener function for the stream.                |
| handler      | function         | Entry-point handler function for the stream.                |
| variables    | object           | Environment variables associated with the stream.           |
| logRetention | integer          | Log retention (in days) for the handler.                    |
| logLevel     | LogLevel         | Log level for the handler.                                  |
| architecture | ArchitectureType | Architecture type for the cloud function.                   |
| runtime      | RuntimeType      | Runtime for the cloud function.                             |
| files        | string[]         | Additional resource files added into the handler bundle.    |
| memory       | integer          | Memory available (in megabytes) for the handler.            |
| timeout      | integer          | Max execution time (in seconds) for the handler.            |
| debug        | boolean          | Determine whether the debug mode is active for the handler. |
| vpc          | boolean          | Determines whether or not VPC is enabled for the handler.   |

> Streams is a DynamoDB feature, thus unavailable for Aurora Postgres.

## Examples

- [Get started with Aurora RDS](../../examples/hello-aws-aurora)
- [Get started with DynamoDB](../../examples/hello-aws-dynamodb)
- [Aurora RDS CRUDL](../../examples/aws-aurora-crudl)
- [DynamoDB CRUDL](../../examples/aws-dynamodb-crudl)
- [DynamoDB streams](../../examples/aws-dynamodb-streams)
- [Schedule manager](../../examples/aws-schedule-manager)
- [Storage manager](../../examples/aws-storage-manager)

## Providers

- [Local provider](../../providers/local/local-database)
- [AWS Aurora provider](../../providers/aws/aws-aurora)
- [AWS DynamoDB provider](../../providers/aws/aws-dynamodb)

## License

MIT License
