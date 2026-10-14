/**
 * A model described by its JSDoc.
 */
export interface TestSchema {
  /**
   * Described by its JSDoc.
   */
  commented: string;

  /**
   * Its JSDoc text.
   *
   * @description Its description tag.
   */
  tagged: number;

  /**
   * Missing is allowed, and refused by whoever reads it.
   *
   * @required
   */
  documentedRequired?: string;

  plain: boolean;
}
