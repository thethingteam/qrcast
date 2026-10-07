# Spec Delta

## MODIFIED Requirements

### Requirement: Codec detection
While `detecting`, the receiver SHALL hand frames to its codecs in turn. The
first codec that decodes data from a frame SHALL become the locked codec: the
receiver SHALL emit a `lock` event with its name, enter `receiving`, give
every later frame only to that codec and release the other decoders.

#### Scenario: Single codec
- **WHEN** a receiver with only the cimbar codec sees its first decodable cimbar frame
- **THEN** it emits `lock` with codec `cimbar` and the state becomes `receiving`

#### Scenario: Two codecs
- **WHEN** a receiver has codecs A and B and the first frame that either decodes is decoded by B
- **THEN** it locks to B and codec A receives no further frames

#### Scenario: cimbar and QR, QR sender
- **WHEN** a receiver created with `[cimbar(), qr()]` films a QR sender
- **THEN** it emits `lock` with codec `qr` and `start` resolves with the sent body

#### Scenario: cimbar and QR, cimbar sender
- **WHEN** a receiver created with `[cimbar(), qr()]` films a cimbar sender
- **THEN** it emits `lock` with codec `cimbar` and `start` resolves with the sent body
