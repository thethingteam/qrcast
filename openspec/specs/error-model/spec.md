# error-model Specification

## Purpose

Defines the single error type that qrcast raises, its stable codes and the
details each code carries, so that headless callers can react to failures in
code and write their own user-facing messages.

## Requirements

### Requirement: Single error type
Every failure that the library detects and reports SHALL be raised as a
`QrcastError`, which is an `Error` with a `code` string and a `details`
object. Its `message` SHALL be an English description for developers; the
library SHALL NOT produce text meant for end users.

#### Scenario: Error identity
- **WHEN** wrapping fails because the body is not a `Uint8Array`
- **THEN** the thrown value is an instance of both `QrcastError` and `Error`, its `code` is `invalid-input`, and its `details` is an object

#### Scenario: Wrapped platform failure
- **WHEN** unwrapping fails because the platform's decompressor rejects a corrupt body
- **THEN** the thrown value is a `QrcastError` with code `malformed-envelope`, and the platform error is kept as its `cause`

### Requirement: Stable error codes
Error codes SHALL be part of the public API: renaming or removing a code is a
breaking change. This change defines `payload-too-large`,
`unsupported-format`, `malformed-envelope` and `invalid-input`; later changes
MAY add codes.

#### Scenario: Caller switches on the code
- **WHEN** a caller compares `code` against `payload-too-large`
- **THEN** the comparison identifies the failure without parsing `message`

### Requirement: payload-too-large details
A `payload-too-large` error SHALL carry the envelope size in bytes (`size`),
the codec's limit (`limit`) and the codec name (`codec`).

#### Scenario: Details of an oversized payload
- **WHEN** a 1210-byte envelope is checked against a codec named `qr` with limit 1000
- **THEN** the details are `size` = 1210, `limit` = 1000, `codec` = `qr`

### Requirement: unsupported-format details
An `unsupported-format` error SHALL carry a `reason` (`magic`, `version`,
`flags` or `meta-length`) and the `value` that was seen: for `magic`, up to
the first 6 input bytes as lowercase hex; otherwise the number read.

#### Scenario: Details of an unknown version
- **WHEN** an envelope with version byte `0x02` is unwrapped
- **THEN** the details are `reason` = `version`, `value` = 2

#### Scenario: Details of an unknown magic
- **WHEN** the bytes `47 51 32 00 00 00 00` are unwrapped
- **THEN** the details are `reason` = `magic`, `value` = `475132000000`

### Requirement: malformed-envelope details
A `malformed-envelope` error SHALL carry a `reason`, one of `truncated`,
`meta-length`, `meta`, `body-size` or `compressed-body`.

#### Scenario: Details of a body size mismatch
- **WHEN** an uncompressed envelope with `s` = 10 and a 9-byte body is unwrapped
- **THEN** the details are `reason` = `body-size`

#### Scenario: Details of a decompression bomb
- **WHEN** a compressed body inflates past its declared `s`
- **THEN** the details are `reason` = `body-size`

### Requirement: invalid-input details
An `invalid-input` error SHALL carry a `reason`, one of `body`, `meta-field`,
`meta-too-large` or `codec`. For `meta-too-large` it SHALL also carry the
encoded meta size (`size`) and the limit (`limit`).

#### Scenario: Details of an oversized meta
- **WHEN** wrapping fails because the encoded meta is 5010 bytes
- **THEN** the details are `reason` = `meta-too-large`, `size` = 5010, `limit` = 4096

### Requirement: Details are typed by code
The public type of `QrcastError` SHALL tie each code to its details shape, so
that checking `code` narrows `details` in TypeScript.

#### Scenario: Narrowing in TypeScript
- **WHEN** TypeScript code checks `error.code === 'payload-too-large'`
- **THEN** reading `error.details.limit` inside that branch type-checks without a cast
