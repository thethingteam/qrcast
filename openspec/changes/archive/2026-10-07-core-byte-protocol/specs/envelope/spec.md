# Spec Delta

## Purpose

Defines the v1 envelope that wraps every qrcast transfer, so that any codec
carries the same bytes and any receiver can recognize, validate and unwrap
them without guessing.

## ADDED Requirements

### Requirement: Envelope layout
The library SHALL wrap every transfer in an envelope made of, in order: the
6 ASCII bytes `QRCAST`, one version byte `0x01`, one flags byte, the meta
length as an unsigned LEB128 varint, the meta as UTF-8 JSON, and the body.
Callers SHALL NOT see the envelope: they pass and receive body bytes only.

#### Scenario: Uncompressed envelope bytes
- **WHEN** the 3-byte body `01 02 03` is wrapped without compression and without type or name
- **THEN** the envelope is `51 52 43 41 53 54 01 00 07` followed by the ASCII text `{"s":3}` and then `01 02 03`

#### Scenario: Empty body
- **WHEN** an empty body is wrapped and then unwrapped
- **THEN** unwrapping returns an empty body and a meta size of 0

### Requirement: Meta content
Meta SHALL be a JSON object with the key `s` (the original, uncompressed body
size as a non-negative integer, always set by the library) and the optional
string keys `t` (a type hint, a MIME type is recommended) and `n` (a name).
The sender SHALL write the keys in the order `s`, `t`, `n` and omit absent
optional keys.

#### Scenario: Meta with type and name
- **WHEN** a 10-byte body is wrapped with type `application/json` and name `a.json`
- **THEN** the meta text is `{"s":10,"t":"application/json","n":"a.json"}`

#### Scenario: Meta without hints
- **WHEN** a 10-byte body is wrapped with neither type nor name
- **THEN** the meta text is `{"s":10}`

### Requirement: Unwrapped result
Unwrapping a valid envelope SHALL return the original body bytes exactly,
together with the meta as `size` (from `s`), and `type` and `name` when they
were present.

#### Scenario: Round trip with hints
- **WHEN** a body is wrapped with type `text/plain` and name `note.txt`, then unwrapped
- **THEN** the returned bytes equal the original body byte for byte, and the meta is `size` = body length, `type` = `text/plain`, `name` = `note.txt`

### Requirement: Unknown meta keys are ignored
A receiver SHALL accept meta that contains keys other than `s`, `t` and `n`,
and SHALL leave them out of the returned meta.

#### Scenario: Extra key from a newer sender
- **WHEN** an envelope whose meta is `{"s":3,"x":"future"}` is unwrapped
- **THEN** unwrapping succeeds and the returned meta contains only `size` = 3

### Requirement: Minimal meta length encoding
The sender SHALL encode the meta length as the shortest unsigned LEB128 form.
A receiver SHALL reject a meta length that uses a longer form than needed
with `malformed-envelope`.

#### Scenario: Two-byte length
- **WHEN** the encoded meta is 200 bytes long
- **THEN** the meta length is written as the two bytes `C8 01`

#### Scenario: Non-minimal length
- **WHEN** a receiver unwraps an envelope whose meta length is written as `87 00`
- **THEN** it fails with `malformed-envelope`

### Requirement: Meta size cap on send
The encoded meta SHALL be at most 4096 bytes. When the type and name would
make it larger, wrapping SHALL fail with `invalid-input` before any further
work, reporting the meta size and the limit.

#### Scenario: Name too long
- **WHEN** a body is wrapped with a 5000-character ASCII name
- **THEN** wrapping fails with `invalid-input` reporting a meta size above 4096 and the limit 4096

### Requirement: Meta size cap on receive
A receiver SHALL reject an envelope whose meta length is larger than 4096 with
`unsupported-format`, reporting the length it saw, without reading the meta.

#### Scenario: Oversized meta length
- **WHEN** a receiver unwraps an envelope whose meta length field says 5000
- **THEN** it fails with `unsupported-format` reporting the value 5000

### Requirement: Sender input validation
Wrapping SHALL fail with `invalid-input` when the body is not a `Uint8Array`,
or when a type or name is given that is not a string.

#### Scenario: Body is not bytes
- **WHEN** a plain array of numbers is passed as the body
- **THEN** wrapping fails with `invalid-input`

#### Scenario: Name is not a string
- **WHEN** a body is wrapped with the name `42` given as a number
- **THEN** wrapping fails with `invalid-input`

