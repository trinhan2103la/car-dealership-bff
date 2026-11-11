// Chuẩn bị ảnh cho seed Demo_Data catalog của Core (Ngày 92).
//
// Dùng (từ gốc repo BFF):  pnpm build ; node scripts/prepare-seed-images.mjs [--placeholders] [đường-dẫn-seed-demo]
//   đường-dẫn-seed-demo mặc định: ../car-dealership-core/seed/demo
//
// Với mỗi ảnh khai báo trong catalog.json:
//   - Có ảnh gốc seed/demo/source-images/{file}.(jpg|jpeg|png|webp): xử lý ảnh đó. manifest.json PHẢI có mục với
//     source + license (ảnh CC trên Wikimedia Commons hoặc ảnh tự chụp), thiếu thì script dừng.
//   - Không có ảnh gốc và có --placeholders: vẽ ảnh minh họa (tự tạo, CC0) và ghi mục manifest tương ứng.
//   - Không có ảnh gốc, không có --placeholders: dừng, báo tên file.
// Ảnh đi qua ĐÚNG ImageProcessor của BFF (bỏ EXIF, resize, WebP), xuất images/{file}-{sm|md|lg}.webp.
// Seed .NET nhờ vậy không cần thư viện xử lý ảnh.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const placeholders = args.includes('--placeholders');
const seedDir = resolve(args.find((a) => !a.startsWith('--')) ?? resolve(root, '../car-dealership-core/seed/demo'));

const PLACEHOLDER_SOURCE = 'Ảnh minh họa tự tạo bởi car-dealership-bff/scripts/prepare-seed-images.mjs';
const PLACEHOLDER_LICENSE = 'CC0-1.0';
const PLACEHOLDER_AUTHOR = 'car-dealership-platform';

function fail(message) {
  console.error(`prepare-seed-images: ${message}`);
  process.exit(1);
}

const processorPath = join(root, 'dist/admin/images/image-processor.js');
if (!existsSync(processorPath)) fail('chưa có dist/. Chạy `pnpm build` trước.');
const { ImageProcessor } = await import(pathToFileURL(processorPath).href);
const processor = new ImageProcessor();

const catalogPath = join(seedDir, 'catalog.json');
if (!existsSync(catalogPath)) fail(`không thấy ${catalogPath}`);
// catalog.json cho phép dòng chú thích `//` (seed .NET đọc với JsonCommentHandling.Skip).
const catalog = JSON.parse(
  readFileSync(catalogPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n'),
);

const imagesDir = join(seedDir, 'images');
const sourceDir = join(seedDir, 'source-images');
const manifestPath = join(imagesDir, 'manifest.json');
mkdirSync(imagesDir, { recursive: true });
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
const byFile = new Map(manifest.map((m) => [m.file, m]));

const PALETTE = { toyota: '#b3261e', honda: '#1d4f91', hyundai: '#2f6d5f' };
const escapeXml = (s) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Ảnh minh họa 1600×1000: nền theo màu Brand, hình xe đơn giản (ngang hoặc chính diện), tên xe. */
function placeholderSvg(brand, model, view) {
  const color = PALETTE[brand.slug] ?? '#444444';
  const car =
    view === 'side'
      ? `<g transform="translate(330 430)">
           <path d="M0 230 Q0 170 60 160 L250 140 Q330 60 470 50 L700 50 Q800 55 870 140 L960 160 Q1000 170 1000 230 L1000 270 L0 270 Z" fill="#f4f4f4"/>
           <path d="M290 145 Q360 80 470 75 L600 75 L600 145 Z M630 75 L700 75 Q780 80 830 145 L630 145 Z" fill="#9fb3c8"/>
           <circle cx="220" cy="270" r="80" fill="#222"/><circle cx="220" cy="270" r="35" fill="#999"/>
           <circle cx="790" cy="270" r="80" fill="#222"/><circle cx="790" cy="270" r="35" fill="#999"/>
         </g>`
      : `<g transform="translate(500 380)">
           <path d="M60 120 Q90 20 200 10 L400 10 Q510 20 540 120 L600 150 L600 330 L0 330 L0 150 Z" fill="#f4f4f4"/>
           <path d="M110 120 Q140 50 210 45 L390 45 Q460 50 490 120 Z" fill="#9fb3c8"/>
           <rect x="40" y="190" width="120" height="45" rx="18" fill="#ffe08a"/>
           <rect x="440" y="190" width="120" height="45" rx="18" fill="#ffe08a"/>
           <rect x="200" y="200" width="200" height="60" rx="10" fill="#333"/>
           <rect x="20" y="330" width="110" height="70" rx="14" fill="#222"/>
           <rect x="470" y="330" width="110" height="70" rx="14" fill="#222"/>
         </g>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#111"/></linearGradient></defs>
    <rect width="1600" height="1000" fill="url(#g)"/>
    <rect y="800" width="1600" height="200" fill="#000" opacity="0.25"/>
    ${car}
    <text x="80" y="150" font-family="Arial, Segoe UI, sans-serif" font-size="96" font-weight="700" fill="#fff">${escapeXml(`${brand.name} ${model.name}`)}</text>
    <text x="80" y="230" font-family="Arial, Segoe UI, sans-serif" font-size="44" fill="#fff" opacity="0.85">${escapeXml(view === 'side' ? 'Bên hông' : 'Phía trước')} · Ảnh minh họa (Demo)</text>
  </svg>`);
}

function findSource(file) {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const path = join(sourceDir, `${file}.${ext}`);
    if (existsSync(path)) return path;
  }
  return undefined;
}

let written = 0;
for (const brand of catalog.brands) {
  for (const model of brand.carModels) {
    for (const image of model.images) {
      const sourcePath = findSource(image.file);
      let input;
      if (sourcePath) {
        const entry = byFile.get(image.file);
        if (!entry?.source || !entry?.license || entry.source === PLACEHOLDER_SOURCE)
          fail(`${image.file}: có ảnh gốc nhưng manifest.json chưa ghi source và license của ảnh đó.`);
        input = readFileSync(sourcePath);
      } else if (placeholders) {
        const view = image.file.endsWith('-side') ? 'side' : 'front';
        input = await sharp(placeholderSvg(brand, model, view)).jpeg({ quality: 90 }).toBuffer();
        byFile.set(image.file, {
          file: image.file,
          source: PLACEHOLDER_SOURCE,
          license: PLACEHOLDER_LICENSE,
          author: PLACEHOLDER_AUTHOR,
        });
      } else {
        fail(`${image.file}: không có ảnh gốc trong source-images/. Thêm ảnh hoặc chạy với --placeholders.`);
      }

      const variants = await processor.process(input);
      for (const v of variants) writeFileSync(join(imagesDir, `${image.file}-${v.name}.webp`), v.buffer);
      written++;
      console.log(`  ${image.file}: ${variants.map((v) => `${v.name} ${v.width}x${v.height}`).join(', ')}`);
    }
  }
}

const sorted = [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(manifestPath, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`Đã xử lý ${written} ảnh -> ${imagesDir}`);
