import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, CircleCheck, Folder, LoaderCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { metaErrorMessage } from "../../shared/metaAdsApi";
import { localeFor } from "../../shared/metaAdsFormat";
import WizardTree from "./WizardTree";
import AdPreview from "./preview/AdPreview";
import ReachCard from "./preview/ReachCard";
import AdSetStep from "./steps/AdSetStep";
import AdStep from "./steps/AdStep";
import CampaignStep from "./steps/CampaignStep";
import { WzSelect } from "./parts";
import {
  findNode,
  freshTree,
  levelOfKey,
  mapNodes,
  newAd,
  newAdset,
  nodeLabel,
  parentOf,
  sanitizeAdsetSpec,
  treeFromServer,
  validationShape,
} from "./treeModel";
import { wizardApi } from "./wizardApi";
import { destinationFor, resolveCta, targetingFromSpec } from "./wizardModel";
import { validateTree } from "./wizardValidation";
import "./wizard.css";

const SAVE_DELAY = 800;
const NARROW_QUERY = "(max-width: 1180px)";

// Below 1180px the context card moves under the form; render it in one place only
// (the reach card fetches an estimate, the preview holds video elements).
const useNarrow = () => {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia?.(NARROW_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia?.(NARROW_QUERY);
    if (!query) return undefined;
    const onChange = (event) => setNarrow(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return Boolean(narrow);
};

// Server id of a node: from state, or from a save that has not reached state yet.
const nodeId = (idsMap, node) => node?.id ?? idsMap.get(node?.key)?.id ?? null;

const eachNode = (tree, fn) => {
  if (!tree) return;
  mapNodes(tree, (level, node) => {
    fn(level, node);
    return null;
  });
};

// Full-screen campaign create / edit wizard.
// Props: { open, onClose, bootstrap, accountId, draftCampaignId, focus: { level, id } | null, onSaved }
export default function CreateWizard({ open, onClose, bootstrap, accountId, draftCampaignId, focus, onSaved }) {
  if (!open) return null;
  return (
    <WizardShell
      key={draftCampaignId || "new"}
      onClose={onClose}
      bootstrap={bootstrap}
      accountId={accountId}
      draftCampaignId={draftCampaignId}
      focus={focus}
      onSaved={onSaved}
    />
  );
}

function WizardShell({ onClose, bootstrap, accountId, draftCampaignId, focus, onSaved }) {
  const { t, i18n } = useTranslation();
  const locale = localeFor(i18n.language);
  const catalog = bootstrap?.catalog || null;
  const narrow = useNarrow();

  const [tree, setTree] = useState(() => (draftCampaignId ? null : freshTree()));
  const [selected, setSelected] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState({ status: "idle", at: null, error: "" });
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [serverIssues, setServerIssues] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [publishState, setPublishState] = useState({});
  const [publishError, setPublishError] = useState("");
  const [published, setPublished] = useState(false);
  const [savedAudiences, setSavedAudiences] = useState(null);
  // Inline field errors stay hidden until the user asks for them (issues list / publish).
  const [revealErrors, setRevealErrors] = useState(false);
  // Tree nodes show ⚠ once visited (or once errors are revealed), like Ads Manager.
  const [visited, setVisited] = useState(() => new Set());

  const treeRef = useRef(tree);
  const dirty = useRef(new Set());
  const ids = useRef(new Map());
  const timer = useRef(null);
  const saving = useRef(null);
  const again = useRef(false);
  const savedSomething = useRef(false);
  const centerRef = useRef(null);
  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  // ------------------------------------------------------------ account
  const campaignAccountId = tree?.campaign?.account_id;
  const account = useMemo(() => {
    const list = bootstrap?.accounts || [];
    const wanted = campaignAccountId || accountId;
    return list.find((row) => String(row.id) === String(wanted)) || list[0] || null;
  }, [bootstrap, accountId, campaignAccountId]);
  const currency = account?.currency || "USD";
  const audiences = savedAudiences ?? account?.saved_audiences ?? [];

  // ------------------------------------------------------------ load
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    if (!draftCampaignId) return undefined;
    let alive = true;
    wizardApi
      .loadTree(draftCampaignId)
      .then((data) => {
        if (!alive) return;
        const next = treeFromServer(data);
        if (!next.adsets.length) next.adsets = [newAdset()];
        for (const adset of next.adsets) if (!adset.ads.length) adset.ads = [newAd()];
        treeRef.current = next;
        setTree(next);
      })
      .catch((error) => alive && setLoadError(metaErrorMessage(error) || t("metaAds.common.loadFailed")));
    return () => {
      alive = false;
    };
  }, [draftCampaignId, t]);

  // Initial selection (honours `focus` from the list's "تعديل").
  useEffect(() => {
    if (!tree || selected) return;
    let next = { level: "campaign", key: tree.campaign.key };
    if (focus?.level && focus?.id) {
      const key = `${focus.level}-${focus.id}`;
      if (findNode(tree, focus.level, key)) next = { level: focus.level, key };
    }
    setSelected(next);
  }, [tree, selected, focus]);

  // ------------------------------------------------------------ autosave
  const applyIds = useCallback(() => {
    setTree((cur) => {
      if (!cur) return cur;
      const next = mapNodes(cur, (_level, node) => {
        const saved = ids.current.get(node.key);
        if (!saved) return null;
        const creative = saved.creative_id ?? node.creative_id ?? null;
        if (node.id === saved.id && (node.creative_id ?? null) === creative) return null;
        return { ...node, id: saved.id, creative_id: creative };
      });
      treeRef.current = next;
      return next;
    });
  }, []);

  const saveDirty = useCallback(async () => {
    const snapshot = treeRef.current;
    if (!snapshot || !account) return;
    const keys = new Set(dirty.current);
    dirty.current.clear();
    try {
      const campaign = snapshot.campaign;
      let campaignId = nodeId(ids.current, campaign);
      if (!campaignId || keys.has(campaign.key)) {
        const res = await wizardApi.saveCampaign({ account_id: account.id, id: campaignId, spec: campaign.spec });
        campaignId = res.id;
        ids.current.set(campaign.key, { id: campaignId });
      }
      for (const adset of snapshot.adsets) {
        let adsetId = nodeId(ids.current, adset);
        if (!adsetId || keys.has(adset.key)) {
          const res = await wizardApi.saveAdset({ campaign_id: campaignId, id: adsetId, spec: adset.spec });
          adsetId = res.id;
          ids.current.set(adset.key, { id: adsetId });
        }
        for (const ad of adset.ads) {
          const adId = nodeId(ids.current, ad);
          if (!adId || keys.has(ad.key)) {
            const res = await wizardApi.saveAd({ adset_id: adsetId, id: adId, spec: ad.spec });
            ids.current.set(ad.key, { id: res.id, creative_id: res.creative_id });
          }
        }
      }
      savedSomething.current = true;
      applyIds();
    } catch (error) {
      for (const key of keys) dirty.current.add(key);
      applyIds();
      throw error;
    }
  }, [account, applyIds]);

  const runSave = useCallback(() => {
    if (saving.current) {
      again.current = true;
      return saving.current;
    }
    saving.current = (async () => {
      setSaveState((prev) => ({ ...prev, status: "saving", error: "" }));
      try {
        let rounds = 0;
        do {
          again.current = false;
          await saveDirty();
          rounds += 1;
        } while ((again.current || dirty.current.size) && rounds < 5);
        setSaveState({ status: "saved", at: new Date(), error: "" });
      } catch (error) {
        setSaveState({ status: "error", at: null, error: metaErrorMessage(error) });
      } finally {
        saving.current = null;
      }
    })();
    return saving.current;
  }, [saveDirty]);

  const scheduleSave = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(runSave, SAVE_DELAY);
  }, [runSave]);

  // force = also create rows that were never edited (publish needs every node saved).
  const flush = useCallback(
    async (force = false) => {
      clearTimeout(timer.current);
      if (saving.current) await saving.current;
      if (dirty.current.size || (force && !nodeId(ids.current, treeRef.current?.campaign))) await runSave();
      if (force) {
        let missing = false;
        eachNode(treeRef.current, (_level, node) => {
          if (!nodeId(ids.current, node)) missing = true;
        });
        if (missing) await runSave();
      }
    },
    [runSave],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  // ------------------------------------------------------------ edits
  const updateNode = useCallback(
    (level, key, patch) => {
      setTree((cur) => {
        if (!cur) return cur;
        let next = mapNodes(cur, (nodeLevel, node) => (nodeLevel === level && node.key === key ? { ...node, spec: { ...node.spec, ...patch } } : null));
        dirty.current.add(key);
        if (level === "campaign" && "objective" in patch) {
          next = mapNodes(next, (nodeLevel, node) => {
            if (nodeLevel !== "adset") return null;
            const spec = sanitizeAdsetSpec(node.spec, patch.objective, catalog);
            if (spec === node.spec) return null;
            dirty.current.add(node.key);
            return { ...node, spec };
          });
        }
        treeRef.current = next;
        return next;
      });
      setServerIssues(null);
      scheduleSave();
    },
    [catalog, scheduleSave],
  );

  const addAdset = () => {
    const adset = newAdset();
    setTree((cur) => {
      const next = { ...cur, adsets: [...cur.adsets, adset] };
      treeRef.current = next;
      return next;
    });
    dirty.current.add(adset.key);
    setSelected({ level: "adset", key: adset.key });
    scheduleSave();
  };

  const addAd = (adsetKey) => {
    const ad = newAd();
    setTree((cur) => {
      const next = { ...cur, adsets: cur.adsets.map((adset) => (adset.key === adsetKey ? { ...adset, ads: [...adset.ads, ad] } : adset)) };
      treeRef.current = next;
      return next;
    });
    dirty.current.add(ad.key);
    setSelected({ level: "ad", key: ad.key });
    scheduleSave();
  };

  const deleteNode = async (level, key) => {
    if (!window.confirm(t("metaAds.common.confirmDelete"))) return;
    clearTimeout(timer.current);
    if (saving.current) await saving.current;
    const node = findNode(treeRef.current, level, key);
    const id = nodeId(ids.current, node);
    try {
      if (id) await wizardApi.deleteDraft(level, id);
    } catch (error) {
      setPublishError(metaErrorMessage(error));
      return;
    }
    dirty.current.delete(key);
    if (level === "adset") for (const ad of node?.ads || []) dirty.current.delete(ad.key);
    setTree((cur) => {
      const next =
        level === "adset"
          ? { ...cur, adsets: cur.adsets.filter((adset) => adset.key !== key) }
          : { ...cur, adsets: cur.adsets.map((adset) => ({ ...adset, ads: adset.ads.filter((ad) => ad.key !== key) })) };
      treeRef.current = next;
      return next;
    });
    setSelected({ level: "campaign", key: treeRef.current.campaign.key });
    if (dirty.current.size) scheduleSave();
  };

  // ------------------------------------------------------------ issues
  const issues = useMemo(() => {
    if (!tree || !catalog) return [];
    return validateTree(validationShape(tree), { account: account || {}, catalog });
  }, [tree, catalog, account]);
  const shownIssues = serverIssues || issues;
  const issueCount = useMemo(() => {
    const map = new Map();
    for (const issue of shownIssues) {
      if (!revealErrors && !visited.has(issue.id)) continue;
      map.set(issue.id, (map.get(issue.id) || 0) + 1);
    }
    return map;
  }, [shownIssues, revealErrors, visited]);

  useEffect(() => {
    if (!selected?.key) return;
    setVisited((prev) => (prev.has(selected.key) ? prev : new Set([...prev, selected.key])));
  }, [selected]);

  const jumpTo = (issue) => {
    const level = levelOfKey(treeRef.current, issue.id) || issue.level;
    setSelected({ level, key: issue.id });
    setIssuesOpen(false);
    setRevealErrors(true);
    setTimeout(() => {
      const target = issue.field ? centerRef.current?.querySelector(`[data-wz-field="${issue.field}"]`) : null;
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.querySelector("input, textarea, button")?.focus({ preventScroll: true });
      } else {
        centerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      }
    }, 80);
  };

  // ------------------------------------------------------------ navigation
  const current = selected && tree ? findNode(tree, selected.level, selected.key) : null;
  const level = current ? selected.level : "campaign";
  const parentAdset = level === "ad" && current ? parentOf(tree, current.key) : level === "adset" ? current : null;

  const select = (next) => {
    setSelected(next);
    centerRef.current?.scrollTo({ top: 0 });
  };
  const goNext = () => {
    if (!tree) return;
    if (level === "campaign") select({ level: "adset", key: tree.adsets[0].key });
    else if (level === "adset" && current?.ads?.[0]) select({ level: "ad", key: current.ads[0].key });
  };
  const goBack = () => {
    if (!tree) return;
    if (level === "ad" && parentAdset) select({ level: "adset", key: parentAdset.key });
    else if (level === "adset") select({ level: "campaign", key: tree.campaign.key });
  };

  // ------------------------------------------------------------ publish
  const keyForServer = (lvl, id) => {
    let found = null;
    eachNode(treeRef.current, (nodeLevel, node) => {
      if (nodeLevel === lvl && String(nodeId(ids.current, node)) === String(id)) found = node.key;
    });
    return found;
  };

  const mergeServerTree = (data) => {
    const byKey = new Map();
    const add = (lvl, row) => {
      const key = keyForServer(lvl, row.id);
      if (key) byKey.set(key, row);
    };
    add("campaign", data.campaign);
    for (const adset of data.adsets || []) {
      add("adset", adset);
      for (const ad of adset.ads || []) add("ad", ad);
    }
    setTree((cur) => {
      const next = mapNodes(cur, (_lvl, node) => {
        const row = byKey.get(node.key);
        return row ? { ...node, meta_id: row.meta_id || null, last_error: row.last_error || null, status: row.status } : null;
      });
      treeRef.current = next;
      return next;
    });
  };

  const publish = async () => {
    if (publishing) return;
    if (issues.length) {
      setRevealErrors(true);
      setIssuesOpen(true);
      return;
    }
    setPublishError("");
    setPublishing(true);
    const busy = {};
    eachNode(treeRef.current, (_lvl, node) => {
      busy[node.key] = "publishing";
    });
    setPublishState(busy);
    try {
      await flush(true);
      if (dirty.current.size) throw new Error(t("metaAdsWizard.footer.saveFirst"));
      const campaignId = nodeId(ids.current, treeRef.current.campaign);
      const res = await wizardApi.publish(campaignId);
      if (res.tree) mergeServerTree(res.tree);
      const errors = res.result?.errors || [];
      const reached = new Set([...(res.result?.adsets || []), ...(res.result?.ads || [])].map((row) => String(row.id)));
      const states = {};
      eachNode(treeRef.current, (lvl, node) => {
        if (res.ok || lvl === "campaign" || reached.has(String(nodeId(ids.current, node)))) states[node.key] = "done";
      });
      for (const err of errors) {
        const key = keyForServer(err.level, err.id);
        if (key) states[key] = "error";
      }
      setPublishState(states);
      if (errors[0]) {
        const key = keyForServer(errors[0].level, errors[0].id);
        if (key) setSelected({ level: errors[0].level, key });
        setPublishError(errors[0].title ? `${errors[0].title}: ${errors[0].message}` : errors[0].message);
      }
      if (res.ok) {
        setPublished(true);
        onSaved?.({ campaignId, published: true });
      }
    } catch (error) {
      setPublishState({});
      const list = error?.responseBody?.issues;
      if (Array.isArray(list) && list.length) {
        setServerIssues(list.map((issue) => ({ ...issue, id: keyForServer(issue.level, issue.id) || issue.id })));
        setIssuesOpen(true);
      } else {
        setPublishError(metaErrorMessage(error) || error?.message || "");
      }
    } finally {
      setPublishing(false);
    }
  };

  const close = async () => {
    try {
      await flush(false);
    } catch {
      // the draft keeps its last saved state
    }
    if (savedSomething.current && !published) onSaved?.({ campaignId: nodeId(ids.current, treeRef.current?.campaign), published: false });
    onClose?.();
  };

  // ------------------------------------------------------------ render
  const fieldError = (field) => {
    if (!current || !revealErrors) return "";
    const hit = shownIssues.find((issue) => issue.id === current.key && issue.field === field);
    return hit ? t(`metaAdsWizard.issues.${hit.key}`) : "";
  };

  const campaignSpec = tree?.campaign?.spec || {};
  let savedLabel = "";
  if (saveState.status === "saving") savedLabel = t("metaAdsWizard.top.saving");
  else if (saveState.status === "error") savedLabel = t("metaAdsWizard.top.saveFailed");
  else if (saveState.status === "saved" && saveState.at) {
    savedLabel = t("metaAdsWizard.top.saved", {
      time: saveState.at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "Africa/Cairo" }),
    });
  }

  const navOptions = [];
  if (tree) {
    navOptions.push({ value: `campaign|${tree.campaign.key}`, label: nodeLabel(t, "campaign", tree.campaign.spec) });
    for (const adset of tree.adsets) {
      navOptions.push({ value: `adset|${adset.key}`, label: `— ${nodeLabel(t, "adset", adset.spec)}` });
      for (const ad of adset.ads) navOptions.push({ value: `ad|${ad.key}`, label: `—— ${nodeLabel(t, "ad", ad.spec)}` });
    }
  }

  let context = null;
  if (current && level === "campaign") {
    context = (
      <section className="wz-side-card">
        <h3 className="wz-side-card__title">{t("metaAdsWizard.help.campaignTitle")}</h3>
        <p className="wz-side-card__body">{t("metaAdsWizard.help.campaignBody")}</p>
      </section>
    );
  } else if (current && level === "adset") {
    context = (
      <ReachCard
        accountId={account?.id}
        targeting={targetingFromSpec(current.spec, catalog)}
        goal={current.spec.optimization_goal}
        hasLocations={current.spec.locations.some((loc) => !loc.exclude)}
      />
    );
  } else if (current && level === "ad" && parentAdset) {
    const destination = destinationFor(campaignSpec.objective, parentAdset.spec, catalog);
    context = <AdPreview spec={current.spec} account={account} ctaCode={resolveCta({ adSpec: current.spec, objective: campaignSpec.objective, destination, catalog })} />;
  }

  const showForm = Boolean(tree && current && catalog && account && !published && !loadError);
  const banner =
    current && publishState[current.key] === "error" && publishError
      ? publishError
      : current && !Object.keys(publishState).length && publishError
        ? publishError
        : current?.last_error && !publishState[current.key]
          ? current.last_error
          : "";

  let body;
  if (loadError) {
    body = <div className="wz-center-msg wz-error">{loadError}</div>;
  } else if (!tree || !current || !catalog) {
    body = (
      <div className="wz-center-msg">
        <LoaderCircle className="m1-spin" size={22} /> {t("metaAds.common.loading")}
      </div>
    );
  } else if (!account) {
    body = <div className="wz-center-msg">{t("metaAds.common.noAccountBody")}</div>;
  } else if (published) {
    body = (
      <div className="wz-success">
        <CircleCheck size={44} className="wz-success__icon" aria-hidden="true" />
        <h2>{t("metaAdsWizard.publish.successTitle")}</h2>
        <p>{t("metaAdsWizard.publish.successBody")}</p>
        <button type="button" className="wz-btn wz-btn--primary" onClick={onClose}>{t("metaAds.common.close")}</button>
      </div>
    );
  } else {
    const updateCurrent = (patch) => updateNode(level, current.key, patch);
    body = (
      <div className="wz-form" key={current.key}>
        {tree.campaign.meta_id && level === "campaign" ? <div className="wz-note">{t("metaAdsWizard.common.liveNote")}</div> : null}
        {banner ? (
          <div className="wz-alert" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            <span>{t("metaAds.common.metaError", { message: banner })}</span>
          </div>
        ) : null}
        {level === "campaign" ? (
          <CampaignStep spec={current.spec} update={updateCurrent} catalog={catalog} account={account} currency={currency} fieldError={fieldError} />
        ) : level === "adset" ? (
          <AdSetStep
            spec={current.spec}
            update={updateCurrent}
            campaignSpec={campaignSpec}
            catalog={catalog}
            account={account}
            currency={currency}
            fieldError={fieldError}
            savedAudiences={audiences}
            onAudienceSaved={(audience) => setSavedAudiences([...(audiences || []), audience])}
          />
        ) : (
          <AdStep spec={current.spec} update={updateCurrent} campaignSpec={campaignSpec} adsetSpec={parentAdset?.spec || {}} account={account} catalog={catalog} fieldError={fieldError} />
        )}
      </div>
    );
  }

  return (
    <div className="wz-overlay" role="dialog" aria-modal="true" aria-label={t("metaAdsWizard.top.aria")}>
      <header className="wz-top">
        <div className="wz-top__title">
          <button type="button" className="wz-icon-btn" onClick={close} aria-label={t("metaAds.common.close")}>
            <X size={20} />
          </button>
          <Folder size={18} aria-hidden="true" className="wz-top__folder" />
          <span className="wz-top__name">{tree ? nodeLabel(t, "campaign", tree.campaign.spec) : t("metaAdsWizard.tree.newCampaign")}</span>
        </div>
        {savedLabel ? (
          <div className={`wz-top__saved ${saveState.status === "error" ? "is-error" : ""}`.trim()} title={saveState.error || undefined}>
            {saveState.status === "saving" ? <LoaderCircle size={14} className="m1-spin" /> : saveState.status === "error" ? <CircleAlert size={14} /> : <Check size={14} />}
            <span>{savedLabel}</span>
          </div>
        ) : null}
      </header>

      <div className="wz-body">
        <aside className="wz-rail">
          {tree ? (
            <WizardTree
              tree={tree}
              selected={selected}
              onSelect={select}
              issues={issueCount}
              publishState={publishState}
              onAddAd={addAd}
              onAddAdset={addAdset}
              onDelete={deleteNode}
            />
          ) : null}
        </aside>

        <main className="wz-center" ref={centerRef}>
          {showForm ? (
            <div className="wz-mobile-nav">
              <WzSelect
                value={selected ? `${selected.level}|${selected.key}` : ""}
                onChange={(value) => {
                  const [lvl, key] = value.split("|");
                  select({ level: lvl, key });
                }}
                options={navOptions}
                ariaLabel={t("metaAdsWizard.tree.aria")}
              />
            </div>
          ) : null}
          {body}
          {showForm && context && narrow ? <div className="wz-context-inline">{context}</div> : null}
        </main>

        <aside className="wz-context">{showForm && !narrow ? context : null}</aside>
      </div>

      <footer className="wz-footer">
        <div className="wz-footer__start">
          <button type="button" className="wz-btn wz-btn--ghost" onClick={close}>{t("metaAds.common.close")}</button>
          {shownIssues.length && !published && tree ? (
            <div className="wz-issues">
              <button type="button" className="wz-issues__button" onClick={() => { setRevealErrors(true); setIssuesOpen((value) => !value); }} aria-expanded={issuesOpen}>
                <CircleAlert size={15} aria-hidden="true" />
                <span>{t("metaAdsWizard.footer.issues", { count: shownIssues.length })}</span>
              </button>
              {issuesOpen ? (
                <div className="wz-issues__pop" role="dialog" aria-label={t("metaAdsWizard.footer.issuesTitle")}>
                  <div className="wz-issues__head">
                    <span>{t("metaAdsWizard.footer.issuesTitle")}</span>
                    <button type="button" className="wz-icon-btn" onClick={() => setIssuesOpen(false)} aria-label={t("metaAds.common.close")}>
                      <X size={15} />
                    </button>
                  </div>
                  <ul>
                    {shownIssues.map((issue, index) => {
                      const lvl = levelOfKey(tree, issue.id) || issue.level;
                      const node = findNode(tree, lvl, issue.id);
                      return (
                        <li key={`${issue.id}-${issue.key}-${index}`}>
                          <button type="button" onClick={() => jumpTo(issue)}>
                            <span className="wz-issues__node">{nodeLabel(t, lvl, node?.spec)}</span>
                            <span>{t(`metaAdsWizard.issues.${issue.key}`)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {showForm ? (
          <div className="wz-footer__end">
            <button type="button" className="wz-btn wz-btn--soft" onClick={goBack} disabled={level === "campaign"}>
              <ArrowRight size={16} aria-hidden="true" className="wz-flip" />
              <span>{t("metaAdsWizard.footer.back")}</span>
            </button>
            {level === "ad" ? (
              <button type="button" className="wz-btn wz-btn--success" onClick={publish} disabled={publishing}>
                {publishing ? <LoaderCircle size={16} className="m1-spin" /> : <Check size={16} aria-hidden="true" />}
                <span>{publishing ? t("metaAdsWizard.footer.publishing") : t("metaAdsWizard.footer.publish")}</span>
              </button>
            ) : (
              <button type="button" className="wz-btn wz-btn--primary" onClick={goNext}>
                <span>{t("metaAdsWizard.footer.next")}</span>
                <ArrowLeft size={16} aria-hidden="true" className="wz-flip" />
              </button>
            )}
          </div>
        ) : null}
      </footer>
    </div>
  );
}
