/**
 * Test image optimization pipeline with synthetic JPEG buffers at 2/5/10/20 MB.
 * Run: npx tsx scripts/test-image-optimize.ts
 */
import sharp from 'sharp';
import { optimizeImageBuffer, IMAGE_INPUT_MAX_BYTES } from '../lib/image-optimize.js';

const SIZES_MB = [2, 5, 10, 20] as const;

/** High-entropy noise JPEG scaled to approximate target byte size. */
async function makeTestJpeg(targetBytes: number): Promise<Buffer> {
  let side = Math.ceil(Math.sqrt(targetBytes / 2));
  let buf = Buffer.alloc(0);

  for (let attempt = 0; attempt < 10; attempt++) {
    buf = await sharp({
      create: {
        width: side,
        height: side,
        channels: 3,
        background: { r: 64, g: 128, b: 192 },
        noise: { type: 'gaussian', mean: 128, sigma: 50 + attempt * 3 },
      },
    })
      .jpeg({ quality: 100, mozjpeg: true })
      .toBuffer();

    if (buf.length >= targetBytes * 0.85) return buf;
    side = Math.min(Math.ceil(side * 1.25), 7000);
  }
  return buf;
}

async function main(): Promise<void> {
  console.log('Image optimization test\n');
  console.log(`Input max: ${IMAGE_INPUT_MAX_BYTES / 1024 / 1024} MB\n`);

  let passed = 0;
  let failed = 0;

  for (const mb of SIZES_MB) {
    const target = mb * 1024 * 1024;
    process.stdout.write(`${mb} MB target … `);
    try {
      const input = await makeTestJpeg(target);
      const inputMb = input.length / 1024 / 1024;
      if (inputMb < mb * 0.7) {
        console.log(`SKIP — could only generate ${inputMb.toFixed(2)} MB test file`);
        failed++;
        continue;
      }

      const result = await optimizeImageBuffer(input, { logPrefix: `[test:${mb}mb]` });
      const ratio = result.outputBytes / input.length;
      const ok =
        result.format === 'webp' &&
        result.outputBytes > 0 &&
        result.width <= 1600 &&
        ratio < 0.85; // meaningful reduction even for high-entropy noise

      if (ok) {
        console.log(
          `OK — ${inputMb.toFixed(2)} MB in → ${(result.outputBytes / 1024).toFixed(0)} KB WebP (${result.width}×${result.height}, −${((1 - ratio) * 100).toFixed(0)}%)`
        );
        passed++;
      } else {
        console.log(
          `FAIL — format=${result.format} out=${result.outputBytes} w=${result.width} ratio=${ratio.toFixed(2)}`
        );
        failed++;
      }
    } catch (err) {
      console.log(`FAIL — ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
