# demo-app Specification

## Purpose

The demo app lets a person try qrcast between two devices: pick a known
example or a file, tune the code for the screen, and check that the received
bytes are right.

## Requirements

### Requirement: Example catalog
The entry page SHALL list the examples as cards: plain text, JSON, GeoJSON,
an image, a random body and a custom file. Each example other than the custom
file SHALL have fixed bytes and a fixed name, so every device derives the same
content.

#### Scenario: Opening an example
- **WHEN** a person selects the GeoJSON card
- **THEN** the send page opens with the GeoJSON example loaded, and shows its name, size and short hash

#### Scenario: Receiving without choosing
- **WHEN** a person selects the receive card
- **THEN** the receive page opens, and it accepts any example or file

### Requirement: Integrity display
Both pages SHALL show a payload's size in bytes and the first 8 hex digits of
its SHA-256. The receive page SHALL compare the received bytes with a known
example, identified by the received name, and state whether they match.

#### Scenario: Matching example
- **WHEN** the receive page gets the bytes of the JSON example
- **THEN** it shows the same size and hash as the send page, and states that the bytes match the example

#### Scenario: Corrupted example
- **WHEN** the received bytes carry a known example's name but differ from it
- **THEN** the page states a mismatch and does not claim success

#### Scenario: Custom file
- **WHEN** the received name is not a known example
- **THEN** the page shows the size and hash only, with no match statement

### Requirement: Typed preview
The receive page SHALL preview what it received by type: text as text, JSON
formatted, GeoJSON drawn as vector shapes, and images as images. A preview
SHALL NOT request anything over the network.

#### Scenario: GeoJSON
- **WHEN** a GeoJSON file is received
- **THEN** its shapes are drawn on the page without a map layer or any request

#### Scenario: Unknown type
- **WHEN** the received type has no preview
- **THEN** the page shows the size, the hash and a download link

#### Scenario: Invalid JSON
- **WHEN** a received file is named as JSON but does not parse
- **THEN** the page shows the raw text and says it is not valid JSON

### Requirement: Screen-fit code display
The send page SHALL draw the code as large as the free screen area allows and
SHALL offer a full-screen mode.

#### Scenario: Phone portrait
- **WHEN** the send page runs on a phone in portrait
- **THEN** the code is as wide as the screen allows, without scrolling to see all of it

### Requirement: Density controls
The send page SHALL let a person change the code density of the chosen codec:
for QR the block size, for cimbar the mode. It SHALL show the current value
and its effect, and SHALL offer a preset for small screens.

#### Scenario: Sparser QR
- **WHEN** a person lowers the QR block size
- **THEN** the page shows the new value and the estimated frames per code and transfer time, and the next start uses it

#### Scenario: Small-screen preset
- **WHEN** a person selects the small-screen preset
- **THEN** the controls are set to the sparsest supported values for the chosen codec

### Requirement: Mobile layout
The demo pages SHALL be usable at phone width without horizontal scrolling,
with touch-sized controls, and SHALL follow the system light or dark theme.

#### Scenario: Narrow viewport
- **WHEN** a page is opened at 360 px wide
- **THEN** no horizontal scrollbar appears and every control can be used

### Requirement: Camera control
The receive page SHALL let a person close the camera as well as open it, and
closing it SHALL stop any receiving in progress and release the camera.
Starting to receive without an open camera SHALL open it.

#### Scenario: Closing the camera
- **WHEN** the camera is open and a person closes it
- **THEN** the camera stops, the preview clears and the button offers to open it again

#### Scenario: Starting without a camera
- **WHEN** a person starts receiving while the camera is closed
- **THEN** the page opens the camera and begins looking for a code

### Requirement: Visible state
Both pages SHALL show the current state in words, enable only the buttons
that apply to it, and show that a button press had an effect.

#### Scenario: Receiving
- **WHEN** receiving has started
- **THEN** the page says it is looking for a code, then that it is receiving with a percentage, and Start is disabled while Stop is enabled

#### Scenario: Stopped by the person
- **WHEN** a person stops receiving
- **THEN** the page says it stopped and shows no error

#### Scenario: Sending on a phone
- **WHEN** a person starts sending and the code is below the controls
- **THEN** the page brings the code into view and says it is showing the code

### Requirement: Live progress
While receiving, the page SHALL show the progress, the time since the first
code and, once enough has arrived to tell, the time left at the current pace.

#### Scenario: Progress under way
- **WHEN** a transfer is 50 % done after 10 s
- **THEN** the page shows about 10 s left

### Requirement: Speed figures
After a transfer the receive page SHALL show the time since the first code,
the number of bytes the codes carried (the compressed size) with the
compression ratio, and the transfer speed computed from those bytes. The
speed SHALL NOT be computed from the decompressed size, so that it can be
compared with the code's capacity.

#### Scenario: Compressible file
- **WHEN** a highly compressible file arrives
- **THEN** the page shows its size, the smaller number of bytes sent with the compression ratio, and a speed based on the bytes sent

#### Scenario: Incompressible file
- **WHEN** a file that does not compress arrives
- **THEN** the page shows that it was not compressible, and the speed equals the file size over the time

### Requirement: Camera choice and zoom
When the device offers more than one camera, the receive page SHALL let a
person choose which one to use, and switching SHALL NOT stop a transfer in
progress. When the open camera supports zoom, the page SHALL offer a zoom
control over the range the camera reports; otherwise it SHALL NOT show one.

#### Scenario: Several cameras
- **WHEN** the device has a wide, a main and a tele camera
- **THEN** the page lists them, and choosing one shows its picture

#### Scenario: One camera without zoom
- **WHEN** the device has one camera and it reports no zoom
- **THEN** no camera list and no zoom control are shown

#### Scenario: Zooming
- **WHEN** a person moves the zoom control on a camera that supports it
- **THEN** the camera zooms and the control shows the factor

### Requirement: Size and capture diagnostics
So that two devices can be tested under the same conditions, the send page
SHALL show the picture's own size and the number of screen pixels it is shown
at, and the receive page SHALL show the camera's resolution, the rate at which
the camera delivers pictures and the rate of received pictures that added
progress. The send page's code SHALL NOT be limited to a narrow column.

#### Scenario: Comparing both ends
- **WHEN** a code is playing on the sender and being received
- **THEN** the sender shows its picture size and its size on screen, and the receiver shows the camera resolution, the camera rate and the useful frames per second

#### Scenario: Large screen
- **WHEN** the send page runs on a screen taller than the narrow page column
- **THEN** the code may grow with the screen height instead of stopping at the column width
