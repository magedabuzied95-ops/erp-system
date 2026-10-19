import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

/**
 * Image → 512-number fingerprint, so two photos of the same shoe land close
 * together even when nobody can read the model name off either of them.
 *
 * The network is the image tower of OpenAI's CLIP ViT-B/32 (MIT licence), int8
 * quantised, as exported to ONNX by Xenova for Transformers.js — see
 * server/models/README.md for the URL and sha256. It runs on the server's CPU;
 * nothing leaves the box.
 *
 * Runtime selection mirrors thermalLineartModel.js: the native onnxruntime
 * binary is built against glibc and the backend image is Alpine (musl), so when
 * it refuses to load we use the WebAssembly build (~0.6–1 s per image).
 */

const here = path.dirname(fileURLToPath(import.meta.url));

export const CLIP_MODEL_PATH = process.env.CLIP_IMAGE_MODEL
  ? path.resolve(process.env.CLIP_IMAGE_MODEL)
  : path.resolve(here, "..", "models", "clip_vit_b32_vision_int8.onnx");

// Written to ai_product_image_visual_index.embedding_model. Vectors from a
// different model are not comparable, so a new model must get a new id.
export const CLIP_MODEL_ID = "clip-vit-b32-int8";
export const CLIP_IMAGE_SIZE = 224;
export const CLIP_EMBEDDING_DIM = 512;
const CLIP_MEAN = [0.48145466, 0.4578275, 0.40821073];
const CLIP_STD = [0.26862954, 0.26130258, 0.27577711];

// The WASM heap holds ~400 MB while the session is open. Photo searches come in
// bursts, so the session is dropped after a quiet spell and rebuilt (~2 s) on
// the next photo.
const IDLE_RELEASE_MS = Math.max(60_000, Number(process.env.CLIP_IDLE_RELEASE_MS || 10 * 60_000));

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * CLIP preprocessing: shortest edge to 224 (bicubic), centre crop 224×224,
 * then per-channel (x/255 − mean) / std, planar CHW. Transparent product
 * cut-outs are laid on white first — the way a shopper sees them — instead of
 * on whatever colour sits under the alpha.
 *
 * @returns {Promise<Float32Array>} 3 × 224 × 224 values
 */
export const preprocessClipImage = async (buffer) => {
  if (!buffer?.length) throw new Error("clip_image_empty");
  const { data, info } = await sharp(buffer, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(CLIP_IMAGE_SIZE, CLIP_IMAGE_SIZE, { fit: "cover", position: "centre", kernel: "cubic" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== CLIP_IMAGE_SIZE || info.height !== CLIP_IMAGE_SIZE || info.channels !== 3) {
    throw new Error(`clip_preprocess_bad_shape:${info.width}x${info.height}x${info.channels}`);
  }
  const pixels = CLIP_IMAGE_SIZE * CLIP_IMAGE_SIZE;
  const out = new Float32Array(3 * pixels);
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      out[(channel * pixels) + index] = ((data[offset + channel] / 255) - CLIP_MEAN[channel]) / CLIP_STD[channel];
    }
  }
  return out;
};

export const l2Normalize = (vector) => {
  const out = Float32Array.from(vector);
  let sum = 0;
  for (let index = 0; index < out.length; index += 1) sum += out[index] * out[index];
  const norm = Math.sqrt(sum);
  if (!norm || !Number.isFinite(norm)) throw new Error("clip_embedding_zero_norm");
  for (let index = 0; index < out.length; index += 1) out[index] /= norm;
  return out;
};

const loadRuntime = async () => {
  if (process.env.CLIP_IMAGE_RUNTIME !== "web") {
    try {
      const ort = await import("onnxruntime-node");
      return { ort, name: "node", options: { executionProviders: ["cpu"], intraOpNumThreads: clamp(os.cpus().length - 2, 1, 4) } };
    } catch (error) {
      console.warn("[clip-embedder] native onnxruntime unavailable, using WebAssembly", {
        message: error?.message || String(error),
      });
    }
  }
  const ort = await import("onnxruntime-web");
  ort.env.wasm.numThreads = clamp(os.cpus().length - 2, 1, 4);
  return { ort, name: "web", options: { executionProviders: ["wasm"] } };
};

const defaultCreateSession = async () => {
  await fs.access(CLIP_MODEL_PATH);
  const runtime = await loadRuntime();
  const startedAt = Date.now();
  const session = await runtime.ort.InferenceSession.create(CLIP_MODEL_PATH, runtime.options);
  console.log("[clip-embedder] model loaded", { runtime: runtime.name, durationMs: Date.now() - startedAt });
  return {
    session,
    makeTensor: (data, dims) => new runtime.ort.Tensor("float32", data, dims),
  };
};

/**
 * One embedder = one model session and one queue. Runs are serialised: the
 * WASM session is single-flight and a burst of photos should not stack several
 * hundred MB of activations. `createSession` is injectable so tests can swap
 * the network for a fake.
 */
export const createClipImageEmbedder = ({ createSession = defaultCreateSession, idleReleaseMs = IDLE_RELEASE_MS } = {}) => {
  let queue = Promise.resolve();
  let sessionPromise = null;
  let idleTimer = null;
  let pending = 0;

  const getSession = () => {
    if (!sessionPromise) {
      sessionPromise = createSession().catch((error) => {
        sessionPromise = null;
        throw error;
      });
    }
    return sessionPromise;
  };

  const release = async () => {
    const current = sessionPromise;
    sessionPromise = null;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (!current) return;
    const loaded = await current.catch(() => null);
    await loaded?.session?.release?.().catch?.(() => {});
  };

  const armIdleRelease = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (!idleReleaseMs) return;
    idleTimer = setTimeout(() => {
      if (!pending) release().catch(() => {});
    }, idleReleaseMs);
    idleTimer.unref?.();
  };

  const embedImage = (buffer) => {
    const run = async () => {
      const pixels = await preprocessClipImage(buffer);
      const { session, makeTensor } = await getSession();
      const feeds = { [session.inputNames[0]]: makeTensor(pixels, [1, 3, CLIP_IMAGE_SIZE, CLIP_IMAGE_SIZE]) };
      const results = await session.run(feeds);
      const output = results.image_embeds || results[session.outputNames[0]];
      const vector = Float32Array.from(output.data).slice(0, CLIP_EMBEDDING_DIM);
      if (vector.length !== CLIP_EMBEDDING_DIM) throw new Error(`clip_embedding_bad_dim:${vector.length}`);
      return l2Normalize(vector);
    };
    pending += 1;
    const job = queue.then(run, run);
    queue = job.catch(() => {}).finally(() => {
      pending -= 1;
      armIdleRelease();
    });
    return job;
  };

  return { embedImage, release };
};

const defaultEmbedder = createClipImageEmbedder();

/** @returns {Promise<Float32Array>} 512 floats, unit length */
export const embedImage = (buffer) => defaultEmbedder.embedImage(buffer);
export const releaseClipImageEmbedder = () => defaultEmbedder.release();

export const isClipModelAvailable = async () => {
  try {
    await fs.access(CLIP_MODEL_PATH);
    return true;
  } catch {
    return false;
  }
};

export default {
  CLIP_MODEL_ID,
  CLIP_MODEL_PATH,
  embedImage,
  isClipModelAvailable,
  preprocessClipImage,
  l2Normalize,
};
