// The error SQS answers for a parameter it refuses, named by its SQS error code.
export class InvalidParameterValueError extends Error {
  constructor(reason: string, parameterName?: string, parameterValue?: unknown) {
    super(
      parameterName
        ? `Value ${parameterValue} for parameter ${parameterName} is invalid. Reason: ${reason}`
        : `One or more parameters are invalid. Reason: ${reason}`
    );

    this.name = 'InvalidParameterValue';
  }
}
