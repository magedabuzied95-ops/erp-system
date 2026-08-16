// Dahua Encode config -> generic stream profiles.
//
// This is where "sub stream" stops being a concept the rest of the system knows
// about. Dahua reports MainFormat and ExtraFormat arrays per channel; this
// translates them into the neutral profile list defined by
// surveillanceStreamProfiles.js, and everything above the adapter sees only
// "here are the playable streams on this channel, with their real resolution,
// frame rate and codec".
//
// That matters because the reference recorder caps ExtraFormat at CIF/7fps
// while a newer device may offer D1 or 720p there, and an NVR may expose three
// formats rather than two. Reading the numbers off the device makes all of those
// work without a code change; assuming them makes exactly one device work.
//
// `key` carries the RTSP `subtype` value, which is the only Dahua-specific thing
// that survives into the profile. The core never interprets it — it hands it
// back to the adapter when a stream is requested.

import { normalizeStreamProfiles } from "../../surveillanceStreamProfiles.js";

/**
 * Dahua's stream families and their RTSP subtype.
 *
 * MainFormat[0] and ExtraFormat[0] are the two every device has. ExtraFormat[1]
 * and [2] exist on devices that report MaxExtraStream > 1 — reading the array
 * rather than assuming two entries is what makes a three-profile device work.
 */
const FORMAT_FAMILIES = Object.freeze([
  { field: "MainFormat", subtypeBase: 0, label: "Main" },
  { field: "ExtraFormat", subtypeBase: 1, label: "Extra" },
]);

const videoOf = (entry) => entry?.Video || {};

/**
 * @param {object} encodeConfig  parsed `getConfig&name=Encode`, unwrapped
 * @param {number} channelIndex  zero-based, as Dahua indexes it
 */
export const dahuaStreamProfiles = (encodeConfig = {}, channelIndex = 0) => {
  const channel = Array.isArray(encodeConfig?.Encode) ? encodeConfig.Encode[channelIndex] : null;
  if (!channel) return [];

  const profiles = [];
  for (const family of FORMAT_FAMILIES) {
    const entries = Array.isArray(channel[family.field]) ? channel[family.field] : [];
    entries.forEach((entry, index) => {
      const video = videoOf(entry);
      // A format the device reports but has disabled is not a playable stream.
      // `Video.enable` is absent on some firmwares, so only an explicit false
      // excludes it — treating missing as disabled would drop working streams.
      if (video.enable === false || entry?.VideoEnable === false) return;

      const width = Number(video.Width) || 0;
      const height = Number(video.Height) || 0;
      if (!width || !height) return;

      profiles.push({
        // subtype=0 is main; extra formats are subtype 1, 2, ...
        key: String(family.subtypeBase === 0 ? 0 : family.subtypeBase + index),
        label: entries.length > 1 ? `${family.label} ${index + 1}` : family.label,
        codec: video.Compression,
        width,
        height,
        fps: Number(video.FPS) || 0,
        bitrateKbps: Number(video.BitRate) || 0,
      });
    });
  }

  // normalizeStreamProfiles drops anything without a key and normalises codec
  // names, so "H.265+" and "AI Coding" arrive as h265/h264 with a smart flag
  // rather than as strings nobody downstream can match on.
  return normalizeStreamProfiles(profiles);
};

/**
 * The RTSP path for a profile, given the ERP's 1-based channel number.
 *
 * Dahua indexes channels from 1 in RTSP and from 0 in the config API. Getting
 * that backwards silently returns the wrong camera, which is the kind of bug
 * that is only noticed once someone reviews footage of the wrong room.
 */
export const dahuaRtspPath = (channelNumber, profileKey) =>
  `/cam/realmonitor?channel=${Number(channelNumber) || 1}&subtype=${Number(profileKey) || 0}`;
