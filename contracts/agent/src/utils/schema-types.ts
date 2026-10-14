export interface JsonSchemaProperty {
  type?: string;
  description?: string;
  format?: string;
  enum?: (string | number)[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  anyOf?: JsonSchema[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  [key: string]: unknown;
}

export type JsonSchema = JsonSchemaProperty;
