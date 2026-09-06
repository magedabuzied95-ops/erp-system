import { useEffect, useState } from "react";
import { api } from "../../../shared/api/api";
import { mergeColorNameSuggestions } from "../lib/colorNameSuggestions";

export const COLOR_NAME_DATALIST_ID = "m1-standard-color-names";

// One request per page load, shared by every colour block on the screen.
let catalogPromise = null;

const loadCatalogColorNames = () => {
  if (!catalogPromise) {
    catalogPromise = api
      .get("/products/color-names", { timeoutMs: 15000 })
      .then((payload) => (Array.isArray(payload?.colors) ? payload.colors : [])
        .map((row) => (typeof row === "string" ? row : row?.name))
        .filter(Boolean))
      // A missing or failing endpoint must not empty the dropdown: the standard
      // colours still come from mergeColorNameSuggestions.
      .catch(() => []);
  }
  return catalogPromise;
};

// Rendered ONCE per editor page - the colour blocks all point their input's
// `list` at this id, so a per-block copy would only duplicate the DOM.
export default function ColorNameDatalist({ id = COLOR_NAME_DATALIST_ID }) {
  const [colorNames, setColorNames] = useState(() => mergeColorNameSuggestions([]));

  useEffect(() => {
    let alive = true;
    loadCatalogColorNames().then((catalogNames) => {
      if (!alive) return;
      setColorNames(mergeColorNameSuggestions(catalogNames));
    });
    return () => { alive = false; };
  }, []);

  return (
    <datalist id={id}>
      {colorNames.map((name) => <option key={name} value={name} />)}
    </datalist>
  );
}
