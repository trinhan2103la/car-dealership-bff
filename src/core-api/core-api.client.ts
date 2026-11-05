import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import createClient from 'openapi-fetch';
import type { paths } from './generated/schema.js';
import {
  AdminIdentity,
  ServiceScope,
  ServiceTokenSigner,
} from './service-token.signer.js';

/**
 * Client gọi Core_API. Mỗi request tự gắn:
 * X-Edge-Key, Authorization (Service_Credential ES256 60 s, kèm sub/sid khi thay mặt admin), X-Correlation-Id.
 * Lỗi mạng/timeout được phân loại và KHÔNG chứa host của Core_API (host khó đoán là một lớp phòng thủ).
 */
export const CORE_API_URL_VARIABLE = 'CORE_API_URL';
export const EDGE_KEY_VARIABLE = 'EDGE_KEY';
export const CORE_API_TIMEOUT_VARIABLE = 'CORE_API_TIMEOUT_MS';
export const DEFAULT_CORE_API_TIMEOUT_MS = 10_000;

export const EDGE_KEY_HEADER = 'X-Edge-Key';
export const CORRELATION_ID_REQUEST_HEADER = 'X-Correlation-Id';

export interface CoreRequestContext {
  correlationId: string;
  /** Admin_User của access token đã kiểm → claim sub/sid trong Service_Credential. */
  admin?: AdminIdentity;
  scope?: ServiceScope;
}

export type CoreApi = ReturnType<typeof createClient<paths>>;

export type CoreUnavailableKind = 'timeout' | 'network' | 'not_configured';

/** Core_API không trả lời được. Thông điệp cố định, không kèm host/URL/nguyên nhân gốc. */
export class CoreApiUnavailableError extends Error {
  constructor(readonly kind: CoreUnavailableKind) {
    super(`Core_API không khả dụng (${kind})`);
    this.name = 'CoreApiUnavailableError';
  }
}

/** Core_API trả HTTP không thành công. `body` là JSON đã parse (hoặc text/undefined), CHƯA được làm sạch. */
export class CoreApiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Core_API trả ${status}`);
    this.name = 'CoreApiHttpError';
  }
}

/** Lấy `data` của kết quả openapi-fetch hoặc ném CoreApiHttpError. 204 trả undefined. */
export function unwrap<T = unknown>(result: {
  data?: unknown;
  error?: unknown;
  response: Response;
}): T {
  if (!result.response.ok) {
    throw new CoreApiHttpError(result.response.status, result.error);
  }
  return result.data as T;
}

@Injectable()
export class CoreApiClient {
  constructor(
    private readonly config: ConfigService,
    private readonly signer: ServiceTokenSigner,
  ) {}

  /** Tạo client gắn sẵn header cho MỘT request (rẻ, không giữ trạng thái). */
  for(context: CoreRequestContext): CoreApi {
    const baseUrl = this.config.get<string>(CORE_API_URL_VARIABLE)?.trim();
    const edgeKey = this.config.get<string>(EDGE_KEY_VARIABLE);
    if (!baseUrl || !edgeKey) {
      throw new CoreApiUnavailableError('not_configured');
    }

    const client = createClient<paths>({
      baseUrl: baseUrl.replace(/\/+$/, ''),
      fetch: (request) => this.fetchWithTimeout(request),
    });

    client.use({
      onRequest: async ({ request }) => {
        const token = await this.signer.sign(
          context.correlationId,
          context.scope ?? 'bff',
          context.admin,
        );
        request.headers.set(EDGE_KEY_HEADER, edgeKey);
        request.headers.set('Authorization', `Bearer ${token}`);
        request.headers.set(
          CORRELATION_ID_REQUEST_HEADER,
          context.correlationId,
        );
        return request;
      },
    });

    return client;
  }

  private timeoutMs(): number {
    const raw = Number(this.config.get<string>(CORE_API_TIMEOUT_VARIABLE));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CORE_API_TIMEOUT_MS;
  }

  private async fetchWithTimeout(request: Request): Promise<Response> {
    const signal = AbortSignal.timeout(this.timeoutMs());
    try {
      return await fetch(new Request(request, { signal }));
    } catch (error) {
      // Chủ ý bỏ `error` gốc: message của undici chứa host/địa chỉ.
      const timedOut =
        signal.aborted || (error as { name?: string })?.name === 'TimeoutError';
      throw new CoreApiUnavailableError(timedOut ? 'timeout' : 'network');
    }
  }
}
