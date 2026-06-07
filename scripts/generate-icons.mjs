import { Resvg } from '@resvg/resvg-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICON_SIZES = [16, 32, 48, 128];
const VARIANTS = [
  { suffix: '', background: '#304f50', owl: 'beige' },
  { suffix: '-grey', background: '#6f6f6f', owl: '#dcdcdc' },
];

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(rootDir, 'assets', 'owl.svg');
const outputDir = path.join(rootDir, 'public', 'icons');

function svgForVariant(svg, variant) {
  return svg
    .replace(/#304f50/gi, variant.background)
    .replace(/fill: beige/g, `fill: ${variant.owl}`);
}

function renderPng(svg, size) {
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    shapeRendering: 2,
  }).render().asPng();
}

const svg = await readFile(sourcePath, 'utf8');
await mkdir(outputDir, { recursive: true });

for (const variant of VARIANTS) {
  const variantSvg = svgForVariant(svg, variant);
  for (const size of ICON_SIZES) {
    const png = renderPng(variantSvg, size);
    await writeFile(path.join(outputDir, `icon${size}${variant.suffix}.png`), png);
  }
}
