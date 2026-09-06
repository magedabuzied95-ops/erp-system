import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The line-drawing model behind the "lineart" thermal style.
 *
 * This is the generator from "Learning to Generate Line Drawings that Convey
 * Geometry and Semantics" (Chan, Durand, Isola — CVPR 2022, MIT licence), the
 * same network the ControlNet ecosystem ships as its lineart annotator. It
 * takes an RGB photo and returns a hand-drawn-looking line map: laces, seams,
 * stitching and tread come out as strokes because the network learned what
 * people draw, not because they contrast in the photo. Nothing leaves the
 * server — the 17 MB ONNX file sits in server/models and runs on the CPU.
 *
 * Runtime selection: the native onnxruntime binary is several times faster
 * but is built against glibc, and the backend image is Alpine (musl). We try
 * it, and if the binary refuses to load we fall back to the WebAssembly build,
 * which runs anywhere at a few seconds per image.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

export const LINEART_MODEL_PATH = process.env.THERMAL_LINEART_MODEL
  ? path.resolve(process.env.THERMAL_LINEART_MODEL)
  : path.resolve(here, "..", "models", "lineart.onnx");

// Inference is memory-hungry (a few hundred MB of WASM heap at 512px) and the
// label queue can fan out; one run at a time keeps the box predictable.
let queue = Promise.resolve();
let runtimePromise = null;
let sessionPromise = null;
let availability = null;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const isLineartModelAvailable = async () => {
  if (availability !== null) return availability;
  try {
    await fs.access(LINEART_MODEL_PATH);
    availability = true;
  } catch {
    availability = false;
  }
  return availability;
};

const loadRuntime = async () => {
  if (process.env.THERMAL_LINEART_RUNTIME !== "web") {
    try {
      const ort = await import("onnxruntime-node");
      return { ort, name: "node", options: { executionProviders: ["cpu"], intraOpNumThreads: clamp(os.cpus().length - 1, 1, 4) } };
    } catch (error) {
      console.warn("[thermal-lineart] native onnxruntime unavailable, using WebAssembly", {
        message: error?.message || String(error),
      });
    }
  }
  const ort = await import("onnxruntime-web");
  ort.env.wasm.numThreads = clamp(os.cpus().length - 1, 1, 4);
  return { ort, name: "web", options: { executionProviders: ["wasm"] } };
};

export const getLineartRuntime = () => {
  if (!runtimePromise) runtimePromise = loadRuntime();
  return runtimePromise;
};

const getSession = async () => {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const runtime = await getLineartRuntime();
      const startedAt = Date.now();
      const session = await runtime.ort.InferenceSession.create(LINEART_MODEL_PATH, runtime.options);
      console.log("[thermal-lineart] model loaded", {
        runtime: runtime.name,
        threads: runtime.name === "web" ? runtime.ort.env.wasm.numThreads : runtime.options.intraOpNumThreads,
        durationMs: Date.now() - startedAt,
      });
      return { runtime, session };
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
};

/**
 * Run the model over an interleaved RGB buffer.
 *
 * @param {Uint8Array|Buffer} rgb  width*height*3 bytes, row-major
 * @returns {Promise<{ map: Float32Array, width: number, height: number, runtime: string, durationMs: number }>}
 *   `map` is one float per pixel in [0, 1], 1 = untouched paper, 0 = full ink.
 */
export const renderLineartMap = ({ rgb, width, height }) => {
  const run = async () => {
    const { runtime, session } = await getSession();
    const pixels = width * height;
    const input = new Float32Array(3 * pixels);
    for (let index = 0; index < pixels; index += 1) {
      const offset = index * 3;
      input[index] = rgb[offset] / 255;
      input[pixels + index] = rgb[offset + 1] / 255;
      input[(2 * pixels) + index] = rgb[offset + 2] / 255;
    }
    const tensor = new runtime.ort.Tensor("float32", input, [1, 3, height, width]);
    const startedAt = Date.now();
    const results = await session.run({ [session.inputNames[0]]: tensor });
    const output = results[session.outputNames[0]];
    const outHeight = Number(output.dims[2] || height);
    const outWidth = Number(output.dims[3] || width);
    const map = new Float32Array(outWidth * outHeight);
    for (let index = 0; index < map.length; index += 1) {
      map[index] = clamp(output.data[index], 0, 1);
    }
    return { map, width: outWidth, height: outHeight, runtime: runtime.name, durationMs: Date.now() - startedAt };
  };

  const job = queue.then(run, run);
  queue = job.catch(() => {});
  return job;
};

export default {
  LINEART_MODEL_PATH,
  isLineartModelAvailable,
  getLineartRuntime,
  renderLineartMap,
};
