import { HttpException } from '@nestjs/common';
import {
  CoreApiHttpError,
  CoreApiUnavailableError,
} from '../core-api/core-api.client.js';

/**
 * Đổi MỌI lỗi (ABP qua Core_API, lỗi Nest, lỗi mạng, lỗi lạ) sang
 * ProblemDetails. Giữ nguyên status và lỗi theo trường; loại bỏ stack trace, hostname, đường dẫn, SQL khỏi output.
 */
export interface ProblemRule {
  code: string;
  passed: boolean;
  message: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  correlationId: string;
  detail?: string;
  errors?: Record<string, string[]>;
  rules?: ProblemRule[];
  currentState?: string;
  allowedTargets?: string[];
  /** 409 trùng: tên trường bị trùng (`name`, `slug`). */
  field?: string;
  /** 422 Brand còn CarModel Published: các mẫu xe cần ẩn trước. */
  items?: { name: string; slug: string }[];
}

const TYPE_BASE = 'https://cdp.example/errors/';
export const GENERIC_FIELD_MESSAGE = 'Giá trị không hợp lệ';

interface Defaults {
  slug: string;
  code: string;
  title: string;
}

const DEFAULTS: Record<number, Defaults> = {
  400: {
    slug: 'validation',
    code: 'Validation',
    title: 'Dữ liệu không hợp lệ',
  },
  401: {
    slug: 'unauthenticated',
    code: 'Unauthenticated',
    title: 'Chưa đăng nhập hoặc phiên đã hết hạn',
  },
  403: {
    slug: 'forbidden',
    code: 'Forbidden',
    title: 'Không có quyền thực hiện thao tác này',
  },
  404: { slug: 'not-found', code: 'NotFound', title: 'Không tìm thấy' },
  409: {
    slug: 'conflict',
    code: 'Conflict',
    title: 'Dữ liệu đã bị thay đổi, tải lại và thử lại',
  },
  422: {
    slug: 'validation',
    code: 'BusinessRule',
    title: 'Không thể thực hiện thao tác',
  },
  429: {
    slug: 'rate-limit',
    code: 'RateLimited',
    title: 'Bạn gửi quá nhanh, thử lại sau',
  },
  500: {
    slug: 'internal',
    code: 'InternalError',
    title: 'Lỗi hệ thống, vui lòng thử lại sau',
  },
  502: {
    slug: 'unavailable',
    code: 'CoreUnavailable',
    title: 'Dịch vụ tạm thời không khả dụng',
  },
  503: {
    slug: 'unavailable',
    code: 'CoreUnavailable',
    title: 'Dịch vụ tạm thời không khả dụng',
  },
  504: {
    slug: 'timeout',
    code: 'CoreTimeout',
    title: 'Dịch vụ phản hồi quá chậm',
  },
};

const GENERIC_4XX: Defaults = {
  slug: 'request',
  code: 'BadRequest',
  title: 'Yêu cầu không hợp lệ',
};

