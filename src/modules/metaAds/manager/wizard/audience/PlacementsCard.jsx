import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { RadioCard, WzCard, WzField, WzSelect } from "../parts";

// "المواضع": Advantage+ placements (omit every placement field) or manual
// (devices + platforms + grouped positions from catalog.placement_tree).
export default function PlacementsCard({ spec, update, catalog, fieldError }) {
  const { t } = useTranslation();
  const tree = catalog?.placement_tree || [];
  const deviceOptions = (catalog?.device_options || ["all", "mobile", "desktop"]).map((code) => ({ value: code, label: t(`metaAdsWizard.placements.devices.${code}`) }));

  const togglePlatform = (platform, on) => {
    const platforms = on ? [...new Set([...spec.platforms, platform])] : spec.platforms.filter((p) => p !== platform);
    const positions = { ...(spec.positions || {}) };
    if (!on) delete positions[platform];
    update({ platforms, positions });
  };

  const togglePosition = (platform, position, on) => {
    const current = spec.positions?.[platform] || [];
    const next = on ? [...new Set([...current, position])] : current.filter((p) => p !== position);
    const platforms = on && !spec.platforms.includes(platform) ? [...spec.platforms, platform] : spec.platforms;
    update({ positions: { ...(spec.positions || {}), [platform]: next }, platforms });
  };

  return (
    <WzCard title={t("metaAdsWizard.placements.title")} subtitle={t("metaAdsWizard.placements.subtitle")} field="placements">
      <div className="wz-stack-sm" role="radiogroup" aria-label={t("metaAdsWizard.placements.title")}>
        <RadioCard
          checked={spec.placements !== "manual"}
          onSelect={() => update({ placements: "advantage" })}
          icon={Sparkles}
          title={t("metaAdsWizard.placements.advantageTitle")}
          description={t("metaAdsWizard.placements.advantageBody")}
        />
        <RadioCard
          checked={spec.placements === "manual"}
          onSelect={() => update({ placements: "manual" })}
          title={t("metaAdsWizard.placements.manualTitle")}
          description={t("metaAdsWizard.placements.manualBody")}
        />
      </div>

      {spec.placements === "manual" ? (
        <div className="wz-stack">
          <WzField label={t("metaAdsWizard.placements.devicesLabel")}>
            <WzSelect value={spec.devices} onChange={(value) => update({ devices: value })} options={deviceOptions} ariaLabel={t("metaAdsWizard.placements.devicesLabel")} />
          </WzField>
          <WzField label={t("metaAdsWizard.placements.platformsLabel")} error={fieldError("placements")} hint={t("metaAdsWizard.placements.leaveEmpty")}>
            <div className="wz-stack-sm">
              {tree.map((node) => {
                const on = spec.platforms.includes(node.platform);
                const chosen = spec.positions?.[node.platform] || [];
                return (
                  <div key={node.platform} className={`wz-platform ${on ? "" : "is-off"}`.trim()}>
                    <label className="wz-platform__head">
                      <input type="checkbox" checked={on} onChange={(event) => togglePlatform(node.platform, event.target.checked)} />
                      <span className="wz-platform__name">{t(`metaAdsWizard.placements.platforms.${node.platform}`)}</span>
                      <span className="wz-platform__all">{chosen.length ? t("metaAdsWizard.placements.selectedCount", { count: chosen.length }) : t("metaAdsWizard.placements.allPositions")}</span>
                    </label>
                    <div className="wz-platform__groups">
                      {node.groups.map((group) => (
                        <div key={group.code} className="wz-platform__group">
                          <div className="wz-platform__group-title">{t(`metaAdsWizard.placements.groups.${group.code}`)}</div>
                          {group.positions.map((position) => (
                            <label key={position} className="wz-check">
                              <input
                                type="checkbox"
                                checked={chosen.includes(position)}
                                onChange={(event) => togglePosition(node.platform, position, event.target.checked)}
                              />
                              <span>{t(`metaAdsWizard.placements.positions.${node.platform}.${position}`)}</span>
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </WzField>
        </div>
      ) : null}
    </WzCard>
  );
}
