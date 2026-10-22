import type { Queue } from './contract';

/**
 * Queue client.
 */
export interface Client<T extends Queue.Message, U extends Queue.Mode> {
  /**
   * Send a new JSON message to the queue.
   *
   * @param message Message object.
   * @param options Send options.
   */
  sendMessage(message: T, options?: SendOptions<U>): Promise<void>;

  /**
   * Send new JSON messages to the queue, grouped in as few requests as the provider takes.
   *
   * Each message succeeds or fails on its own, as with `sendMessage`: the others are still sent, and
   * then it throws a `SendMessagesError` listing each message that failed and why.
   *
   * @param messages Message objects.
   * @param options Send options, applied to every message.
   */
  sendMessages(messages: T[], options?: SendOptions<U>): Promise<void>;

  /**
   * Receive JSON messages from the queue.
   *
   * @param options Receive options.
   * @returns Returns a list containing zero or more messages.
   */
  receiveMessage(options?: ReceiveOptions): Promise<T[]>;
}

/**
 * Options for receiving messages with queue client.
 */
export type ReceiveOptions = {
  /**
   * Maximum amount of messages.
   */
  readonly messages?: number;

  /**
   * Maximum wait time (in seconds) for receiving messages.
   */
  readonly polling?: number;
};

/**
 * Options for sending messages with queue client.
 */
export type SendOptions<T extends Queue.Mode> = T extends { fifoMode: true } ? never : StandardSendOptions;

/**
 * Options for sending messages with standard queue client.
 */
export type StandardSendOptions = {
  /**
   * Delay time (in seconds) for making the message available.
   */
  readonly delay?: number;
};
