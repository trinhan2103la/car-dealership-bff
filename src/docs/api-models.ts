import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Lớp CHỈ để mô tả schema cho Swagger (BFF không dùng class-validator; kiểm dữ liệu thủ công ở controller).
 * Giữ khớp với response thật: auth.controller.ts, problem-details.mapper.ts.
 */
export class LoginRequestDto {
  @ApiProperty({ example: 'admin@example.com', maxLength: 320 })
  email!: string;

  @ApiProperty({ format: 'password', maxLength: 128 })
  password!: string;
}

export class AdminUserDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ example: 'admin@example.com' })
  email!: string;

  @ApiProperty({ type: [String], example: ['SuperAdmin'] })
  roles!: string[];

  @ApiProperty({ type: [String], example: ['Catalog.Edit', 'Users.Manage'] })
  permissions!: string[];
}

/** Response của login/refresh. Refresh token KHÔNG nằm ở đây (chỉ trong cookie HttpOnly). */
export class TokenResponseDto {
  @ApiProperty({
    description:
      'Access token ES256. Gửi trong header `Authorization: Bearer <token>`.',
  })
  accessToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: string;

  @ApiProperty({
    example: 600,
    description:
      'Số giây còn hiệu lực. Client refresh trước khi hết (khoảng 60 s).',
  })
  expiresIn!: number;

  @ApiProperty({ type: AdminUserDto })
  user!: AdminUserDto;
}

export class MeResponseDto {
  @ApiProperty({ type: AdminUserDto })
  user!: AdminUserDto;
}

export class ProblemDetailsDto {
  @ApiProperty({ example: 'https://cdp.example/errors/validation' })
  type!: string;

  @ApiProperty({ example: 'Dữ liệu không hợp lệ' })
  title!: string;

  @ApiProperty({ example: 400 })
  status!: number;

  @ApiProperty({ example: 'Validation', description: 'Mã lỗi ổn định.' })
  code!: string;

  @ApiProperty({
    example: '0599336180d84900871f11472e15fb1d',
    description: 'Tra log BFF và Core_API.',
  })
  correlationId!: string;

  @ApiPropertyOptional()
  detail?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
    example: { password: ['Trường password là bắt buộc'] },
    description: 'Chỉ có ở 400: lỗi theo trường.',
  })
  errors?: Record<string, string[]>;
}
