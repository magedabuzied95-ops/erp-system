import { Circle, CircleAlert, CircleCheck, CircleX, Folder, GalleryHorizontalEnd, Layers, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { nodeLabel } from "./treeModel";

const LEVEL_ICON = { campaign: Folder, adset: Layers, ad: GalleryHorizontalEnd };

function StatusDot({ state, issues, live, error }) {
  if (state === "publishing") return <LoaderCircle size={15} className="m1-spin wz-dot wz-dot--busy" aria-hidden="true" />;
  if (error || state === "error") return <CircleX size={15} className="wz-dot wz-dot--error" aria-hidden="true" />;
  if (issues > 0) return <CircleAlert size={15} className="wz-dot wz-dot--warn" aria-hidden="true" />;
  if (live || state === "done") return <CircleCheck size={15} className="wz-dot wz-dot--ok" aria-hidden="true" />;
  return <Circle size={15} className="wz-dot" aria-hidden="true" />;
}

function TreeNode({ level, node, selected, onSelect, issues, publishState, canDelete, onDelete, depth }) {
  const { t } = useTranslation();
  const Icon = LEVEL_ICON[level];
  const active = selected?.level === level && selected?.key === node.key;
  const label = nodeLabel(t, level, node.spec);
  return (
    <div className={`wz-tree__row wz-tree__row--d${depth} ${active ? "is-active" : ""}`.trim()}>
      <button type="button" className="wz-tree__node" onClick={() => onSelect({ level, key: node.key })} aria-current={active ? "step" : undefined} title={node.last_error || label}>
        <StatusDot state={publishState[node.key]} issues={issues.get(node.key) || 0} live={Boolean(node.meta_id)} error={Boolean(node.last_error)} />
        <Icon size={16} className="wz-tree__icon" aria-hidden="true" />
        <span className="wz-tree__label">{label}</span>
      </button>
      {canDelete ? (
        <button type="button" className="wz-tree__delete" onClick={() => onDelete(level, node.key)} aria-label={t("metaAdsWizard.tree.delete", { name: label })} title={t("metaAdsWizard.tree.delete", { name: label })}>
          <Trash2 size={14} />
        </button>
      ) : null}
    </div>
  );
}

export default function WizardTree({ tree, selected, onSelect, issues, publishState, onAddAd, onAddAdset, onDelete }) {
  const { t } = useTranslation();
  const common = { selected, onSelect, issues, publishState, onDelete };
  return (
    <nav className="wz-tree" aria-label={t("metaAdsWizard.tree.aria")}>
      <TreeNode level="campaign" node={tree.campaign} depth={0} canDelete={false} {...common} />
      {tree.adsets.map((adset) => (
        <div key={adset.key} className="wz-tree__group">
          <TreeNode level="adset" node={adset} depth={1} canDelete={tree.adsets.length > 1 && !adset.meta_id} {...common} />
          {adset.ads.map((ad) => (
            <TreeNode key={ad.key} level="ad" node={ad} depth={2} canDelete={adset.ads.length > 1 && !ad.meta_id} {...common} />
          ))}
          <button type="button" className="wz-tree__add wz-tree__add--ad" onClick={() => onAddAd(adset.key)}>
            <Plus size={14} aria-hidden="true" />
            <span>{t("metaAdsWizard.tree.addAd")}</span>
          </button>
        </div>
      ))}
      <button type="button" className="wz-tree__add" onClick={onAddAdset}>
        <Plus size={14} aria-hidden="true" />
        <span>{t("metaAdsWizard.tree.addAdset")}</span>
      </button>
    </nav>
  );
}
