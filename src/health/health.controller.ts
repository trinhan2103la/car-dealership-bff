import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

/**
 * Ngày 17 (Req 22, 28.13): health của BFF.
 * - /health/live: liveness, không phụ thuộc dependency -> 200 khi process còn sống.
 * - /health/ready: readiness; hiện BFF chưa có dependency bắt buộc nên cũng 200.
 *   Khi thêm kiểm Core_API reachability (phase sau) sẽ bổ sung indicator vào đây.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([]);
  }
}
