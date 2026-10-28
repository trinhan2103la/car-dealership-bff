# car-dealership-bff

BFF (NestJS 12, ESM-only) của dự án **Car Dealership Platform** — điểm vào duy nhất cho hai frontend; validate định dạng input, session cookie + CSRF, kiểm quyền mức route, ánh xạ sang core API (ẩn core khỏi Internet), rate limiting, chuẩn hóa lỗi. Khung ứng dụng NestJS được tạo ở Ngày 17.

## Hệ 3 repo

Clone cả ba repo **ngang hàng (sibling)** dưới cùng thư mục cha (ví dụ `D:\WorkSpace\FRT\PROJECT_PERSONAL\`):

```
car-dealership-web\
car-dealership-bff\    (repo này)
car-dealership-core\
```

## Chạy local

Yêu cầu: Node 24 LTS, pnpm.

```powershell
pnpm install

# Dev (watch)
pnpm start:dev
# Prod
pnpm build; pnpm start:prod   # node dist/main.js, mặc định cổng 3000

# Health (từ host)
curl.exe -i http://localhost:3000/health/live     # 200 + header X-Correlation-Id
curl.exe -i http://localhost:3000/health/ready    # 200
```

### Kiểm thử & chất lượng

```powershell
pnpm typecheck      # tsc --noEmit
pnpm test           # unit (vitest)
pnpm test:e2e       # e2e (vitest + supertest)
```

> **ESM-only:** NestJS 12 bỏ CommonJS, nên repo đặt `"type": "module"`, `tsconfig` dùng
> `NodeNext` (import nội bộ phải có đuôi `.js`). Test chạy bằng **vitest + @swc/core**
> (không dùng ts-jest/CommonJS). Logger là **pino** (JSON: `service`, `environment`,
> `Correlation_Id`). Correlation*Id dùng chung quy ước với Core_API: header
> `X-Correlation-Id`, regex `^[A-Za-z0-9*-]{1,128}$`.

Toàn hệ (DB, core, bff, web) chạy bằng Docker Compose từ repo `car-dealership-core` (`deploy/docker-compose.yml`).

## Tài liệu

Thiết kế/ERD/ADR/roadmap: spec `car-dealership-platform` trong Kiro. Source code là nguồn sự thật cuối cùng.
