# Spec Delta

## ADDED Requirements

### Requirement: unsupported-environment details
An `unsupported-environment` error SHALL carry the `feature` that is missing:
`worker`, `webassembly`, `webgl` or `video-frame`. Later changes MAY add
feature names.

#### Scenario: Details of a missing feature
- **WHEN** receiving fails because the browser has no `VideoFrame`
- **THEN** the details are `feature` = `video-frame`

### Requirement: codec-init-failed details
A `codec-init-failed` error SHALL carry the name of the codec (`codec`)
whose worker, script or wasm failed to load or start, and SHALL keep the
underlying error as `cause` when there is one.

#### Scenario: Details of a failed load
- **WHEN** the cimbar wasm cannot be fetched
- **THEN** the details are `codec` = `cimbar`

### Requirement: codec-aborted details
A `codec-aborted` error SHALL carry the codec name (`codec`) and the `role`
of the instance that aborted. For role `sender` it SHALL carry the envelope
size in bytes (`size`); for role `receiver`, the last reported progress
fraction (`progress`), or `null` when none was reported.

#### Scenario: Details of a receiver abort
- **WHEN** a cimbar receiver instance aborts after reporting a progress of 0.4
- **THEN** the details are `codec` = `cimbar`, `role` = `receiver`, `progress` = 0.4

### Requirement: cancelled details
A `cancelled` error SHALL carry a `reason`: `stopped` when the app stopped
or restarted the transfer, `destroyed` when it destroyed the sender or
receiver.

#### Scenario: Details of a destroyed receiver
- **WHEN** a pending `start` is rejected because the receiver was destroyed
- **THEN** the details are `reason` = `destroyed`

### Requirement: invalid-state details
An `invalid-state` error SHALL carry the `state` the sender or receiver was
in when the call was refused.

#### Scenario: Details of a call on a destroyed sender
- **WHEN** `start` is called on a destroyed sender
- **THEN** the details are `state` = `destroyed`

## MODIFIED Requirements

### Requirement: invalid-input details
An `invalid-input` error SHALL carry a `reason`, one of `body`, `meta-field`,
`meta-too-large`, `codec` or `option`. For `meta-too-large` it SHALL also
carry the encoded meta size (`size`) and the limit (`limit`). `option` SHALL
mean that an option passed to a sender, receiver or codec factory is missing
or invalid.

#### Scenario: Details of an oversized meta
- **WHEN** wrapping fails because the encoded meta is 5010 bytes
- **THEN** the details are `reason` = `meta-too-large`, `size` = 5010, `limit` = 4096

#### Scenario: Details of an invalid option
- **WHEN** `cimbar({ mode: '8C' })` is called
- **THEN** the details are `reason` = `option`
