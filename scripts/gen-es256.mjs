#!/usr/bin/env node
// Sinh cặp khóa ES256 (ECDSA P-256). Script chỉ in ra stdout, KHÔNG ghi file nên không có nguy cơ commit nhầm khóa.
// Biến môi trường khó chứa nhiều dòng: dùng dạng một dòng (xuống dòng thay bằng "\n").
//
// node scripts/gen-es256.mjs         Service_Credential BFF → Core_API.
//   - Khóa RIÊNG  -> secret BFF: SERVICE_JWT_PRIVATE_KEY
//   - Khóa CÔNG KHAI -> ĐỒNG BỘ THỦ CÔNG sang secret `car-dealership-core`: SERVICE_JWT_PUBLIC_KEY
//
// node scripts/gen-es256.mjs admin   Access token của Admin_Portal (BFF vừa ký vừa kiểm).
//   - Khóa RIÊNG  -> secret BFF: ADMIN_JWT_PRIVATE_KEY (KHÁC khóa Service_Credential). Không có gì gửi sang Core_API.
import { generateKeyPairSync } from 'node:crypto';

const admin = process.argv[2] === 'admin';
const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
});

const privatePem = privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString()
  .trim();
const publicPem = publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString()
  .trim();
const oneLine = (pem) => pem.replace(/\r?\n/g, '\\n');

console.log('# --- BFF secret (GIỮ BÍ MẬT, không commit) ---');
console.log(
  `${admin ? 'ADMIN_JWT_PRIVATE_KEY' : 'SERVICE_JWT_PRIVATE_KEY'}="${oneLine(privatePem)}"`,
);

if (!admin) {
  console.log('');
  console.log('# --- Core_API secret (khóa công khai, đồng bộ thủ công) ---');
  console.log(`SERVICE_JWT_PUBLIC_KEY="${oneLine(publicPem)}"`);
}
