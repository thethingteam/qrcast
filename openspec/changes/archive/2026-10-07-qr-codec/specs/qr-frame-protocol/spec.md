# Spec Delta

## Purpose

Defines the wire format of the QR codec: the text of each QR frame, the
systematic fountain code that lets a receiver recover from missed frames in
any order, and how frames fill the layers of a color picture. Any change to
it is a breaking change.

## ADDED Requirements

### Requirement: Frame text
Each QR frame SHALL be the text
`QRCAST1F/<SESSION>/<INDEX>/<TOTAL>/<LENGTH>/<CRC32>/<PAYLOAD>`, using only
the QR alphanumeric characters `0-9 A-Z space $ % * + - . / :`. `QRCAST`
names the family, `1` the version and `F` the fountain mode. A receiver
SHALL split the fields at the first six `/` only, because the payload may
contain `/`.

#### Scenario: Source frame header
- **WHEN** a sender with session `K3Z9QA` sends 1000 bytes in 400-byte blocks (3 blocks) and makes frame 1
- **THEN** the text starts with `QRCAST1F/K3Z9QA/1/3/RS/`, followed by 8 uppercase hex digits, `/`, and the Base45 text of 400 bytes

#### Scenario: Payload containing a slash
- **WHEN** the Base45 payload of a frame contains `/`
- **THEN** the receiver takes all text after the sixth `/` as the payload, and it decodes to the sent block

### Requirement: Frame fields
`SESSION` SHALL be 6 characters from `0-9 A-Z`, chosen at random for each
transfer. `INDEX`, `TOTAL` and `LENGTH` SHALL be uppercase base36 numbers of
1 to 8 characters, written without leading zeros. `TOTAL` is the number of
source blocks, `LENGTH` the byte length of the coded data. `CRC32` SHALL be
the CRC-32 (IEEE 802.3) of the coded data as 8 uppercase hex digits.
`PAYLOAD` SHALL be the Base45 (RFC 9285) text of exactly one block.

#### Scenario: Fields of a transfer
- **WHEN** a sender codes the 9 ASCII bytes `123456789` in 4-byte blocks
- **THEN** every frame has `TOTAL` = `3`, `LENGTH` = `9` and `CRC32` = `CBF43926`, and every payload decodes to 4 bytes

#### Scenario: New session per transfer
- **WHEN** the same bytes are sent twice, one transfer after the other
- **THEN** the two transfers use different `SESSION` values

### Requirement: Invalid frames
A receiver SHALL ignore a QR code that is not a valid frame, without losing
data it already has. Invalid means: a field is missing or malformed, a
character is outside the alphanumeric set, the first 8 characters are not
`QRCAST1F`, `TOTAL` is 0 or above 5000, `LENGTH` is 0, the payload is empty
or not valid Base45, or `ceil(LENGTH / P)` differs from `TOTAL`, where `P` is
the payload's byte length.

#### Scenario: Length and total disagree
- **WHEN** a receiver reads a frame with `TOTAL` 3, `LENGTH` 2000 and a 400-byte payload
- **THEN** the frame is ignored and does not lock the codec

#### Scenario: Too many blocks
- **WHEN** a receiver reads a frame with `TOTAL` 5001
- **THEN** the frame is ignored

#### Scenario: Other QR code in view
- **WHEN** a receiver reads a QR code whose text is `https://example.com/`
- **THEN** it is ignored

#### Scenario: Reserved version or mode
- **WHEN** a receiver reads an otherwise valid frame that starts with `QRCAST2F/` or `QRCAST1X/`
- **THEN** it is ignored

### Requirement: Frames that disagree with their session
Within one `SESSION`, a receiver SHALL ignore a frame whose `TOTAL`,
`LENGTH`, `CRC32` or payload length differs from those of the first valid
frame it accepted for that session.

#### Scenario: Different payload length in the same session
- **WHEN** a receiver has accepted frames of session `K3Z9QA` with 400-byte payloads and then reads a frame of `K3Z9QA` with a 300-byte payload
- **THEN** that frame is ignored

### Requirement: Source blocks
The sender SHALL split the coded data into `TOTAL` blocks of the block size,
padding the last block with zero bytes. A frame with `INDEX` below `TOTAL`
SHALL carry source block `INDEX`. After rebuilding the blocks, the receiver
SHALL join them in index order and cut the result to `LENGTH` bytes.

#### Scenario: Padding of the last block
- **WHEN** 1000 bytes are coded in 400-byte blocks
- **THEN** there are 3 blocks of 400 bytes, the last 200 bytes of block 2 are zero, and the receiver cuts the joined blocks back to 1000 bytes

### Requirement: Repair frames
A frame with `INDEX` of `TOTAL` or more SHALL carry the byte-wise XOR of the
source blocks in its composition. The composition depends only on `SESSION`,
`INDEX` and `TOTAL`, so the sender and the receiver compute the same one, as
the next requirement defines.

