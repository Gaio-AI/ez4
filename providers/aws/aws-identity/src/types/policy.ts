export type PolicyStatement = {
  Sid: string;
  Effect: 'Allow' | 'Deny';
  Action: string | string[];
  Resource: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
};

export type PolicyDocument = {
  Version: string;
  Statement: PolicyStatement[];
};
