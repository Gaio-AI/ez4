import { HttpConflictError } from '@ez4/gateway';
import { ServiceError } from '@ez4/common';

export class OrderLockedError extends ServiceError {}

export class PaymentLockedError extends Error {}

export const succeed = () => {
  return {
    status: 200,
    headers: {
      'x-custom': 'custom'
    }
  };
};

export const failUnexpectedly = () => {
  throw new Error('Connection refused by db.internal:5432');
};

export const failWithoutError = () => {
  throw 'Connection refused by db.internal:5432';
};

export const failWithHttpError = () => {
  throw new HttpConflictError('Order exists.', { orderId: 'order-1' });
};

export const failWithServiceError = () => {
  throw new OrderLockedError('Order is locked.', { orderId: 'order-1' });
};

export const failWithMappedError = () => {
  throw new PaymentLockedError('Payment is locked.');
};
