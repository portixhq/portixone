import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

// Renders the real brand mark (assets/favicon.svg) into icon.ico, and a
// pending variant with a small amber badge, replacing the old flat-color
// placeholders systray2/node-notifier used before real branding existed.
const SIZES = [16, 24, 32, 48, 256];

const assetsDir = dirname(fileURLToPath(import.meta.url)).replace(/scripts$/, 'assets');
const svgPath = join(assetsDir, 'favicon.svg');

async function renderBase(size) {
  return sharp(svgPath).resize(size, size).png().toBuffer();
}

/** Same badge composition as the pending variant, just a different fill color — kept as one helper so all state icons stay visually consistent. */
async function renderBadged(size, color) {
  const base = await renderBase(size);
  const badgeRadius = Math.max(3, Math.round(size * 0.22));
  const cx = size - badgeRadius - Math.round(size * 0.04);
  const cy = badgeRadius + Math.round(size * 0.04);
  const badgeSvg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${cx}" cy="${cy}" r="${badgeRadius}" fill="${color}" stroke="#ffffff" stroke-width="${Math.max(1, badgeRadius * 0.18)}" />
    </svg>`,
  );
  return sharp(base)
    .composite([{ input: badgeSvg }])
    .png()
    .toBuffer();
}

const renderPending = (size) => renderBadged(size, '#d98a0a'); // amber — pairing needs attention
const renderOffline = (size) => renderBadged(size, '#c62828'); // red — runtime unreachable
const renderUpdating = (size) => renderBadged(size, '#1e6fd9'); // blue — update in progress

async function main() {
  const variants = {
    'icon.ico': renderBase,
    'icon-pending.ico': renderPending,
    'icon-offline.ico': renderOffline,
    'icon-updating.ico': renderUpdating,
  };

  for (const [fileName, render] of Object.entries(variants)) {
    const pngs = await Promise.all(SIZES.map(render));
    const ico = await pngToIco(pngs);
    const outPath = join(assetsDir, fileName);
    writeFileSync(outPath, ico);
    console.log(`Wrote ${outPath} (${ico.length} bytes)`);
  }
}

main();
