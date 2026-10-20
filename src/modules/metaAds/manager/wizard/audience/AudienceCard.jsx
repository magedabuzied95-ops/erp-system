import { useCallback, useState } from "react";
import { Plus, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button, Modal } from "../../../../../shared/ui";
import { metaErrorMessage } from "../../../shared/metaAdsApi";
import { formatCompact, localeFor } from "../../../shared/metaAdsFormat";
import { Segmented, ToggleCard, WzCard, WzField, WzInput, WzSelect } from "../parts";
import { audienceFromSpec, specFromTargeting, targetingFromSpec } from "../wizardModel";
import { wizardApi } from "../wizardApi";
import LocationPicker from "./LocationPicker";
import TokenSearch from "./TokenSearch";

const AGES = Array.from({ length: 53 }, (_, index) => 13 + index); // 13..65

function ChipList({ rows, onRemove, removeLabel, tone = "" }) {
  if (!rows.length) return null;
  return (
    <div className="wz-chips">
      {rows.map((row) => (
        <span key={row.id || row.key} className={`wz-chip ${tone}`.trim()}>
          <span className="wz-chip__label">{row.name}</span>
          <button type="button" className="wz-chip__x" aria-label={removeLabel} onClick={() => onRemove(row)}>
            <X size={13} />
          </button>
        </span>
      ))}
    </div>
  );
}

