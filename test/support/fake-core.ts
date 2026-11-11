import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer, IncomingHttpHeaders, Server } from 'node:http';
import { AddressInfo } from 'node:net';

/** Máy chủ Core_API giả: ghi lại request và trả theo `handler`. Dùng chung cho unit/e2e test. */
export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
  /** Byte gốc của body (multipart nhị phân không đọc đúng được qua chuỗi utf8). */
  raw: Buffer;
}

export interface FakeReply {
  status: number;
  body?: unknown;
  /** Trì hoãn trước khi trả (mô phỏng Core_API chậm). */
  delayMs?: number;
}

export class FakeCore {
  readonly requests: RecordedRequest[] = [];
  handler: (req: RecordedRequest) => FakeReply = () => ({
    status: 200,
    body: {},
  });
  private server?: Server;
  url = '';

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        const recorded: RecordedRequest = {
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: raw.toString('utf8'),
          raw,
        };
        this.requests.push(recorded);
        const reply = this.handler(recorded);
        const send = () => {
          if (reply.body === undefined) {
            res.writeHead(reply.status).end();
          } else {
            res
              .writeHead(reply.status, { 'content-type': 'application/json' })
              .end(JSON.stringify(reply.body));
          }
        };
        if (reply.delayMs) {
          setTimeout(send, reply.delayMs);
        } else {
          send();
        }
      });
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(0, '127.0.0.1', resolve),
    );
    this.url = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }
}

/** Edge key dùng-một-lần cho test, sinh ngẫu nhiên mỗi lần chạy (không có giá trị cố định nào trong repo). */
export const TEST_EDGE_KEY = randomBytes(24).toString('hex');

/** Khóa riêng ES256 dùng-một-lần cho test. */
export function newTestPrivateKeyPem(): string {
  return generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
}