#### Scenario: Repair payload
- **WHEN** the composition of a repair frame is blocks 0, 1, 5 and 6
- **THEN** its payload is block 0 XOR block 1 XOR block 5 XOR block 6

### Requirement: Repair composition
The seed `s` SHALL be the CRC-32 of the ASCII text `<SESSION>/<INDEX>`, with
`INDEX` in uppercase base36 without leading zeros. From `s`, a mulberry32
generator (unsigned 32-bit arithmetic) SHALL produce one output for each
`j` from 0 to `TOTAL - 1`. Block `j` is in the composition when the top bit
of the `j`-th output is set. When no block is, the composition is block
`s mod TOTAL` alone.

#### Scenario: Known composition
- **WHEN** the composition of `INDEX` 8 is computed for session `K3Z9QA` and `TOTAL` 8
- **THEN** the seed is `0xB18D40B8` and the composition is blocks 0, 1, 5 and 6

#### Scenario: Single block
- **WHEN** `TOTAL` is 1
- **THEN** every repair frame's composition is block 0, and its payload equals the source block

### Requirement: mulberry32 steps
For each output, the generator SHALL do these steps, all in unsigned 32-bit
arithmetic. The state `x` starts at `s`. First `x = x + 0x6D2B79F5`. Then
`t = imul(x ^ (x >>> 15), x | 1)` and `t = t ^ (t + imul(t ^ (t >>> 7), t | 61))`.
The output is `t ^ (t >>> 14)`.

#### Scenario: First output
- **WHEN** the generator starts from seed 0
- **THEN** its first two outputs are `0x4434B462` and `0x00159C37`

### Requirement: Frame schedule
The sender SHALL play frames in passes. Each pass shows every source frame
in index order, with one repair frame after every 4 source frames and after
the last source frame of a pass when it does not end a group of 4. Repair
frame indexes SHALL start at `TOTAL` and grow by one with each repair frame,
across passes, so no repair index repeats.

#### Scenario: Ten blocks
- **WHEN** a transfer has `TOTAL` 10
- **THEN** the first pass plays indexes 0 1 2 3 10 4 5 6 7 11 8 9 12, and the second pass plays 0 1 2 3 13 4 5 6 7 14 8 9 15

### Requirement: Fountain decoding
A receiver SHALL treat source and repair frames as equations over GF(2) on
the source blocks and solve them in whatever order they arrive. A repeated
`INDEX`, or a repair frame that adds no new information, SHALL NOT count as
progress. The receiver SHALL finish as soon as every block is determined.

#### Scenario: Repair frame fills a gap
- **WHEN** a receiver of an 8-block session misses source block 5 but receives the other 7 source blocks and the repair frame made of blocks 0, 1, 5 and 6
- **THEN** it rebuilds block 5 and finishes without waiting for block 5 to play again

#### Scenario: Repair frames only
- **WHEN** a receiver gets no source frame at all, only repair frames, until they determine every block
- **THEN** it finishes, and the rebuilt data equals the coded data byte for byte

#### Scenario: Repair frame without new information
- **WHEN** a receiver has source blocks 0, 1, 5 and 6 and then reads a repair frame made of blocks 0, 1, 5 and 6
- **THEN** its progress does not change

### Requirement: Integrity check
After rebuilding the data, the receiver SHALL compare its CRC-32 with
`CRC32`. Only data that matches SHALL be passed on.

#### Scenario: Matching data
- **WHEN** every block of a session is determined and the CRC-32 of the rebuilt data equals the frames' `CRC32`
- **THEN** the data is passed on as the received file

### Requirement: Black and white pictures
With one layer, each picture SHALL show one frame as a QR code with dark
modules black and light modules white.

#### Scenario: One frame per picture
- **WHEN** a sender with one layer plays a transfer
- **THEN** each picture decodes as a single QR code carrying one frame, in schedule order

### Requirement: Color pictures
With three layers, picture `k` SHALL carry the frames at positions `3k`,
`3k+1` and `3k+2` of the schedule, in its red, green and blue channels.
The three QR codes SHALL have the same version and size. A dark module sets
its channel to 0, a light one to the maximum. A pass that does not fill its
last picture SHALL continue with the next pass's frames.

#### Scenario: Channel values
- **WHEN** a module is dark in the red and blue layers and light in the green layer
- **THEN** its pixel is pure green (red 0, green maximum, blue 0)

#### Scenario: Pass not a multiple of three
- **WHEN** a transfer with `TOTAL` 10 (13 frames per pass) plays with three layers
- **THEN** picture 4 carries the last frame of the first pass (index 12) in red and the first two frames of the second pass (indexes 0 and 1) in green and blue

#### Scenario: Quiet zone
- **WHEN** a color picture is drawn
- **THEN** it has a white border of at least 4 modules on every side
