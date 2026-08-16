# Dahua CGI fixtures

**These are MOCKS, not captures.**

No Dahua device has been contacted at any point. Every file here is constructed
from the published Dahua HTTP API response format and from the DH-XVR1B16-I
datasheet, so it is a *hypothesis about* the device rather than evidence *from*
it.

They exist so the parser, the stream-profile extractor and the probe
interpretation can be tested before a network path exists. They cannot tell us
whether the device answers these endpoints at all — only the first real probe
can, and that is Phase 2B-4.

## When the first real connection happens

Replace these files with the actual responses, and expect them to differ. The
likely differences, in rough order of probability:

1. **Missing endpoints.** The public Dahua HTTP API documentation is written for
   IP cameras. An entry-level XVR shares most of it and not all; some of these
   CGIs will answer `Error` or 400.
2. **`encode-config.txt`.** The values here encode the datasheet's claim that the
   sub stream is capped at CIF/7fps. The real device may be configured
   differently — a lower main-stream bitrate, a different codec, fewer enabled
   channels.
3. **Channel count.** `16` here; the real unit may have fewer channels enabled.
4. **Codec.** `H.264` is assumed for both streams because it is what browsers can
   play. The device supports H.265/H.265+/AI Coding and may well be configured
   for one of them, which changes the media strategy.

When the fixtures are replaced, the capability matrix in
`docs/surveillance-phase2a-connectivity-and-discovery.md` must be updated in the
same change — a fixture that no longer matches the documented expectation is the
signal that the documentation is now wrong.
