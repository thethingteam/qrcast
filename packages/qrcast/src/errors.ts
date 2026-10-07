import type { ReceiverState, SenderState } from './states.js';

/** A browser feature a codec needs. Later versions may add names. */
export type EnvironmentFeature = 'worker' | 'webassembly' | 'webgl' | 'video-frame';

/**
 * Details carried by each error code. Codes are public API: renaming or
 * removing one is a breaking change.
 */
export interface ErrorDetails {
  /**
   * The complete envelope (after any compression) is larger than the codec
   * can carry. Raised before any encoding work starts.
   */
  'payload-too-large': {
    /** Envelope size in bytes. */
    size: number;
    /** The codec's `maxPayloadSize` in bytes. */
    limit: number;
    /** The codec name. */
    codec: string;
  };
  /**
   * The input is not a payload this version of qrcast understands: unknown
   * magic, envelope version, reserved flag bit, or a meta length above the
   * cap. The receiver does not guess.
   */
  'unsupported-format':
    | {
        reason: 'magic';
        /** Up to the first 6 input bytes, as lowercase hex. */
        value: string;
      }
    | {
        reason: 'version' | 'flags' | 'meta-length';
        /** The version, flags value or meta length that was read. */
        value: number;
      };
  /**
   * The input starts like a supported envelope but is otherwise invalid:
   * truncated, bad meta, a corrupt compressed body, or a body whose size
   * differs from the declared one.
   */
  'malformed-envelope': {
    reason: 'truncated' | 'meta-length' | 'meta' | 'body-size' | 'compressed-body';
  };
  /**
   * The caller (or a codec) passed a value the library cannot use. `option`
   * means an option given to a sender, receiver or codec factory is missing
   * or invalid.
   */
  'invalid-input':
    | {
        reason: 'body' | 'meta-field' | 'codec' | 'option';
      }
    | {
        reason: 'meta-too-large';
        /** Encoded meta size in bytes. */
        size: number;
        /** The meta size cap in bytes. */
        limit: number;
      };
  /** The browser lacks a feature the codec needs. Raised before any asset loads. */
  'unsupported-environment': {
    feature: EnvironmentFeature;
  };
  /** A codec's worker, script or wasm failed to load or start. */
  'codec-init-failed': {
    /** The codec name. */
    codec: string;
  };
  /**
   * A codec's wasm instance aborted or threw (for example, out of memory).
   * The instance is discarded; a new transfer gets a fresh one.
   */
  'codec-aborted':
    | {
        codec: string;
        role: 'sender';
        /** Envelope size in bytes. */
        size: number;
      }
    | {
        codec: string;
        role: 'receiver';
        /** The last reported progress fraction, or `null` before any progress. */
        progress: number | null;
      };
  /** A pending call was ended by `stop` or a restart (`stopped`), or by `destroy`. */
  cancelled: {
    reason: 'stopped' | 'destroyed';
  };
  /** The call is not allowed in the sender's or receiver's current state. */
  'invalid-state': {
    state: SenderState | ReceiverState;
  };
}

/** Every error code the library can raise. */
export type ErrorCode = keyof ErrorDetails;

/** A {@link QrcastError} with one specific code. */
export interface QrcastErrorOf<C extends ErrorCode> extends Error {
  readonly name: 'QrcastError';
  readonly code: C;
  readonly details: ErrorDetails[C];
}

/**
 * The error type raised by qrcast. Checking `code` narrows `details`:
 *
 * ```ts
 * if (error instanceof QrcastError && error.code === 'payload-too-large') {
 *   console.log(error.details.limit);
 * }
 * ```
 */
export type QrcastError = { [C in ErrorCode]: QrcastErrorOf<C> }[ErrorCode];

export interface QrcastErrorConstructor {
  new <C extends ErrorCode>(
    code: C,
    details: ErrorDetails[C],
    message: string,
    options?: { cause?: unknown },
  ): QrcastErrorOf<C>;
  readonly prototype: QrcastError;
}

// The class is typed through QrcastErrorConstructor so that `instanceof`
// narrows to the union of all codes instead of an unnarrowable generic.
export const QrcastError: QrcastErrorConstructor = class QrcastError extends Error {
  override readonly name = 'QrcastError';
  readonly code: ErrorCode;
  readonly details: ErrorDetails[ErrorCode];

  constructor(
    code: ErrorCode,
    details: ErrorDetails[ErrorCode],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.code = code;
    this.details = details;
  }
} as unknown as QrcastErrorConstructor;
