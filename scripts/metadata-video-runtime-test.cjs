// Run in metadata-video-runtime.Dockerfile with this repository mounted read-only.
// Real FFmpeg + local range relay. Storage is a synthetic-file adapter, not R2.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process'), { Readable } = require('node:stream');
const ts = require('typescript'), sharp = require('sharp');
require('reflect-metadata');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true } }).outputText, filename);
const { MetadataVideoFrames, sourcePanels } = require('../apps/api/src/metadata-video-frames.ts');
const { compareCovers } = require('../apps/api/src/metadata-cover-image.ts');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-test-')), videoPath = path.join(dir, 'generic.mp4');
  try {
    execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=size=320x240:rate=12','-t','6','-c:v','libx264','-pix_fmt','yuv420p',videoPath]);
    const bytes = fs.readFileSync(videoPath); let requests = 0, read = 0;
    const reader = new MetadataVideoFrames({ readRange: async (key, range) => {
      assert.equal(key, 'fixture/original.mp4'); requests++;
      const match = /^bytes=(\d+)-(\d+)$/.exec(range); assert.ok(match);
      const start = Number(match[1]), end = Math.min(Number(match[2]), bytes.length - 1);
      const chunk = bytes.subarray(start, end + 1); read += chunk.length;
      return { Body: Readable.from([chunk]), ContentRange: `bytes ${start}-${end}/${bytes.length}`, ContentLength: chunk.length };
    }});
    const duration = await reader.duration('fixture/original.mp4'); assert.ok(Math.abs(duration - 6) < 0.1);
    const frames = [];
    for (const seconds of [0.5, 2.5, 4.5]) frames.push(await reader.frame('fixture/original.mp4', seconds));
    // Create cover from an independently extracted frame; do not use the scanner's output.
    const screenshot = execFileSync('ffmpeg', ['-v','error','-ss','2.5','-i',videoPath,'-frames:v','1','-f','image2pipe','-c:v','png','pipe:1']);
    const center = await sharp(screenshot).resize(160,120).toBuffer();
    const unrelated = await sharp({ create: { width: 160, height: 120, channels: 3, background: '#4b1414' } }).png().toBuffer();
    const collage = await sharp({ create: { width: 480, height: 120, channels: 3, background: 'white' } }).composite([{ input: unrelated,left:0,top:0 },{ input:center,left:160,top:0 },{ input:unrelated,left:320,top:0 }]).webp({quality:75}).toBuffer();
    const ranked = (await sourcePanels(collage)).map(p => ({ panel: p.label, score: compareCovers(p.image, frames[1]).score })).sort((a,b)=>b.score-a.score);
    assert.equal(ranked[0].panel, 'ช่อง 2/3 จากซ้าย'); assert.ok(ranked[0].score >= 80);
    assert.ok(requests >= 4); assert.ok(read > 0);
    const unavailable = new MetadataVideoFrames({ readRange: async () => { throw new Error('PRIVATE_STORAGE_CREDENTIAL'); } });
    await assert.rejects(unavailable.frame('missing.mp4', 1), error => !error.message.includes('PRIVATE_STORAGE_CREDENTIAL'));
    console.log(JSON.stringify({ result: 'METADATA_VIDEO_RUNTIME_OK', duration, frames: 3, matchedPanel: ranked[0].panel, score: ranked[0].score, rangeRequests: requests, bytesRead: read, actualStorage: false }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