export default function AudienceCard({ spec, update, account, catalog, fieldError, savedAudiences = [], onAudienceSaved }) {
  const { t, i18n } = useTranslation();
  const locale = localeFor(i18n.language);
  const accountId = account?.id;
  const [showExclude, setShowExclude] = useState(spec.exclusions.length > 0);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const searchInterests = useCallback(
    async (q) => (await wizardApi.searchInterests({ account_id: accountId, q, locale: i18n.language }))?.results || [],
    [accountId, i18n.language],
  );
  const searchLocales = useCallback(async (q) => (await wizardApi.searchLocales({ account_id: accountId, q }))?.results || [], [accountId]);

  const addTo = (field, row, idField = "id") => {
    const list = spec[field] || [];
    if (list.some((item) => String(item[idField]) === String(row[idField]))) return;
    update({ [field]: [...list, idField === "id" ? { id: String(row.id), name: row.name } : { key: String(row.key), name: row.name }] });
  };
  const removeFrom = (field, row, idField = "id") => update({ [field]: (spec[field] || []).filter((item) => String(item[idField]) !== String(row[idField])) });

  const applySaved = (id) => {
    const audience = savedAudiences.find((row) => String(row.id) === String(id));
    if (!audience) return;
    const targeting = audience.targeting || {};
    const fields = targeting._wizard && typeof targeting._wizard === "object" ? targeting._wizard : specFromTargeting(targeting, catalog);
    const patch = {};
    for (const [key, value] of Object.entries(audienceFromSpec(fields))) if (value !== undefined) patch[key] = value;
    update(patch);
  };

  const saveAudience = async () => {
    const name = saveName.trim();
    if (!name) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = await wizardApi.saveAudience({
        account_id: accountId,
        name,
        targeting: { ...targetingFromSpec(spec, catalog), _wizard: audienceFromSpec(spec) },
      });
      onAudienceSaved?.(res.audience);
      setSaveOpen(false);
      setSaveName("");
    } catch (error) {
      setSaveError(metaErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const customAudiences = Array.isArray(account?.custom_audiences) ? account.custom_audiences : [];
  const audienceOptions = customAudiences.map((row) => ({
    value: String(row.meta_id || row.id),
    label: row.approximate_count_upper ? `${row.name} (${formatCompact(row.approximate_count_upper, t, locale)})` : row.name,
  }));
  const audienceName = (id) => customAudiences.find((row) => String(row.meta_id || row.id) === String(id))?.name || String(id);
  const minAgeOptions = AGES.slice(0, -1).map((age) => ({ value: String(age), label: String(age) }));
  const maxAgeOptions = AGES.map((age) => ({ value: String(age), label: age === 65 ? "65+" : String(age) }));

  return (
    <WzCard
      title={t("metaAdsWizard.audience.title")}
      subtitle={t("metaAdsWizard.audience.subtitle")}
      field="audience"
      action={
        <div className="wz-card__tools">
          {savedAudiences.length ? (
            <WzSelect
              className="wz-saved-picker"
              value=""
              onChange={applySaved}
              options={savedAudiences.map((row) => ({ value: String(row.id), label: row.name }))}
              placeholder={t("metaAdsWizard.audience.useSaved")}
              ariaLabel={t("metaAdsWizard.audience.useSaved")}
            />
          ) : null}
          <button type="button" className="wz-plain-button" onClick={() => { setSaveError(""); setSaveOpen(true); }}>
            {t("metaAdsWizard.audience.save")}
          </button>
        </div>
      }
    >
      <LocationPicker spec={spec} update={update} account={account} catalog={catalog} error={fieldError("locations")} />

      <ToggleCard
        icon={Sparkles}
        title={t("metaAdsWizard.audience.advantageTitle")}
        description={t("metaAdsWizard.audience.advantageBody")}
        checked={spec.advantage_audience}
        onChange={(value) => update(value ? { advantage_audience: true, age_max: 65, age_min: Math.min(Number(spec.age_min) || 18, 25) } : { advantage_audience: false })}
      />
      {spec.advantage_audience ? <p className="wz-hint">{t("metaAdsWizard.audience.advantageNote")}</p> : null}

      <div className="wz-age-gender" data-wz-field="age">
        <WzField label={t("metaAdsWizard.audience.age")} error={fieldError("age")}>
          <div className="wz-age">
            <WzSelect value={String(spec.age_min)} onChange={(value) => update({ age_min: Number(value) })} options={minAgeOptions} ariaLabel={t("metaAdsWizard.audience.ageMin")} />
            <span className="wz-age__dash" aria-hidden="true">—</span>
            <WzSelect value={String(spec.age_max)} onChange={(value) => update({ age_max: Number(value) })} options={maxAgeOptions} ariaLabel={t("metaAdsWizard.audience.ageMax")} />
          </div>
        </WzField>
        <WzField label={t("metaAdsWizard.audience.gender")}>
          <Segmented
            value={spec.gender}
            onChange={(value) => update({ gender: value })}
            ariaLabel={t("metaAdsWizard.audience.gender")}
            options={[
              { value: "all", label: t("metaAdsWizard.audience.genderAll") },
              { value: "men", label: t("metaAdsWizard.audience.genderMen") },
              { value: "women", label: t("metaAdsWizard.audience.genderWomen") },
            ]}
          />
        </WzField>
      </div>

      <WzField label={t("metaAdsWizard.audience.detailed")} field="interests">
        <TokenSearch
          placeholder={t("metaAdsWizard.audience.interestsPlaceholder")}
          search={searchInterests}
          rowKey={(row) => row.id}
          onPick={(row) => addTo("interests", row)}
          renderRow={(row) => (
            <span className="wz-search__main">
              <span>{row.name}</span>
              <span className="wz-search__meta">
                {[row.path?.slice(0, -1).join(" › "), row.audience_size_upper_bound ? formatCompact(row.audience_size_upper_bound, t, locale) : ""].filter(Boolean).join(" · ")}
              </span>
            </span>
          )}
        />
        <ChipList rows={spec.interests} onRemove={(row) => removeFrom("interests", row)} removeLabel={t("metaAdsWizard.common.remove")} />
        {showExclude ? (
          <div className="wz-stack-sm">
            <div className="wz-label wz-label--sub">{t("metaAdsWizard.audience.excludeTitle")}</div>
            <TokenSearch
              placeholder={t("metaAdsWizard.audience.excludePlaceholder")}
              search={searchInterests}
              rowKey={(row) => row.id}
              onPick={(row) => addTo("exclusions", row)}
              renderRow={(row) => <span className="wz-search__main"><span>{row.name}</span></span>}
            />
            <ChipList rows={spec.exclusions} tone="is-excluded" onRemove={(row) => removeFrom("exclusions", row)} removeLabel={t("metaAdsWizard.common.remove")} />
          </div>
        ) : (
          <button type="button" className="wz-link" onClick={() => setShowExclude(true)}>
            <Plus size={15} aria-hidden="true" />
            <span>{t("metaAdsWizard.audience.exclude")}</span>
          </button>
        )}
      </WzField>

      <WzField label={t("metaAdsWizard.audience.languages")} hint={t("metaAdsWizard.audience.languagesHint")} field="locales">
        <TokenSearch
          placeholder={t("metaAdsWizard.audience.languagesPlaceholder")}
          search={searchLocales}
          minChars={1}
          rowKey={(row) => row.key}
          onPick={(row) => addTo("locales", row, "key")}
          renderRow={(row) => <span className="wz-search__main"><span>{row.name}</span></span>}
        />
        <ChipList rows={spec.locales} onRemove={(row) => removeFrom("locales", row, "key")} removeLabel={t("metaAdsWizard.common.remove")} />
      </WzField>

      {customAudiences.length ? (
        <WzField label={t("metaAdsWizard.audience.customAudiences")} field="custom_audiences">
          <div className="wz-two">
            <WzSelect
              value=""
              onChange={(value) => addTo("custom_audiences", { id: value, name: audienceName(value) })}
              options={audienceOptions}
              placeholder={t("metaAdsWizard.audience.includeAudience")}
              ariaLabel={t("metaAdsWizard.audience.includeAudience")}
            />
            <WzSelect
              value=""
              onChange={(value) => addTo("excluded_custom_audiences", { id: value, name: audienceName(value) })}
              options={audienceOptions}
              placeholder={t("metaAdsWizard.audience.excludeAudience")}
              ariaLabel={t("metaAdsWizard.audience.excludeAudience")}
            />
          </div>
          <ChipList rows={spec.custom_audiences} onRemove={(row) => removeFrom("custom_audiences", row)} removeLabel={t("metaAdsWizard.common.remove")} />
          <ChipList rows={spec.excluded_custom_audiences} tone="is-excluded" onRemove={(row) => removeFrom("excluded_custom_audiences", row)} removeLabel={t("metaAdsWizard.common.remove")} />
        </WzField>
      ) : null}

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title={t("metaAdsWizard.audience.saveTitle")}
        description={t("metaAdsWizard.audience.saveHint")}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSaveOpen(false)}>{t("metaAds.common.cancel")}</Button>
            <Button variant="primary" loading={saving} disabled={!saveName.trim()} onClick={saveAudience}>{t("metaAds.common.save")}</Button>
          </>
        }
      >
        <WzInput value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder={t("metaAdsWizard.audience.saveName")} maxLength={200} autoFocus />
        {saveError ? <div className="wz-error">{saveError}</div> : null}
      </Modal>
    </WzCard>
  );
}
