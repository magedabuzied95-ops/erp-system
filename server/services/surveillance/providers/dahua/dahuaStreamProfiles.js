// Dahua Encode config -> generic stream profiles.
//
// This is where "sub stream" stops being a concept the rest of the system knows
// about. Everything above the adapter sees a LIST of playable streams with their
// real codec, resolution, frame rate and bitrate.
//
// WHAT THE REAL DEVICE TAUGHT US
// ------------------------------
// The first version of this file read every entry of MainFormat[] and
// ExtraFormat[] as a separate stream. On the reference recorder that produced
// SIX profiles for one channel, three of them sharing the key "0" — which would
// have made stream selection pick an arbitrary one of three identical entries
// and made two of them unaddressable.
//
// The arrays are not streams. They are RECORD-TRIGGER slots: index 0 is the
// general/timed configuration, 1 is motion-triggered, 2 is alarm-triggered. On
// the real device all three were byte-for-byte identical, because nobody had
// configured motion recording to differ. They describe the same camera encoded
// under different circumstances, not three things you can watch at once.
//
// What actually bounds the playable streams is MaxExtraStream, which the device
// reports separately. On this recorder it is 1, meaning exactly two addressable
// streams exist: RTSP subtype 0 and subtype 1. Confirmed independently by an
// RTSP DESCRIBE, which returned one video track.
//
// The architecture stays flexible: a device reporting MaxExtraStream=2 yields
// three profiles with keys 0, 1 and 2, with no change here.

import { normalizeStreamProfiles } from "../../surveillanceStreamProfiles.js";

/**
 * Which record-trigger slot to read the encoder settings from.
 *
 * Index 0 is the general/timed configuration — the one that applies when nothing
 * special is happening, and therefore the one that describes the stream you get
 * when you just connect and watch.
 */
const GENERAL_SLOT = 0;

const videoOf = (entry) => entry?.Video || {};

/**
 * Is this format slot enabled?
 *
 * The real firmware carries the flag as `VideoEnable` on the format entry, not
 * as `Video.enable` as the documentation suggested. Both are honoured, and only
 * an explicit false disables: treating a missing flag as disabled would have
 * dropped every stream on the real device, where neither key is present inside
 * `Video`.
 */
const isEnabled = (entry) => {
  if (entry?.VideoEnable === false) return false;
  if (videoOf(entry).enable === false) return false;
  return true;
};

/**
 * @param {object} encodeConfig  parsed `getConfig&name=Encode`, unwrapped
 * @param {number} channelIndex  zero-based, as Dahua indexes it
 * @param {object} options
 * @param {number} options.maxExtraStream  from getProductDefinition. Absent
 *        means "assume one", which matches every Dahua recorder seen so far and
 *        is the conservative direction: under-reporting a stream hides a
 *        feature, over-reporting produces a tile that cannot play.
 */
export const dahuaStreamProfiles = (encodeConfig = {}, channelIndex = 0, { maxExtraStream = 1 } = {}) => {
  const channel = Array.isArray(encodeConfig?.Encode) ? encodeConfig.Encode[channelIndex] : null;
  if (!channel) return [];

  const profiles = [];

  // ---- main stream: RTSP subtype 0 ----
  const main = (Array.isArray(channel.MainFormat) ? channel.MainFormat : [])[GENERAL_SLOT];
  if (main && isEnabled(main)) {
    const video = videoOf(main);
    if (Number(video.Width) && Number(video.Height)) {
      profiles.push({
        key: "0",
        label: "Main",
        codec: video.Compression,
        width: Number(video.Width),
        height: Number(video.Height),
        fps: Number(video.FPS) || 0,
        bitrateKbps: Number(video.BitRate) || 0,
        bitrateControl: video.BitRateControl,
      });
    }
  }

  // ---- extra streams: RTSP subtype 1..maxExtraStream ----
  //
  // The extra formats are indexed by record trigger exactly like the main ones,
  // so a device with two real extra streams exposes them as two channels'
  // worth of configuration, not as ExtraFormat[1] and ExtraFormat[2]. Until a
  // device that actually has more than one is available to read, only the
  // general slot of the first extra stream is claimed — and the loop is written
  // so that adding one is a data change.
  const extras = Array.isArray(channel.ExtraFormat) ? channel.ExtraFormat : [];
  const usableExtras = Math.max(0, Math.min(Number(maxExtraStream) || 0, 1));
  for (let stream = 0; stream < usableExtras; stream += 1) {
    const entry = extras[GENERAL_SLOT];
    if (!entry || !isEnabled(entry)) continue;
    const video = videoOf(entry);
    if (!Number(video.Width) || !Number(video.Height)) continue;
    profiles.push({
      key: String(stream + 1),
      label: usableExtras > 1 ? `Sub ${stream + 1}` : "Sub",
      codec: video.Compression,
      width: Number(video.Width),
      height: Number(video.Height),
      fps: Number(video.FPS) || 0,
      bitrateKbps: Number(video.BitRate) || 0,
      bitrateControl: video.BitRateControl,
    });
  }

  const normalized = normalizeStreamProfiles(profiles);

  // A duplicate key means two tiles would address the same stream while a third
  // stream became unreachable. It is a programming error, not a device quirk, so
  // it fails loudly rather than being silently de-duplicated.
  const keys = normalized.map((profile) => profile.key);
  if (new Set(keys).size !== keys.length) {
    throw new Error(`dahuaStreamProfiles produced duplicate keys: ${keys.join(",")}`);
  }

  return normalized;
};

/**
 * The snapshot profile, which is a separate encoder on this firmware.
 *
 * Reported so the UI can say what a snapshot will actually look like — on the
 * real device it is MJPEG 352x288 at 1 fps, which is not what anyone expects
 * from a "snapshot" button on a 1080-class recorder.
 */
export const dahuaSnapshotProfile = (encodeConfig = {}, channelIndex = 0) => {
  const channel = Array.isArray(encodeConfig?.Encode) ? encodeConfig.Encode[channelIndex] : null;
  const entry = (Array.isArray(channel?.SnapFormat) ? channel.SnapFormat : [])[GENERAL_SLOT];
  const video = videoOf(entry);
  if (!Number(video.Width)) return null;
  return {
    codec: video.Compression || null,
    width: Number(video.Width),
    height: Number(video.Height) || null,
    fps: Number(video.FPS) || null,
  };
};

/**
 * The RTSP path for a profile, given the ERP's 1-based channel number.
 *
 * Dahua indexes channels from 1 in RTSP and from 0 in the config API. Getting
 * that backwards silently returns the wrong camera, which is the kind of bug
 * only noticed once someone reviews footage of the wrong room.
 */
export const dahuaRtspPath = (channelNumber, profileKey) =>
  `/cam/realmonitor?channel=${Number(channelNumber) || 1}&subtype=${Number(profileKey) || 0}`;
