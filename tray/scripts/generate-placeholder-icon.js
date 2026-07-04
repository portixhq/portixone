import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Generates a minimal valid 16x16 32bpp .ico — a plain solid-color square.
// This is a functional placeholder so systray2 has an icon to load; swap
// `assets/icon.ico` for real branding whenever that work happens.
const SIZE = 16;
const [r, g, b] = [0x1a, 0x2b, 0x6b]; // dark blue, arbitrary

const iconDir = Buffer.alloc(6);
iconDir.writeUInt16LE(0, 0); // reserved
iconDir.writeUInt16LE(1, 2); // type: icon
iconDir.writeUInt16LE(1, 4); // image count

const xorSize = SIZE * SIZE * 4;
const andRowBytes = Math.ceil(SIZE / 32) * 4;
const andSize = andRowBytes * SIZE;
const bmpHeaderSize = 40;
const imageSize = bmpHeaderSize + xorSize + andSize;

const entry = Buffer.alloc(16);
entry.writeUInt8(SIZE, 0); // width
entry.writeUInt8(SIZE, 1); // height
entry.writeUInt8(0, 2); // color count
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bit count
entry.writeUInt32LE(imageSize, 8); // bytes in resource
entry.writeUInt32LE(6 + 16, 12); // image offset

const bmpHeader = Buffer.alloc(bmpHeaderSize);
bmpHeader.writeUInt32LE(bmpHeaderSize, 0);
bmpHeader.writeInt32LE(SIZE, 4); // width
bmpHeader.writeInt32LE(SIZE * 2, 8); // height (doubled: XOR + AND mask)
bmpHeader.writeUInt16LE(1, 12); // planes
bmpHeader.writeUInt16LE(32, 14); // bit count
bmpHeader.writeUInt32LE(0, 16); // compression: none
bmpHeader.writeUInt32LE(xorSize, 20); // image size

const xor = Buffer.alloc(xorSize);
for (let i = 0; i < SIZE * SIZE; i += 1) {
  xor.writeUInt8(b, i * 4);
  xor.writeUInt8(g, i * 4 + 1);
  xor.writeUInt8(r, i * 4 + 2);
  xor.writeUInt8(0xff, i * 4 + 3); // alpha
}

const and = Buffer.alloc(andSize, 0);

const ico = Buffer.concat([iconDir, entry, bmpHeader, xor, and]);

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon.ico'), ico);
console.log(`Wrote ${join(outDir, 'icon.ico')} (${ico.length} bytes)`);
