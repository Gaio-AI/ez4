import type { Readable } from 'node:stream';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

export interface AgentStorage {
  readJson<T>(key: string): Promise<T>;
  writeJson<T>(key: string, value: T): Promise<void>;
  putBuffer(key: string, buffer: Uint8Array): Promise<void>;
  getBuffer(key: string): Promise<Uint8Array | undefined>;
}

export const createS3Storage = (bucketName: string, client = new S3Client()): AgentStorage => ({
  async readJson<T>(key: string): Promise<T> {
    const res = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
    const stream = res.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  },
  async writeJson<T>(key: string, value: T): Promise<void> {
    const body = Buffer.from(JSON.stringify(value), 'utf-8');
    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: body,
        ContentType: 'application/json'
      })
    );
  },
  async putBuffer(key: string, buffer: Uint8Array): Promise<void> {
    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer
      })
    );
  },
  async getBuffer(key: string): Promise<Uint8Array | undefined> {
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
      const stream = res.Body as Readable;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return new Uint8Array(Buffer.concat(chunks));
    } catch (err: unknown) {
      const anyErr = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (anyErr?.name === 'NoSuchKey' || anyErr?.$metadata?.httpStatusCode === 404) {
        return undefined;
      }
      throw err;
    }
  }
});
