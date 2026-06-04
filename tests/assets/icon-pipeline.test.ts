import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ICON_SIZES = [16, 32, 48, 128] as const;
const PNG_SIGNATURE = '89504e470d0a1a0a';

interface PngImage {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  pixels: Buffer;
}

function parsePng(filePath: string): PngImage {
  const file = fs.readFileSync(filePath);
  expect(file.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.subarray(offset + 4, offset + 8).toString('ascii');
    const data = file.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  expect(channels).toBeGreaterThan(0);
  expect([8, 16]).toContain(bitDepth);

  const bytesPerSample = bitDepth / 8;
  const bytesPerPixel = channels * bytesPerSample;
  const stride = width * bytesPerPixel;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = inflated[rowStart];
    const row = inflated.subarray(rowStart + 1, rowStart + 1 + stride);
    const outStart = y * stride;
    const previousStart = (y - 1) * stride;

    for (let x = 0; x < stride; x += 1) {
      const raw = row[x];
      const left = x >= bytesPerPixel ? pixels[outStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[previousStart + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? pixels[previousStart + x - bytesPerPixel] : 0;

      let value: number;
      switch (filter) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + Math.floor((left + up) / 2);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          value = raw + predictor;
          break;
        }
        default:
          throw new Error(`Unsupported PNG filter ${filter}`);
      }

      pixels[outStart + x] = value & 0xff;
    }
  }

  return { width, height, bitDepth, colorType, pixels };
}

function readSample(buffer: Buffer, offset: number, bitDepth: number): number {
  return bitDepth === 16 ? buffer.readUInt16BE(offset) / 65535 : buffer[offset] / 255;
}

function meanSaturation(image: PngImage): number {
  const channels = image.colorType === 6 ? 4 : 3;
  const bytesPerSample = image.bitDepth / 8;
  const bytesPerPixel = channels * bytesPerSample;
  const totalPixels = image.width * image.height;
  let saturationSum = 0;
  let counted = 0;

  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    const offset = pixel * bytesPerPixel;
    const alpha = channels === 4
      ? readSample(image.pixels, offset + 3 * bytesPerSample, image.bitDepth)
      : 1;

    if (alpha === 0) continue;

    const r = readSample(image.pixels, offset, image.bitDepth);
    const g = readSample(image.pixels, offset + bytesPerSample, image.bitDepth);
    const b = readSample(image.pixels, offset + 2 * bytesPerSample, image.bitDepth);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    saturationSum += max === 0 ? 0 : (max - min) / max;
    counted += 1;
  }

  return counted === 0 ? 0 : saturationSum / counted;
}

describe('icon raster pipeline', () => {
  it.each(ICON_SIZES)('emits color and grey %ipx PNGs with grey measurably desaturated', (size) => {
    const colorPath = path.join(__dirname, '..', '..', 'public', 'icons', `icon${size}.png`);
    const greyPath = path.join(__dirname, '..', '..', 'public', 'icons', `icon${size}-grey.png`);

    expect(fs.existsSync(colorPath)).toBe(true);
    expect(fs.existsSync(greyPath)).toBe(true);

    const color = parsePng(colorPath);
    const grey = parsePng(greyPath);

    expect(color.width).toBe(size);
    expect(color.height).toBe(size);
    expect(grey.width).toBe(size);
    expect(grey.height).toBe(size);
    expect(meanSaturation(grey)).toBeLessThan(meanSaturation(color));
  });
});
