import { suggestEditionFromImage } from "../services/editionSuggestionService.js";

export const suggestMirrorEditionName = async (req, res) => {
  try {
    const result = await suggestEditionFromImage(req.body || {});
    return res.json({
      success: true,
      ...result,
      suggestion: result,
    });
  } catch (error) {
    console.warn("[edition-suggestions] failed:", error?.message || error);
    return res.status(500).json({
      success: false,
      message: "Failed to suggest edition",
      error: error?.message || "Unknown error",
    });
  }
};
