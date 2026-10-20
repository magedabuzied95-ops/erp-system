import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";

import { IconButton } from "../../../../shared/ui";
import { formatDateTime, localeFor } from "../../shared/metaAdsFormat";
import { fromCairoInput, toCairoInput } from "../recordsFormat";

// "AI Instructions" tab: extra instructions the AI sales agent follows while a chat
// came from this campaign / ad set / ad. Saved together with the record.
export default function AiInstructionsTable({ rows, onChange, readOnly }) {
  const { t, i18n } = useTranslation();
  const locale = localeFor(i18n.language);

  const patch = (index, change) => onChange(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
  const remove = (index) => onChange(rows.filter((_, i) => i !== index));
  const add = () => onChange([...rows, { message: "", expires_at: null }]);

  return (
    <div className="mar-subtable">
      <div className="mar-subtable__scroll">
        <table className="mar-subtable__table">
          <thead>
            <tr>
              <th>{t("metaAdsRecords.ai.message")}</th>
              <th className="mar-subtable__date">{t("metaAdsRecords.ai.expiresAt")}</th>
              {readOnly ? null : <th className="mar-subtable__tools" aria-label={t("metaAdsRecords.ai.remove")} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id || `new-${index}`}>
                <td>
                  {readOnly ? (
                    <span className="mar-pre">{row.message}</span>
                  ) : (
                    <textarea
                      className="mar-input mar-input--area"
                      rows={2}
                      value={row.message || ""}
                      placeholder={t("metaAdsRecords.ai.placeholder")}
                      onChange={(event) => patch(index, { message: event.target.value })}
                    />
                  )}
                </td>
                <td className="mar-subtable__date">
                  {readOnly ? (
                    row.expires_at ? formatDateTime(row.expires_at, locale) : "—"
                  ) : (
                    <input
                      type="datetime-local"
                      className="mar-input"
                      value={toCairoInput(row.expires_at)}
                      onChange={(event) => patch(index, { expires_at: fromCairoInput(event.target.value) })}
                    />
                  )}
                </td>
                {readOnly ? null : (
                  <td className="mar-subtable__tools">
                    <IconButton icon={Trash2} size="sm" label={t("metaAdsRecords.ai.remove")} onClick={() => remove(index)} />
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && readOnly ? (
              <tr>
                <td colSpan={2} className="mar-subtable__empty">{t("metaAdsRecords.ai.empty")}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {readOnly ? null : (
        <button type="button" className="mar-link-button" onClick={add}>
          <Plus size={14} aria-hidden="true" />
          {t("metaAdsRecords.ai.addRow")}
        </button>
      )}
    </div>
  );
}
