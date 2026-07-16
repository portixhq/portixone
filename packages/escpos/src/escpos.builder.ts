import { ESCPOS_COMMANDS } from './escpos.constants.js';
import type { EscposTextOptions } from './escpos.types.js';

const ALIGN_COMMAND = {
  left: ESCPOS_COMMANDS.ALIGN_LEFT,
  center: ESCPOS_COMMANDS.ALIGN_CENTER,
  right: ESCPOS_COMMANDS.ALIGN_RIGHT,
} as const;

/**
 * Builds ESC/POS byte sequences for a print job. Pure — does not talk to any
 * hardware or OS printer queue; that's `runtime/src/printer/drivers`.
 */
export class EscposBuilder {
  // INIT resets the printer; selecting WPC1252 up front makes the latin1 bytes
  // written by text() render as the intended accented characters (see
  // SELECT_CODEPAGE_WPC1252). Without it the printer falls back to its default
  // table and non-ASCII text prints as garbage.
  private chunks: Buffer[] = [ESCPOS_COMMANDS.INIT, ESCPOS_COMMANDS.SELECT_CODEPAGE_WPC1252];

  text(content: string, options: EscposTextOptions = {}): this {
    if (options.align) {
      this.chunks.push(ALIGN_COMMAND[options.align]);
    }
    if (options.bold) {
      this.chunks.push(ESCPOS_COMMANDS.BOLD_ON);
    }
    // latin1, not utf-8: the printer reads one byte per character against the
    // WPC1252 table selected in the constructor. utf-8 would send two bytes per
    // accented character and print mojibake.
    this.chunks.push(Buffer.from(content, 'latin1'), ESCPOS_COMMANDS.LINE_FEED);
    if (options.bold) {
      this.chunks.push(ESCPOS_COMMANDS.BOLD_OFF);
    }
    return this;
  }

  feed(lines = 1): this {
    for (let i = 0; i < lines; i += 1) {
      this.chunks.push(ESCPOS_COMMANDS.LINE_FEED);
    }
    return this;
  }

  cut(): this {
    this.chunks.push(ESCPOS_COMMANDS.CUT_PARTIAL);
    return this;
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