/** Dấu hiệu rò rỉ nội bộ: stack trace, tên exception, host/IP/URL, đường dẫn file. */
const LEAK_PATTERNS: RegExp[] = [
  /\r|\n/,
  /\bat\s+[^\s(]+\s*\(/,
  /\bat\s+\S+\s+in\s+\S+/,
  /\bin\s+\S+:line\s+\d+/i,
  /\b\w*Exception\b/,
  /\bhttps?:\/\//i,
  /\bwww\./i,
  /\blocalhost\b/i,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/,
  /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?\b/i,
  /[A-Za-z]:\\/,
  /(?:^|[\s"'(])\/(?:usr|app|src|var|home|opt|etc|bin|tmp)\//i,
  /\.(?:cs|ts|js|mjs|cjs)(?::\d+)+/,
];

const MAX_TEXT = 300;
const STABLE_CODE = /^[A-Za-z][A-Za-z0-9_]*(?::[A-Za-z0-9_]+)*$/;
const FIELD_KEY = /^[A-Za-z0-9_$.[\]-]{1,100}$/;

/** Trả chuỗi nếu an toàn để đưa ra ngoài, ngược lại undefined. */
export function safeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (text === '' || text.length > MAX_TEXT) return undefined;
  return LEAK_PATTERNS.some((p) => p.test(text)) ? undefined : text;
}

function stableCode(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length <= 100 &&
    STABLE_CODE.test(value) &&
    !/exception/i.test(value)
    ? value
    : undefined;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function defaultsFor(status: number): Defaults {
  return DEFAULTS[status] ?? (status >= 500 ? DEFAULTS[500] : GENERIC_4XX);
}

interface Normalized {
  status: number;
  code?: unknown;
  title?: unknown;
  message?: unknown;
  validationErrors?: unknown;
  data?: unknown;
}

/** Đọc body lỗi dạng ABP `{ error: { code, message, data, validationErrors } }` hoặc dạng phẳng của Nest/BFF. */
function normalizeBody(status: number, body: unknown): Normalized {
  if (!isRecord(body)) return { status };
  const inner = isRecord(body.error) ? body.error : body;
  return {
    status,
    code: inner.code,
    title: inner.title,
    message: inner.message,
    validationErrors: inner.validationErrors,
    data: inner.data ?? (isRecord(inner.details) ? inner.details : undefined),
  };
}

function buildFieldErrors(
  validationErrors: unknown,
): Record<string, string[]> | undefined {
  if (!Array.isArray(validationErrors) || validationErrors.length === 0)
    return undefined;
  const errors: Record<string, string[]> = {};
  for (const item of validationErrors) {
    if (!isRecord(item)) continue;
    const message = safeText(item.message) ?? GENERIC_FIELD_MESSAGE;
    const members = Array.isArray(item.members) ? item.members : [];
    const keys = members.filter(
      (m): m is string => typeof m === 'string' && FIELD_KEY.test(m),
    );
    for (const key of keys.length > 0 ? keys : ['$']) {
      (errors[key] ??= []).push(message);
    }
  }
  return Object.keys(errors).length > 0 ? errors : undefined;
}

function buildRules(value: unknown): ProblemRule[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rules: ProblemRule[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const code = stableCode(item.code);
    if (!code || typeof item.passed !== 'boolean') continue;
    rules.push({
      code,
      passed: item.passed,
      message: safeText(item.message) ?? GENERIC_FIELD_MESSAGE,
    });
  }
  return rules.length > 0 ? rules : undefined;
}

function buildProblem(n: Normalized, correlationId: string): ProblemDetails {
  const defaults = defaultsFor(n.status);
  const problem: ProblemDetails = {
    type: `${TYPE_BASE}${defaults.slug}`,
    title: safeText(n.title) ?? defaults.title,
    status: n.status,
    code: stableCode(n.code) ?? defaults.code,
    correlationId,
  };

  // 401/403/404 giữ chung một thông điệp (không lộ lý do, cùng body với "không tồn tại"); 5xx không bao giờ kèm detail.
  if (n.status === 400 || n.status === 409 || n.status === 422) {
    const detail = safeText(n.message);
    if (detail) problem.detail = detail;
  }

  if (n.status === 400) {
    const errors = buildFieldErrors(n.validationErrors);
    if (errors) problem.errors = errors;
  }

  if (n.status === 409 && isRecord(n.data)) {
    const field =
      typeof n.data.field === 'string' && FIELD_KEY.test(n.data.field)
        ? n.data.field
        : undefined;
    if (field) problem.field = field;
  }
  if (n.status === 422 && isRecord(n.data) && Array.isArray(n.data.items)) {
    const items = n.data.items
      .filter(isRecord)
      .map((i) => ({ name: safeText(i.name), slug: safeText(i.slug) }))
      .filter((i): i is { name: string; slug: string } => !!i.name && !!i.slug);
    if (items.length > 0) problem.items = items;
  }
  if (n.status === 422 && isRecord(n.data)) {
    const rules = buildRules(n.data.rules);
    if (rules) problem.rules = rules;
    const state = safeText(n.data.currentState);
    if (state) problem.currentState = state;
    if (Array.isArray(n.data.allowedTargets)) {
      const targets = n.data.allowedTargets
        .map(safeText)
        .filter((t): t is string => t !== undefined);
      if (targets.length > 0) problem.allowedTargets = targets;
    }
  }

  return problem;
}

/** Hàm thuần: bất kỳ giá trị bị ném → ProblemDetails. Không bao giờ ném. */
export function toProblemDetails(
  error: unknown,
  correlationId: string,
): ProblemDetails {
  if (error instanceof CoreApiHttpError) {
    return buildProblem(
      normalizeBody(clampStatus(error.status), error.body),
      correlationId,
    );
  }

  if (error instanceof CoreApiUnavailableError) {
    const status = error.kind === 'timeout' ? 504 : 503;
    return buildProblem({ status }, correlationId);
  }

  if (error instanceof HttpException) {
    const status = clampStatus(error.getStatus());
    const response = error.getResponse();
    // Lỗi route không tồn tại / lỗi framework: message của Nest có thể chứa path, nên chỉ lấy khi là lỗi do ta chủ ý
    // (response là object có `code`).
    const own =
      isRecord(response) && typeof response.code === 'string'
        ? response
        : undefined;
    return buildProblem(
      own ? normalizeBody(status, own) : { status },
      correlationId,
    );
  }

  return buildProblem({ status: 500 }, correlationId);
}

function clampStatus(status: number): number {
  return Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : 500;
}
