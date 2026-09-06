# Bundled models

## lineart.onnx

Generator network from **Informative Drawings** — *Learning to Generate Line
Drawings that Convey Geometry and Semantics*, Caroline Chan, Frédo Durand,
Phillip Isola (CVPR 2022). MIT licence. This is the same network the
ControlNet ecosystem ships as its "lineart" annotator.

- Source: https://github.com/carolineec/informative-drawings
- ONNX export: https://huggingface.co/rocca/informative-drawings-line-art-onnx
- SHA-256: `1fef40b8f7126d827e30fbebccf95ae9b0b391795df926bf9366a821bad4f498`
- Input `input`: float32 `[1, 3, H, W]`, RGB in `[0, 1]`, H and W multiples of 8.
- Output `output`: float32 `[1, 1, H, W]`, `1` = paper, `0` = ink.

Used by `server/lib/thermalLineartModel.js` to draw thermal barcode-label
artwork on the server's CPU. Override the path with `THERMAL_LINEART_MODEL`;
force the WebAssembly runtime with `THERMAL_LINEART_RUNTIME=web`.

## efficientsam_ti.onnx

**EfficientSAM** (tiny) — *EfficientSAM: Leveraged Masked Image Pretraining for
Efficient Segment Anything*, Xiong et al. (CVPR 2024). Apache-2.0.

- Source: https://github.com/yformer/EfficientSAM
- ONNX export: https://huggingface.co/spaces/yunyangx/EfficientSAM (`efficientsam_ti.onnx`, 41 MB)
- Inputs: `batched_images` float32 `[1, 3, H, W]` RGB in `[0, 1]`;
  `batched_point_coords` float32 `[1, 1, N, 2]` (x, y in pixels);
  `batched_point_labels` float32 `[1, 1, N]` (1 = inside, 0 = outside).
- Outputs: `output_masks` float32 `[1, 1, 3, H, W]` logits (> 0 is inside),
  `iou_predictions` `[1, 1, 3]`.

Used by `server/lib/thermalSegmentModel.js` to keep only the front shoe when a
product photo shows a second one standing behind it. Override the path with
`THERMAL_SEGMENT_MODEL`.
