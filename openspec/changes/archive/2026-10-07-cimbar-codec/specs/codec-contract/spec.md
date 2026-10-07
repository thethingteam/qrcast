# Spec Delta

## ADDED Requirements

### Requirement: Assets load only when used
A codec SHALL NOT fetch any wasm, script or worker file until a sender
starts with it or a receiver starts or preloads with it.

#### Scenario: Codec imported but never used
- **WHEN** an app imports a codec entry point, creates the codec and never starts a transfer
- **THEN** none of the codec's asset files is requested

### Requirement: Assets come from the package
By default, a codec SHALL resolve each asset relative to its own module, so
that a bundler that understands `new URL(path, import.meta.url)` copies the
asset into the app's build. The library SHALL NOT request any URL other than
these assets and the overrides the app passes.

#### Scenario: Offline after the first load
- **WHEN** an app has cached its own build, including the emitted codec assets, and runs without network access
- **THEN** a transfer works and no request is made to any host

### Requirement: Asset location overrides
A codec that loads assets SHALL accept options that replace the default
asset URLs and a `workerFactory` function that creates its workers, and
SHALL use them instead of the defaults when given.

#### Scenario: Custom worker factory
- **WHEN** a codec is created with a `workerFactory` and a transfer starts
- **THEN** every worker the codec uses comes from that factory
