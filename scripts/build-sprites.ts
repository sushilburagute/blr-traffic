import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
await mkdir('public/sprites', { recursive: true });
const shapes = Array.from({ length: 6 }, (_, i) => {
  const w = [9, 18, 20, 20, 24, 24][i],
    h = [24, 30, 36, 36, 54, 48][i];
  return `<g transform="translate(${i * 64},0)"><rect x="${32 - w / 2}" y="${32 - h / 2}" width="${w}" height="${h}" rx="4" fill="white"/><rect x="${34 - w / 2}" y="${37 - h / 2}" width="${w - 4}" height="6" rx="2" fill="#253631"/><rect x="${34 - w / 2}" y="${22 + h / 2}" width="${w - 4}" height="4" rx="1" fill="#253631"/></g>`;
}).join('');
await sharp(
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="384" height="64">${shapes}</svg>`),
)
  .png()
  .toFile('public/sprites/vehicles.png');
await sharp(await readFile('public/icon.svg'))
  .resize(180, 180)
  .png()
  .toFile('public/apple-icon.png');
