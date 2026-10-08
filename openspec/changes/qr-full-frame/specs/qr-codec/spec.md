## ADDED Requirements

### Requirement: Whole capture is decoded
The receiver SHALL look for QR codes in the whole capture, at the capture's
own resolution, whatever its aspect ratio. It SHALL NOT crop the capture to a
region before decoding.

#### Scenario: Code near the edge of a landscape capture
- **WHEN** a receiver with `qr()` films a 1280×720 picture whose QR transfer is drawn 360 pixels wide in its bottom right corner, entirely outside the central 720×720 square
- **THEN** it locks to `qr` and the transfer completes byte for byte

#### Scenario: Color code near the edge of a landscape capture
- **WHEN** the same picture shows a transfer sent with `qr({ layers: 3 })`
- **THEN** it locks to `qr` and the transfer completes byte for byte

## MODIFIED Requirements

### Requirement: Color detection per capture
The receiver SHALL decide for each capture whether it is color, from the
average saturation of regions that together cover the whole capture: the
capture is color when any region reaches the threshold. Otherwise it SHALL
decode the capture once in grayscale; when it is color it SHALL decode the
red, green and blue channels separately, and a failure in one channel SHALL
NOT affect the others. The receiving codec ignores `layers`.

#### Scenario: Color sender
- **WHEN** a sender with `qr({ layers: 3 })` plays into a receiver with `qr()`
- **THEN** the transfer completes byte for byte

#### Scenario: Black and white sender
- **WHEN** a sender with `qr({ layers: 1 })` plays into a receiver with `qr({ layers: 3 })`
- **THEN** the transfer completes byte for byte

#### Scenario: Color code away from the center
- **WHEN** a color picture covers only a corner of the capture and the central 60 % of the capture is mostly gray
- **THEN** the capture is decoded as color