### Requirement: Magic check
A receiver SHALL reject input that does not start with the 6 bytes `QRCAST`
with `unsupported-format`, reporting the leading bytes it saw.

#### Scenario: Foreign payload
- **WHEN** a receiver unwraps bytes that start with the PNG signature `89 50 4E 47 0D 0A 1A 0A`
- **THEN** it fails with `unsupported-format` reporting the leading bytes `89504e470d0a`

#### Scenario: Input shorter than the magic
- **WHEN** a receiver unwraps the 3 bytes `51 52 43`
- **THEN** it fails with `unsupported-format`

### Requirement: Version check
A receiver SHALL accept only envelope version `0x01` and SHALL reject any
other version with `unsupported-format`, reporting the version it saw. It
SHALL NOT try to interpret the rest of the input.

#### Scenario: Future version
- **WHEN** a receiver unwraps an envelope whose version byte is `0x02`
- **THEN** it fails with `unsupported-format` reporting the version 2

### Requirement: Reserved flag bits
Flags bit 0 SHALL mean that the body is compressed. Bits 1 to 7 are reserved:
the sender SHALL write them as 0, and a receiver SHALL reject an envelope with
any reserved bit set with `unsupported-format`, reporting the flags value.

#### Scenario: Reserved bit set
- **WHEN** a receiver unwraps an envelope whose flags byte is `0x02`
- **THEN** it fails with `unsupported-format` reporting the flags value 2

### Requirement: Check order
A receiver SHALL check the fields in envelope order (magic, version, flags,
meta length, meta, body) and SHALL report the first failure it finds.

#### Scenario: Wrong version and reserved flags
- **WHEN** a receiver unwraps an envelope with version `0x02` and flags `0x80`
- **THEN** it fails with `unsupported-format` reporting the version, not the flags

### Requirement: Optional compression
When compression is requested, the sender SHALL compress the body with raw
DEFLATE (RFC 1951) and SHALL keep the compressed body, with flags bit 0 set,
only when it is strictly smaller than the original body. Otherwise it SHALL
send the original body with flags bit 0 clear.

#### Scenario: Compressible body
- **WHEN** a body of 10000 zero bytes is wrapped with compression requested
- **THEN** flags bit 0 is set, the body part is smaller than 10000 bytes, and meta `s` is 10000

#### Scenario: Incompressible body
- **WHEN** a body of 10000 random bytes is wrapped with compression requested
- **THEN** flags bit 0 is clear and the body part is the original 10000 bytes

#### Scenario: Compression not requested
- **WHEN** a body of 10000 zero bytes is wrapped without compression
- **THEN** flags bit 0 is clear and the body part is the original 10000 bytes

### Requirement: Bounded decompression
A receiver SHALL decompress a compressed body as a stream and SHALL stop with
`malformed-envelope` as soon as the output exceeds the meta size `s`, without
producing the rest of the output.

#### Scenario: Decompression bomb
- **WHEN** a receiver unwraps an envelope with `s` = 100 whose compressed body inflates to 100 MB
- **THEN** it fails with `malformed-envelope` instead of returning or holding the full 100 MB output

### Requirement: Malformed envelopes
A receiver SHALL fail with `malformed-envelope` when an envelope with a valid
magic, version and flags is otherwise invalid: it is truncated, the meta is not
valid UTF-8 or not a JSON object, `s` is missing or not a non-negative safe
integer, `t` or `n` is not a string, the compressed body is corrupt, or the
body length does not equal `s`.

#### Scenario: Truncated after the flags
- **WHEN** a receiver unwraps the 8 bytes `QRCAST 01 00` with nothing after them
- **THEN** it fails with `malformed-envelope`

#### Scenario: Meta is not an object
- **WHEN** a receiver unwraps an envelope whose meta text is `[3]`
- **THEN** it fails with `malformed-envelope`

#### Scenario: Missing size
- **WHEN** a receiver unwraps an envelope whose meta text is `{"t":"text/plain"}`
- **THEN** it fails with `malformed-envelope`

#### Scenario: Body shorter than declared
- **WHEN** a receiver unwraps an uncompressed envelope with `s` = 10 and a 9-byte body
- **THEN** it fails with `malformed-envelope`

#### Scenario: Corrupt compressed body
- **WHEN** a receiver unwraps an envelope with flags bit 0 set whose body is not valid raw DEFLATE data
- **THEN** it fails with `malformed-envelope`
