export const ESC = 0x1b;
export const GS = 0x1d;
export const LF = 0x0a;

export const ESCPOS_COMMANDS = {
  INIT: Buffer.from([ESC, 0x40]),
  // ESC t 16 — select character code table WPC1252 (Windows-1252). Paired with
  // latin1 byte encoding in EscposBuilder so accented Latin text (á é í ó ú ñ Ñ
  // ¿ ¡ °) prints correctly instead of UTF-8 mojibake. Verified on the SICAR
  // WL88S ("Generic / Text Only"), 2026-07-14. WPC1252 agrees with latin1 across
  // 0xA0–0xFF, which covers the full Spanish set.
  SELECT_CODEPAGE_WPC1252: Buffer.from([ESC, 0x74, 16]),
  CUT_FULL: Buffer.from([GS, 0x56, 0x00]),
  CUT_PARTIAL: Buffer.from([GS, 0x56, 0x01]),
  BOLD_ON: Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF: Buffer.from([ESC, 0x45, 0x00]),
  ALIGN_LEFT: Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER: Buffer.from([ESC, 0x61, 0x01]),
  ALIGN_RIGHT: Buffer.from([ESC, 0x61, 0x02]),
  LINE_FEED: Buffer.from([LF]),
} as const;
