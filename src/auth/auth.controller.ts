import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  LoginRequestDto,
  MeResponseDto,
  ProblemDetailsDto,
  TokenResponseDto,
} from '../docs/api-models.js';
import { BEARER_SECURITY } from '../docs/swagger.js';
import { AccessTokenService } from './access-token.service.js';
import { LOGIN_THROTTLER, REFRESH_THROTTLER } from './auth.constants.js';
import { AdminRequest, RequirePermission } from './jwt-auth.guard.js';
import { OriginGuard } from './origin.guard.js';
import { RefreshCookie } from './refresh-cookie.js';
import { CoreLoginResult, SessionService } from './session.service.js';

/** Giới hạn khớp LoginInput của Core_API. */
const MAX_EMAIL = 320;
const MAX_PASSWORD = 128;

function validateLogin(body: unknown): { email: string; password: string } {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  const errors: { message: string; members: string[] }[] = [];
  const check = (field: 'email' | 'password', max: number) => {
    const v = b[field];
    if (typeof v !== 'string' || v.length === 0 || v.length > max) {
      errors.push({
        message: `Trường ${field} là bắt buộc (tối đa ${max} ký tự)`,
        members: [field],
      });
    }
  };
  check('email', MAX_EMAIL);
  check('password', MAX_PASSWORD);
  if (errors.length > 0) {
    throw new BadRequestException({
      code: 'Validation',
      validationErrors: errors,
    });
  }
  return { email: b.email as string, password: b.password as string };
}

const cid = (req: AdminRequest) => req.correlationId ?? 'unknown';

/**
 * Auth Admin bằng access token (Bearer, 10 phút, trong bộ nhớ SPA) + refresh token (cookie HttpOnly, xoay vòng).
 * Refresh token KHÔNG BAO GIỜ nằm trong body response. Response có token đều `Cache-Control: no-store`.
 */
@ApiTags('Admin auth')
@ApiServiceUnavailableResponse({
  description: 'Core_API không khả dụng.',
  type: ProblemDetailsDto,
})
@Controller('api/admin/auth')
export class AuthController {
  constructor(
    private readonly sessions: SessionService,
    private readonly cookie: RefreshCookie,
    private readonly tokens: AccessTokenService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Đăng nhập',
    description:
      'Trả access token (10 phút) trong body và đặt cookie refresh token HttpOnly (7 ngày tối đa). Giới hạn 10 lần / 60 s / IP.',
  })
  @ApiBody({ type: LoginRequestDto })
  @ApiOkResponse({ type: TokenResponseDto })
  @ApiBadRequestResponse({
    description: 'Thiếu/sai trường.',
    type: ProblemDetailsDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Sai email hoặc mật khẩu (thông báo chung).',
    type: ProblemDetailsDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Vượt giới hạn, kèm header Retry-After.',
    type: ProblemDetailsDto,
  })
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ [REFRESH_THROTTLER]: true })
  async login(
    @Body() body: unknown,
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { email, password } = validateLogin(body);
    const result = await this.sessions.login(email, password, cid(req));
    this.cookie.set(
      res,
      result.refreshToken!,
      new Date(result.sessionExpiresAt),
    );
    return this.tokenResponse(result, res);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Làm mới access token',
    description:
      'Dùng cookie refresh token (trình duyệt tự gửi). Xoay vòng: đặt cookie mới. Yêu cầu header Origin hợp lệ. Giới hạn 30 lần / 60 s / IP.',
  })
  @ApiOkResponse({ type: TokenResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Không có / hết hạn / bị thu hồi → đăng nhập lại.',
    type: ProblemDetailsDto,
  })
  @ApiForbiddenResponse({
    description: 'Origin không hợp lệ.',
    type: ProblemDetailsDto,
  })
  @UseGuards(OriginGuard, ThrottlerGuard)
  @SkipThrottle({ [LOGIN_THROTTLER]: true })
  async refresh(
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.cookie.read(req);
    const result = token ? await this.sessions.refresh(token, cid(req)) : null;
    if (!result) {
      this.cookie.clear(res);
      throw new UnauthorizedException({ code: 'Unauthenticated' });
    }
    // refreshToken null = grace 20 s: trình duyệt đã có cookie mới từ request vừa xoay, KHÔNG ghi đè.
    if (result.refreshToken)
      this.cookie.set(
        res,
        result.refreshToken,
        new Date(result.sessionExpiresAt),
      );
    return this.tokenResponse(result, res);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Đăng xuất',
    description:
      'Thu hồi phiên ở Core_API và xóa cookie. Yêu cầu header Origin hợp lệ.',
  })
  @ApiNoContentResponse({
    description: 'Đã đăng xuất (kể cả khi phiên đã hết hạn).',
  })
  @ApiForbiddenResponse({
    description: 'Origin không hợp lệ.',
    type: ProblemDetailsDto,
  })
  @UseGuards(OriginGuard)
  async logout(
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = this.cookie.read(req);
    try {
      if (token) await this.sessions.revoke(token, cid(req));
    } finally {
      // Dù Core_API lỗi, trình duyệt vẫn được xóa cookie.
      this.cookie.clear(res);
    }
  }

  @Get('me')
  @ApiOperation({
    summary: 'Người dùng hiện tại',
    description: 'Hỏi Core_API theo sid: phiên bị thu hồi thì 401 ngay.',
  })
  @ApiBearerAuth(BEARER_SECURITY)
  @ApiOkResponse({ type: MeResponseDto })
  @ApiUnauthorizedResponse({
    description: '`TokenExpired` → refresh; `Unauthenticated` → đăng nhập lại.',
    type: ProblemDetailsDto,
  })
  @RequirePermission()
  async me(
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const admin = req.admin!; // JwtAuthGuard đã bảo đảm
    const current = await this.sessions.current(
      { userId: admin.userId, sessionId: admin.sessionId },
      cid(req),
    );
    if (!current) throw new UnauthorizedException({ code: 'Unauthenticated' });
    res.setHeader('Cache-Control', 'no-store');
    return {
      user: {
        userId: current.userId,
        email: current.email,
        roles: current.roles,
        permissions: current.permissions,
      },
    };
  }

  private async tokenResponse(result: CoreLoginResult, res: Response) {
    const { accessToken, expiresIn } = await this.tokens.issue({
      userId: result.userId,
      sessionId: result.sessionId,
      email: result.email,
      roles: [...result.roles],
      permissions: [...result.permissions],
    });
    res.setHeader('Cache-Control', 'no-store');
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
      user: {
        userId: result.userId,
        email: result.email,
        roles: result.roles,
        permissions: result.permissions,
      },
    };
  }
}
