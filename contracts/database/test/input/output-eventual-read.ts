import type { Database, EventualReadMode } from '@ez4/database';
import type { TestEngineEventualRead } from '../common/engines';

/**
 * Database whose engine serves eventually consistent reads.
 */
export declare class TestDatabase extends Database.Service<TestEngineEventualRead<EventualReadMode.Supported>> {
  tables: [];
}
