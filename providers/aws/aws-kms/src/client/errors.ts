export class MalformedCiphertextError extends Error {
  constructor() {
    super('The encrypted value is not one this client produces.');
  }
}

export class UnexpectedKeySourceError extends Error {
  constructor(
    public expected: string,
    public found: string
  ) {
    super(`The encrypted value was sealed by '${found}', and this client reads '${expected}'.`);
  }
}

export class MissingDataKeyError extends Error {
  constructor() {
    super('KMS answered without the data key.');
  }
}
