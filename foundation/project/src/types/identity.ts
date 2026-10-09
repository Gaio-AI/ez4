export type IdentityGrant = {
  resourceIds: string[];
  permissions: string[];

  /**
   * Conditions the grant only applies under, by operator and key, as in an IAM policy
   * (`{ StringLike: { 'aws:ResourceTag/stage': 'prd' } }`).
   */
  conditions?: Record<string, Record<string, string | string[]>>;
};

export type IdentityAccount = {
  account: string;
};
