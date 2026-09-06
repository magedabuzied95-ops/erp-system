import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getLineartRuntime } from "./thermalLineartModel.js";

/**
 * EfficientSAM (tiny) behind the "single item" step of the thermal artwork.
 *
 * Catalogue photos usually show the front shoe lying down with its pair
 * standing behind it, sole to the camera. The label wants one shoe. Given a
 * few points — inside the front shoe, one on the shoe behind — the model
 * returns the front shoe's mask, and everything else in the subject is
 * folded back into the backdrop before any drawing happens.
 *
 * Shares the ONNX runtime selection (native, else WebAssembly) with the
 * line-drawing model, and serialises its runs the same way.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

export const SEGMENT_MODEL_PATH = process.env.THERMAL_SEGMENT_MODEL
  ? path.resolve(process.env.THERMAL_SEGMENT_MODEL)
  : path.resolve(here, "..", "models", "efficientsam_ti.onnx");

let queue = Promise.resolve();
let sessionPromise = null;
let availability = null;

export const isSegmentModelAvailable = async () => {
  if (availability !== null) return availability;
  try {
    await fs.access(SEGMENT_MODEL_PATH);
    availability = true;
  } catch {
    availability = false;
  }
  return availability;
};

const getSession = async () => {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const runtime = await getLineartRuntime();
      const startedAt = Date.now();
      const session = await runtime.ort.InferenceSession.create(SEGMENT_MODEL_PATH, runtime.options);
      console.log("[thermal-segment] model loaded", { runtime: runtime.name, durationMs: Date.now() - startedAt });
      return { runtime, session };
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
};

/**
 * Segment from point prompts.
 *
 * @param {object} options
 * @param {Uint8Array} options.rgb  width*height*3 interleaved
 * @param {Array<[number, number, number]>} options.points  x, y, label (1 inside, 0 outside, 2/3 box corners)
 * @returns {Promise<{ masks: Uint8Array[], ious: number[], width: number, height: number, runtime: string, durationMs: number }>}
 *   Each mask is width*height bytes, 1 inside.
 */
export const segmentFromPoints = ({ rgb, width, height, points }) => {
  const run = async () => {
    const { runtime, session } = await getSession();
    const pixels = width * height;
    const image = new Float32Array(3 * pixels);
    for (let index = 0; index < pixels; index += 1) {
      const offset = index * 3;
      image[index] = rgb[offset] / 255;
      image[pixels + index] = rgb[offset + 1] / 255;
      image[(2 * pixels) + index] = rgb[offset + 2] / 255;
    }
    const coords = new Float32Array(points.length * 2);
    const labels = new Float32Array(points.length);
    // Labels pass through untouched: 1 inside, 0 outside, and 2 / 3 are the
    // top-left / bottom-right corners of a box prompt.
    points.forEach(([x, y, label], index) => {
      coords[index * 2] = x;
      coords[(index * 2) + 1] = y;
      labels[index] = Number(label) || 0;
    });
    const { ort } = runtime;
    const startedAt = Date.now();
    const results = await session.run({
      batched_images: new ort.Tensor("float32", image, [1, 3, height, width]),
      batched_point_coords: new ort.Tensor("float32", coords, [1, 1, points.length, 2]),
      batched_point_labels: new ort.Tensor("float32", labels, [1, 1, points.length]),
    });
    const logits = results.output_masks;
    const ious = Array.from(results.iou_predictions.data);
    const count = Number(logits.dims[2] || 1);
    const outHeight = Number(logits.dims[3] || height);
    const outWidth = Number(logits.dims[4] || width);
    const stride = outWidth * outHeight;
    const masks = [];
    for (let k = 0; k < count; k += 1) {
      const mask = new Uint8Array(stride);
      for (let index = 0; index < stride; index += 1) mask[index] = logits.data[(k * stride) + index] > 0 ? 1 : 0;
      masks.push(mask);
    }
    return { masks, ious, width: outWidth, height: outHeight, runtime: runtime.name, durationMs: Date.now() - startedAt };
  };
  const job = queue.then(run, run);
  queue = job.catch(() => {});
  return job;
};

export default { SEGMENT_MODEL_PATH, isSegmentModelAvailable, segmentFromPoints };
