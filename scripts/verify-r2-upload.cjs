// Run from the repository root. --apply-cors fixes only trailing slashes on
// the known production origin; --probe creates and aborts its own test upload.
require('../apps/api/node_modules/dotenv').config({ quiet: true });
const {
  S3Client, GetBucketCorsCommand, PutBucketCorsCommand,
  CreateMultipartUploadCommand, UploadPartCommand, AbortMultipartUploadCommand
} = require('../apps/api/node_modules/@aws-sdk/client-s3');
const { getSignedUrl } = require('../apps/api/node_modules/@aws-sdk/s3-request-presigner');
const { randomUUID } = require('node:crypto');
const origin = 'https://3x-storage.206.189.129.122.sslip.io';
const Bucket = process.env.R2_BUCKET;
const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_S3_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
});
async function main() {
  let { CORSRules: rules } = await client.send(new GetBucketCorsCommand({ Bucket }));
  console.log('Production origin allowed:', rules.some(rule => rule.AllowedOrigins?.includes(origin)));
  if (process.argv.includes('--apply-cors')) {
    const updated = rules.map(rule => ({ ...rule, AllowedOrigins: rule.AllowedOrigins.map(value => value === `${origin}/` ? origin : value) }));
    if (JSON.stringify(updated) !== JSON.stringify(rules)) {
      await client.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: updated } }));
    }
    rules = (await client.send(new GetBucketCorsCommand({ Bucket }))).CORSRules;
    if (!rules.some(rule => rule.AllowedOrigins?.includes(origin))) throw new Error('PRODUCTION_ORIGIN_MISSING');
    console.log('Production CORS verified');
  }
  if (!process.argv.includes('--probe')) return;
  const Key = `diagnostics/upload-probe-${randomUUID()}`;
  const { UploadId } = await client.send(new CreateMultipartUploadCommand({ Bucket, Key, ContentType: 'application/octet-stream' }));
  try {
    const url = await getSignedUrl(client, new UploadPartCommand({ Bucket, Key, UploadId, PartNumber: 1 }), { expiresIn: 120 });
    if (new URL(url).searchParams.has('x-amz-checksum-crc32')) throw new Error('UNEXPECTED_BODY_CHECKSUM');
    const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' } });
    console.log('Preflight:', preflight.status, 'origin match:', preflight.headers.get('access-control-allow-origin') === origin);
    if (!preflight.ok || preflight.headers.get('access-control-allow-origin') !== origin) throw new Error('PREFLIGHT_FAILED');
    const response = await fetch(url, { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/octet-stream' }, body: Buffer.from('3x-storage nonempty multipart verification') });
    const exposed = response.headers.get('access-control-expose-headers') || '';
    console.log('Upload:', response.status, 'ETag:', Boolean(response.headers.get('etag')), 'origin match:', response.headers.get('access-control-allow-origin') === origin, 'ETag exposed:', /etag/i.test(exposed));
    if (!response.ok || !response.headers.get('etag') || response.headers.get('access-control-allow-origin') !== origin || !/etag/i.test(exposed)) throw new Error('UPLOAD_FAILED');
  } finally {
    await client.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId }));
    console.log('Test multipart upload cleaned up');
  }
}
main().catch(error => { console.error('Verification failed:', error.name, error.message?.replace(/https?:\/\/\S+/g, '[URL]')); process.exitCode = 1; }).finally(() => client.destroy());
