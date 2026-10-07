import { crc32Hex } from './crc32.js';
import { FountainDecoder } from './decoder.js';
import { parseFrame } from './frame.js';

/** Sessions decoded at once. */
const MAX_SESSIONS = 2;

export interface AssemblerHooks {
  /** The first valid frame was read. Called once. */
  onData(): void;
  /** The session that gained information last now holds this fraction. */
  onProgress(progress: number): void;
  /** A session was rebuilt and passed its integrity check. Called once. */
  onFile(bytes: Uint8Array): void;
}

interface Session {
  decoder: FountainDecoder;
  crc32: string;
  /** Value of the assembler's counter when the session last gained information. */
  gainedAt: number;
}

/**
 * Turns QR code texts into a file. It keeps up to two sessions, so a sender
 * that restarts with new bytes is followed without a prompt. Pure: no timers,
 * no browser APIs.
 */
export class Assembler {
  private readonly sessions = new Map<string, Session>();
  private counter = 0;
  private sawFrame = false;
  private done = false;

  constructor(private readonly hooks: AssemblerHooks) {}

  /** Takes the text of one QR code. Anything that is not a valid frame is ignored. */
  push(text: string): void {
    if (this.done) return;
    const frame = parseFrame(text);
    if (!frame) return;
    if (!this.sawFrame) {
      this.sawFrame = true;
      this.hooks.onData();
    }

    let session = this.sessions.get(frame.session);
    if (session && (!session.decoder.matches(frame) || session.crc32 !== frame.crc32)) return;
    if (!session) {
      if (this.sessions.size >= MAX_SESSIONS) this.evictStalest();
      session = { decoder: FountainDecoder.fromFrame(frame), crc32: frame.crc32, gainedAt: 0 };
      this.sessions.set(frame.session, session);
    }

    if (!session.decoder.accept(frame)) return;
    session.gainedAt = ++this.counter;
    const { decoder } = session;
    if (!decoder.isComplete) {
      this.hooks.onProgress(decoder.rank / decoder.total);
      return;
    }

    const bytes = decoder.assemble()!;
    if (crc32Hex(bytes) !== session.crc32) {
      // Most likely one bad frame. The sender keeps looping, so start over.
      this.sessions.delete(frame.session);
      this.hooks.onProgress(0);
      return;
    }
    this.done = true;
    this.hooks.onProgress(1);
    this.hooks.onFile(bytes);
  }

  private evictStalest(): void {
    let stalest: [string, Session] | undefined;
    for (const entry of this.sessions) if (!stalest || entry[1].gainedAt < stalest[1].gainedAt) stalest = entry;
    if (stalest) this.sessions.delete(stalest[0]);
  }
}
