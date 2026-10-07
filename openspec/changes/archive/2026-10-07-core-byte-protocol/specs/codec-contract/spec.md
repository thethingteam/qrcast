# Spec Delta

## Purpose

Defines what every codec must report to the qrcast core, and how the core
uses it to apply the codec's compression policy and to refuse payloads that
the codec cannot carry before any encoding starts.

## ADDED Requirements

### Requirement: Codec descriptor
Every codec SHALL report a name (a non-empty string such as `cimbar` or `qr`),
a `maxPayloadSize` (a positive integer number of bytes, measured on the
complete envelope), and whether the envelope body is compressed for it.

#### Scenario: Descriptor values are readable
- **WHEN** a caller reads the name, `maxPayloadSize` and compression policy of a codec
- **THEN** each value is available without loading any wasm, worker or other asset

### Requirement: Invalid codec descriptor
Preparing a transfer SHALL fail with `invalid-input` when the codec's name is
not a non-empty string or its `maxPayloadSize` is not a positive safe integer.

#### Scenario: Zero limit
- **WHEN** a transfer is prepared for a codec whose `maxPayloadSize` is 0
- **THEN** it fails with `invalid-input`

### Requirement: Compression follows the codec
When a transfer is prepared, the envelope body SHALL be compressed (under the
envelope's keep-only-when-smaller rule) if and only if the codec asks for
compression.

#### Scenario: Codec without compression
- **WHEN** a body of 10000 zero bytes is prepared for a codec that does not ask for compression
- **THEN** the envelope's flags bit 0 is clear and its body part is the original 10000 bytes

#### Scenario: Codec with compression
- **WHEN** a body of 10000 zero bytes is prepared for a codec that asks for compression
- **THEN** the envelope's flags bit 0 is set

### Requirement: Size check before encoding
After building the envelope and before handing anything to the codec,
preparing a transfer SHALL compare the complete envelope size (after any
compression) with the codec's `maxPayloadSize` and fail with
`payload-too-large` when it is larger, reporting the size, the limit and the
codec name.

#### Scenario: Envelope over the limit
- **WHEN** a body of 2000 random bytes is prepared for a codec named `test` with `maxPayloadSize` 1000
- **THEN** it fails with `payload-too-large` reporting the envelope size, the limit 1000 and the codec `test`, and the codec receives nothing

#### Scenario: Envelope exactly at the limit
- **WHEN** a body is prepared for a codec whose `maxPayloadSize` equals the resulting envelope size
- **THEN** preparing succeeds and returns the envelope

#### Scenario: Compression brings the envelope under the limit
- **WHEN** a body of 10000 zero bytes is prepared for a codec that asks for compression and has `maxPayloadSize` 1000
- **THEN** preparing succeeds, because the limit is checked on the compressed envelope
