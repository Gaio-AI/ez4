export class ThrottlingResetError extends Error {
  constructor(stageName: string, reason: string, cause?: unknown) {
    super(`Throttling of API stage ${stageName} can't be removed without the account limits (apigateway:GET on /account), ${reason}.`, {
      cause
    });
  }
}
