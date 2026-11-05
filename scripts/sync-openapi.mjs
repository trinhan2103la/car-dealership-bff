// Copy openapi.json từ repo core-api anh em vào bản vendored rồi sinh lại kiểu.
// Dùng: pnpm sync-openapi [đường-dẫn-tới-openapi.json]   (mặc định ../car-dealership-core/openapi/openapi.json)
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.argv[2] ?? resolve(root, '../car-dealership-core/openapi/openapi.json'));
const target = resolve(root, 'openapi/core-api.openapi.json');

if (!existsSync(source)) {
  console.error(`Không thấy ${source}. Clone car-dealership-core cạnh repo này hoặc truyền đường dẫn.`);
  process.exit(1);
}

copyFileSync(source, target);
console.log(`Đã copy ${source} -> ${target}`);

const result = spawnSync('pnpm', ['generate:types'], { cwd: root, stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
