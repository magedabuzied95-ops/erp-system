# Media Gateway — architecture after the real-device probe

> Branch `feature/surveillance-phase2`. Design + blocker report. **No media
> software installed, no stream started, no DVR setting touched.**

---

## What the probe changed

Phase 2A assumed the sub stream was H.264 and could be **remuxed** to the
browser with no transcoding. The real recorder is **H.265 on every channel and
both streams**, confirmed twice: the encoder config and an RTSP DESCRIBE
(`a=rtpmap:98 H265/90000`).

Browsers cannot play H.265 over WebRTC in any form we can rely on. So
**transcoding is mandatory**, and the "remux, never transcode" plan is dead.

The bitrates rescue it. The real numbers are far below the Phase 2A estimates:

| | Estimated | **Real** |
|---|---|---|
| Sub stream | 192 kbps | **80 kbps** @ 352×288, 7 fps |
| Main stream | 1536 kbps | **512 kbps** @ 960×1080, 15–25 fps |
| 16-grid ingest | 3.4 Mbps | **1.3 Mbps** |

Transcoding sixteen CIF streams at 80 kbps is a genuinely small job. The codec
is now the constraint; bandwidth is not.

---

## MediaMTX: re-evaluated, and the honest answer

**MediaMTX does not transcode.** It is an RTSP/WebRTC/HLS server that ingests,
muxes and distributes. Claiming otherwise would have been a design built on a
feature that does not exist, so the earlier "remux via MediaMTX" plan cannot
survive an all-H.265 source.

It is still the right distribution layer, for reasons that survive the change:

| Need | MediaMTX gives it |
|---|---|
| WebRTC/WHEP to the browser | yes, and this is the hard part to build |
| One pull, many viewers | yes — fan-out is native |
| On-demand start/stop | `runOnDemand` + `runOnDemandCloseAfter` |
| Auth hook per viewer | HTTP callback, which our ticket check plugs into |
| HLS fallback | automatic |

So the split is:

```
FFmpeg  = the codec bridge   (H.265 -> H.264). One process per active stream.
MediaMTX = session + distribution + auth + lifecycle.
```

MediaMTX runs the FFmpeg process itself via `runOnDemand`, which means we do not
write process supervision — the part most likely to leak processes.

### Rejected alternatives

- **FFmpeg straight to HLS on disk.** Writes segments to a disk at 74% and gives
  6–10 s latency. Live monitoring at ten seconds behind is not monitoring.
- **Our own WebRTC gateway.** Weeks of work to reimplement the one thing
  MediaMTX already does well.
- **Reconfigure the DVR to H.264.** Explicitly refused: it would change
  recording quality, retention and disk consumption on a working system.

---

## Architecture

```
Dahua XVR (H.265)
      │  RTSP/TCP 554, digest
      ▼
FFmpeg worker  ── decode H.265 → encode H.264 baseline, no audio
      │  RTSP push to localhost
      ▼
MediaMTX  ── path per (tenant, device, channel, profile)
      │        auth hook ──► ERP /api/internal/surveillance/media-auth
      ▼  WHEP (WebRTC)
   Browser
```

The browser receives a **path name and a 60-second ticket** — never an RTSP URL,
never a credential, never the device address. Unchanged from Phase 1.

### Where the FFmpeg process runs — the part that is not settled

The VPS **cannot reach `192.168.1.108`**. So media ingress must happen inside the
shop, and the gateway is not one box:

| Deployment | Ingest | Distribution | Status |
|---|---|---|---|
| **Now (proof)** | FFmpeg on the shop laptop | MediaMTX on the laptop | needs software installed |
| **Interim** | FFmpeg + MediaMTX on a shop device | relay via VPS | needs the transport decision |
| **SaaS target** | FFmpeg + MediaMTX inside the Edge Agent | relay via cloud | Phase 3 |

This is why MediaGateway and DeviceTransport stayed separate abstractions. The
gateway does not care which of these it is running in; only its configuration
changes.

---

## Stream selection — policy, not a hardcoded rule

Already implemented in `surveillanceStreamProfiles.js` and exercised by tests.
The device is an input, not an assumption:

```
selectStreamProfile({ profiles, purpose, tileCount, budgetKbps, allowTranscode })
```

On this recorder the outcome happens to be sub-for-grid and main-for-fullscreen,
but it is reached from the numbers. A recorder with a 720p second stream gets a
different answer with no code change — covered by a test.

`allowTranscode` is now the switch that makes an all-H.265 device usable at all.
With it false the selector refuses and the UI can say *why* ("this channel
records H.265, which browsers cannot play") instead of showing a dead tile.

---

## Resource protection

Sixteen CIF transcodes is small, but "small" is not a plan.

| Control | Value | Why |
|---|---|---|
| Max concurrent transcodes | **4** initially | one per vCPU pair, raised only with measurements |
| Per tenant | 4 | one tenant cannot starve another |
| Per device | 4 | one recorder cannot occupy the whole budget |
| Idle shutdown | 10 s after last viewer | `runOnDemandCloseAfter` |
| Startup timeout | 15 s | a stream that will not start must fail visibly |
| Crash cleanup | MediaMTX owns the child | no orphan supervision of our own |
| CPU guard | refuse new sessions above 80% sustained | degrade by refusing, not by stuttering |

FFmpeg settings for the grid: `-c:v libx264 -preset veryfast -tune zerolatency
-g 14 -an -b:v 128k`. Audio dropped — the encoder reports it disabled on every
channel anyway.

### Scale-up plan

**1 → 4 → 9 → 16, measuring at each step.** Never start at 16. The measurements
that matter: CPU per stream, RSS per process, time to first frame, and whether
latency stays under ~1 s.

---

## First live channel — the milestone

One channel, sub stream, in the Surveillance Center. Not sixteen.

```
XVR ch1 sub (H.265 352x288 7fps 80kbps)
  → FFmpeg → H.264
  → MediaMTX → WHEP
  → API authorization (ticket + capability + tenant)
  → browser <video>
```

Everything on the ERP side of that arrow already exists: the adapter reads the
profiles, the selector picks one, the API issues a plan, the guards and audit
are wired.

### 🔴 What blocks it

| Blocker | Detail | Needs |
|---|---|---|
| **No FFmpeg** | not installed anywhere — laptop or VPS | your approval to install locally |
| **No MediaMTX** | not installed | same |
| **VPS cannot reach the DVR** | media ingress must be in-shop | the transport decision from 2A |
| **Media gateway not implemented** | `MediaGateway` is still an abstract class with no concrete subclass | ~a day once the above exist |

None is a design problem. All four are "software that is not on a machine yet",
and the first two are a local, reversible install on the shop laptop for a
proof-of-concept.

---

## Deferred, deliberately

- **Playback.** The device advertises ONVIF `recording_service`,
  `search_service` and `replay_service`. That is a better read path than
  `mediaFileFind`, which allocates a handle on the recorder. Investigate the
  ONVIF Profile G path first, next phase.
- **NTP.** See the task below.

---

## Task: `DVR NTP disabled — playback clock drift risk`

**Status: open, needs an approved write.**

The recorder reports `NTP.Enable=false` with `TimeZone=2 (Cairo)`. Its clock is
free-running and will drift.

Playback searches are expressed in device-local time. A drifted clock returns
the wrong window silently — footage from 14:05 when 14:00 was asked for, with
nothing to indicate it. The parser already surfaces this as `clockTrusted:
false` so the UI can warn before a search.

The fix is one write: enable NTP against a reachable server. It is not done
because every write to this device is out of scope until approved individually.
