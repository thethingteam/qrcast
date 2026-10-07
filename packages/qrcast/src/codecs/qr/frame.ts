import { base45Decode, base45Encode } from './base45.js';

/**
 * A QR frame: `QRCAST1F/<SESSION>/<INDEX>/<TOTAL>/<LENGTH>/<CRC32>/<PAYLOAD>`.
 * - `INDEX` below `TOTAL` is a source block, otherwise a repair frame;
 * - `LENGTH` is the byte length of the coded data (cut to it after joining);
 * - the payload is the Base45 text of exactly one block, and may contain `/`,
 *   so the fields are split at the first six `/` only.
 */
export const FRAME_PREFIX = 'QRCAST1F';

/** Most source blocks a transfer may have. */
export const MAX_TOTAL_BLOCKS = 5000;

/** The QR alphanumeric character set. */
const ALPHANUMERIC_RE = /^[0-9A-Z $%*+\-./:]*$/;
const SESSION_RE = /^[0-9A-Z]{6}$/;
const BASE36_RE = /^(?:0|[1-9A-Z][0-9A-Z]{0,7})$/;
const CRC_RE = /^[0-9A-F]{8}$/;

export interface QrFrame {
  session: string;
  /** Zero-based frame number. */
  index: number;
  /** Number of source blocks. */
  total: number;
  /** Byte length of the coded data. */
  length: number;
  /** CRC-32 of the coded data, 8 uppercase hex digits. */
  crc32: string;
  /** Exactly one block. */
  payload: Uint8Array;
}

export const toBase36 = (n: number): string => n.toString(36).toUpperCase();

export function formatFrame(frame: QrFrame): string {
  return [
    FRAME_PREFIX,
    frame.session,
    toBase36(frame.index),
    toBase36(frame.total),
    toBase36(frame.length),
    frame.crc32,
    base45Encode(frame.payload),
  ].join('/');
}

/** Parses a frame text; anything that is not a valid frame gives `null`. */
export function parseFrame(text: string): QrFrame | null {
  if (!ALPHANUMERIC_RE.test(text)) return null;
  const fields: string[] = [];
  let start = 0;
  for (let i = 0; i < 6; i++) {
    const slash = text.indexOf('/', start);
    if (slash < 0) return null;
    fields.push(text.slice(start, slash));
    start = slash + 1;
  }
  const payloadText = text.slice(start);
  const [prefix, session, indexText, totalText, lengthText, crc32] = fields as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  if (prefix !== FRAME_PREFIX || !SESSION_RE.test(session) || !CRC_RE.test(crc32)) return null;
  if (!BASE36_RE.test(indexText) || !BASE36_RE.test(totalText) || !BASE36_RE.test(lengthText)) return null;
  if (payloadText.length === 0) return null;

  const index = parseInt(indexText, 36);
  const total = parseInt(totalText, 36);
  const length = parseInt(lengthText, 36);
  if (total < 1 || total > MAX_TOTAL_BLOCKS || length < 1) return null;

  let payload: Uint8Array;
  try {
    payload = base45Decode(payloadText);
  } catch {
    return null;
  }
  if (payload.length === 0 || Math.ceil(length / payload.length) !== total) return null;
  return { session, index, total, length, crc32, payload };
}
