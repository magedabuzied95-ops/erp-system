import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { ChevronLeft, ChevronRight, Copy, LoaderCircle, Plus, Save, Settings, Trash2, Undo2 } from "lucide-react";

import { hasPermission } from "../../../shared/auth/authStorage";
import { EmptyState, LoadingState } from "../../../shared/ui";
import { isForbiddenError, isNotReadyError, readSelectedAccountId } from "../shared/metaAdsApi";
import { localeFor } from "../shared/metaAdsFormat";
import { RESOURCE_PAGE_KEY, recordPath } from "../shared/metaAdsNav";
import AiInstructionsTable from "./components/AiInstructionsTable";
import CreativeMedia from "./components/CreativeMedia";
import JsonViewer from "./components/JsonViewer";
import RecordField, { FieldLabel } from "./components/RecordField";
import { CREATE_REQUIRED, getRecordResource } from "./recordRegistry";
import { recordsApi } from "./recordsApi";
import { describeError } from "./recordsErrors";
import { isFieldEditable, renderCustom } from "./recordsFormat";
import "./records.css";

// /meta-ads/r/:resource/:id — one record: action buttons, smart buttons, the sheet
// (two-column field grid) and the bottom tabs. id = "new" creates a record.
export default function RecordFormPage() {
  const { resource, id } = useParams();
  const def = getRecordResource(resource);
  if (!def) return <Navigate to="/meta-ads" replace />;
  return <RecordForm key={`${resource}:${id}`} resource={resource} id={id} def={def} />;
}

const allFields = (def) => def.sections.flatMap((section) => [...(section.start || []), ...(section.end || [])]);

function GearMenu({ items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onClose();
    };
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div className="mar-popover mar-popover--menu" ref={ref} role="menu">
      {items.map((item) => (
        <button key={item.key} type="button" role="menuitem" className={`mar-popover__action${item.danger ? " is-danger" : ""}`} onClick={() => { onClose(); item.onClick(); }}>
          <item.icon size={15} aria-hidden="true" />
          {item.label}
        </button>
      ))}
    </div>
  );
}

function RecordForm({ resource, id, def }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const canManage = hasPermission("meta_ads.manage");
  const locale = localeFor(i18n.language);
  const isNew = id === "new";
  const listQuery = useMemo(() => location.state?.listQuery || {}, [location.state]);

  const [record, setRecord] = useState({});
  const [counts, setCounts] = useState({});
  const [neighbors, setNeighbors] = useState(null);
  const [draft, setDraft] = useState({});
  const [aiRows, setAiRows] = useState([]);
  const [aiDirty, setAiDirty] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [failure, setFailure] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [gearOpen, setGearOpen] = useState(false);
  const [lookups, setLookups] = useState({});
  const tabs = useMemo(() => (def.tabs || []).filter((tab) => tab.kind !== "ai" || def.aiInstructions), [def]);
  const [tab, setTab] = useState(tabs[0]?.key || "");

  const dirty = Object.keys(draft).length > 0 || aiDirty;
  const listTitle = t(`metaAds.nav.pages.${RESOURCE_PAGE_KEY[resource]}`);

  // ------------------------------------------------------------ load
  const load = useCallback(async () => {
    if (isNew) {
      const editableKeys = new Set(allFields(def).filter((field) => field.editable).map((field) => field.key));
      const prefill = {};
      for (const [key, value] of searchParams.entries()) {
        if (editableKeys.has(key) && value) prefill[key] = /_id$/.test(key) && /^\d+$/.test(value) ? Number(value) : value;
      }
      if (editableKeys.has("account_id") && !prefill.account_id && readSelectedAccountId()) prefill.account_id = Number(readSelectedAccountId()) || undefined;
      Object.keys(prefill).forEach((key) => prefill[key] === undefined && delete prefill[key]);
      setRecord({});
      setDraft(prefill);
      setCounts({});
      setNeighbors(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await recordsApi.get(resource, id, listQuery);
      setRecord(response.record || {});
      setCounts(response.counts || {});
      setNeighbors(response.neighbors || null);
      setFailure(null);
      if (def.aiInstructions) {
        const ai = await recordsApi.aiInstructions(resource, id);
        setAiRows(ai.rows || []);
        setAiDirty(false);
      }
    } catch (error) {
      if (isNotReadyError(error)) setFailure("notReady");
      else if (isForbiddenError(error)) setFailure("denied");
      else if (error?.status === 404) setFailure("notFound");
      else {
        setFailure("failed");
        toast.error(describeError(t, error));
      }
    } finally {
      setLoading(false);
    }
  }, [isNew, def, searchParams, resource, id, listQuery, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Lookup options for the editable many-to-one selects.
  const lookupKinds = useMemo(() => {
    const kinds = new Set();
    for (const field of allFields(def)) {
      if (field.type === "lookup" && field.lookup && isFieldEditable(field, { canEdit: canManage, isNew, record })) kinds.add(field.lookup);
    }
    return [...kinds].sort().join(",");
  }, [def, canManage, isNew, record]);

  useEffect(() => {
    if (!lookupKinds) return undefined;
    let alive = true;
    Promise.all(
      lookupKinds.split(",").map((kind) =>
        recordsApi.lookup(kind).then((response) => [kind, response.rows || []]).catch(() => [kind, []])),
    ).then((entries) => {
      if (alive) setLookups(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
  }, [lookupKinds]);

  // Unsaved changes survive an accidental tab close only with a prompt.
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const merged = useMemo(() => ({ ...record, ...draft }), [record, draft]);
  const setField = (key, value) => setDraft((current) => {
    const next = { ...current };
    if (value === undefined) delete next[key];
    else next[key] = value;
    return next;
  });

  const leaveOk = () => !dirty || window.confirm(t("metaAdsRecords.form.confirmLeave"));
  const go = (to, state) => {
    if (!leaveOk()) return;
    navigate(to, state ? { state } : undefined);
  };

  // ------------------------------------------------------------ save / create
  const save = async ({ quiet = false } = {}) => {
    if (!canManage) return false;
    if (isNew) {
      const missing = (CREATE_REQUIRED[resource] || []).filter((key) => draft[key] === undefined || draft[key] === null || draft[key] === "");
      if (missing.length) {
        const labels = missing.map((key) => {
          const field = allFields(def).find((item) => item.key === key) || (def.title.key === key ? def.title : null);
          return field ? t(`metaAdsRecords.${field.label}`) : key;
        });
        toast.error(t("metaAdsRecords.form.required", { fields: labels.join("، ") }));
        return false;
      }
    }
    setSaving(true);
    try {
      if (isNew) {
        const response = await recordsApi.create(resource, draft);
        const newId = response.record?.id;
        if (def.aiInstructions && aiRows.length && newId) await recordsApi.saveAiInstructions(resource, newId, aiRows);
        setDraft({});
        setAiDirty(false);
        toast.success(t("metaAdsRecords.form.created"));
        navigate(recordPath(resource, newId), { replace: true, state: { listQuery } });
        return true;
      }
      if (Object.keys(draft).length) {
        const response = await recordsApi.update(resource, id, draft);
        setRecord(response.record || record);
        setCounts(response.counts || counts);
        setDraft({});
      }
      if (aiDirty) {
        const ai = await recordsApi.saveAiInstructions(resource, id, aiRows);
        setAiRows(ai.rows || []);
        setAiDirty(false);
      }
      if (!quiet) toast.success(t("metaAds.common.saved"));
      return true;
    } catch (error) {
      toast.error(describeError(t, error));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft({});
    setAiDirty(false);
    if (!isNew) load();
  };

  const remove = async () => {
    if (!window.confirm(t("metaAds.common.confirmDelete"))) return;
    try {
      await recordsApi.remove(resource, id);
      toast.success(t("metaAds.common.deleted"));
      setDraft({});
      setAiDirty(false);
      navigate(recordPath(resource), { replace: true });
    } catch (error) {
      toast.error(describeError(t, error));
    }
  };

  const duplicate = async () => {
    if (!leaveOk()) return;
    try {
      const response = await recordsApi.duplicate(resource, id, t("metaAdsRecords.form.copySuffix"));
      toast.success(t("metaAdsRecords.form.duplicated"));
      setDraft({});
      setAiDirty(false);
      navigate(recordPath(resource, response.id), { state: { listQuery } });
    } catch (error) {
      toast.error(describeError(t, error));
    }
  };

  // ------------------------------------------------------------ action buttons
  const runAction = async (action) => {
    const label = t(`metaAdsRecords.actions.${action.key}`);
    if (action.confirm && !window.confirm(t("metaAdsRecords.actions.confirm", { action: label }))) return;
    if (dirty) {
      const ok = await save({ quiet: true });
      if (!ok) return;
    }
    setBusyAction(action.key);
    try {
      const response = await recordsApi.action(resource, id, action.key);
      toast.success(t("metaAdsRecords.actions.done", { action: label }));
      if (response.created?.resource && response.created?.id) {
        navigate(recordPath(response.created.resource, response.created.id));
        return;
      }
      await load();
    } catch (error) {
      toast.error(describeError(t, error));
    } finally {
      setBusyAction("");
    }
  };

  // ------------------------------------------------------------ render
  if (loading && !Object.keys(record).length) return <div className="mar-page"><LoadingState /></div>;
  if (failure && failure !== "failed") {
    const titles = { notReady: "metaAds.common.notReadyTitle", denied: "metaAds.common.deniedTitle", notFound: "metaAdsRecords.form.notFound" };
    const bodies = { notReady: "metaAds.common.notReadyBody", denied: "metaAds.common.deniedBody", notFound: "metaAdsRecords.form.notFoundBody" };
    return (
      <div className="mar-page">
        <EmptyState
          title={t(titles[failure])}
          description={t(bodies[failure])}
          action={<Link className="mar-link" to={recordPath(resource)}>{listTitle}</Link>}
        />
      </div>
    );
  }

  const titleDef = def.title;
  const titleEditable = isFieldEditable(titleDef, { canEdit: canManage, isNew, record });
  const titleValue = titleDef.render ? renderCustom(t, titleDef.render, merged) : merged[titleDef.key];
  const recordName = titleValue || (isNew ? t("metaAdsRecords.form.new") : `#${id}`);
  const canDelete = !isNew && canManage && (def.remove === true || (def.remove === "drafts" && (record.is_draft || !record.meta_id)));
  const canDuplicate = !isNew && canManage && def.duplicate;
  const gearItems = [
    canDuplicate ? { key: "duplicate", icon: Copy, label: t("metaAds.common.duplicate"), onClick: duplicate } : null,
    canDelete ? { key: "delete", icon: Trash2, label: t("metaAds.common.delete"), onClick: remove, danger: true } : null,
  ].filter(Boolean);
  const pagerQuery = { listQuery };

  return (
    <div className="mar-page mar-form-page">
      <header className="mar-bar mar-bar--form">
        <div className="mar-bar__start">
          {canManage && (def.create || !isNew) ? (
            <button
              type="button"
              className={`mar-icon-btn mar-icon-btn--save${dirty ? " is-dirty" : ""}`}
              onClick={() => save()}
              disabled={saving || (!dirty && !isNew)}
              aria-label={t("metaAds.common.save")}
              title={t("metaAds.common.save")}
            >
              {saving ? <LoaderCircle size={16} className="m1-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
            </button>
          ) : null}
          {dirty ? (
            <button type="button" className="mar-icon-btn" onClick={discard} aria-label={t("metaAdsRecords.form.discard")} title={t("metaAdsRecords.form.discard")}>
              <Undo2 size={16} aria-hidden="true" />
            </button>
          ) : null}
          {def.create && canManage && !isNew ? (
            <button type="button" className="mar-icon-btn" onClick={() => go(recordPath(resource, "new"))} aria-label={t("metaAdsRecords.form.newRecord")} title={t("metaAdsRecords.form.newRecord")}>
              <Plus size={16} aria-hidden="true" />
            </button>
          ) : null}
          {gearItems.length ? (
            <div className="mar-popover-anchor">
              <button type="button" className="mar-icon-btn mar-icon-btn--plain" onClick={() => setGearOpen((value) => !value)} aria-expanded={gearOpen} aria-label={t("metaAdsRecords.form.more")} title={t("metaAdsRecords.form.more")}>
                <Settings size={16} aria-hidden="true" />
              </button>
              {gearOpen ? <GearMenu items={gearItems} onClose={() => setGearOpen(false)} /> : null}
            </div>
          ) : null}
          <nav className="mar-crumbs" aria-label={t("metaAdsRecords.form.breadcrumb")}>
            <Link to={recordPath(resource)} onClick={(event) => { if (!leaveOk()) event.preventDefault(); }}>{listTitle}</Link>
            <ChevronLeft size={13} className="mar-flip" aria-hidden="true" />
            <span className="mar-crumbs__current" title={recordName}>{recordName}</span>
          </nav>
        </div>

        {!isNew && def.smart.length ? (
          <div className="mar-smart">
            {def.smart.map((button) => {
              const target = button.to(record);
              const onClick = () => {
                if (target.id) go(recordPath(target.resource, target.id));
                else go(`${recordPath(target.resource)}?${new URLSearchParams(target.query || {}).toString()}`);
              };
              return (
                <button key={button.key} type="button" className={`mar-smart__btn mar-smart__btn--${button.key}`} onClick={onClick}>
                  <button.icon size={15} aria-hidden="true" />
                  <span className="mar-smart__label">{t(`metaAdsRecords.${button.label}`)}</span>
                  <strong className="mar-smart__count">{Number(counts[button.key] || 0).toLocaleString(locale)}</strong>
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="mar-bar__end">
          {canDuplicate ? (
            <button type="button" className="mar-btn-ghost" onClick={duplicate}>
              <Copy size={14} aria-hidden="true" />
              {t("metaAds.common.duplicate")}
            </button>
          ) : null}
          {neighbors && neighbors.total ? (
            <div className="mar-pager">
              <span className="mar-pager__text" dir="ltr">{`${neighbors.index.toLocaleString(locale)} / ${neighbors.total.toLocaleString(locale)}`}</span>
              <button type="button" className="mar-icon-btn" disabled={!neighbors.prev_id} onClick={() => go(recordPath(resource, neighbors.prev_id), pagerQuery)} aria-label={t("metaAdsRecords.list.previous")}>
                <ChevronRight size={16} className="mar-flip" aria-hidden="true" />
              </button>
              <button type="button" className="mar-icon-btn" disabled={!neighbors.next_id} onClick={() => go(recordPath(resource, neighbors.next_id), pagerQuery)} aria-label={t("metaAdsRecords.list.next")}>
                <ChevronLeft size={16} className="mar-flip" aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {!isNew && def.actions.length ? (
        <div className="mar-actions" role="toolbar" aria-label={t("metaAdsRecords.actions.toolbar")}>
          {def.actions.map((action) => (
            <button
              key={action.key}
              type="button"
              className={`mar-action${action.confirm ? " mar-action--danger" : ""}`}
              disabled={!canManage || Boolean(busyAction)}
              onClick={() => runAction(action)}
            >
              {busyAction === action.key ? <LoaderCircle size={14} className="m1-spin" aria-hidden="true" /> : <action.icon size={14} aria-hidden="true" />}
              {t(`metaAdsRecords.actions.${action.key}`)}
            </button>
          ))}
        </div>
      ) : null}

      <section className="mar-sheet">
        <div className="mar-sheet__title">
          <FieldLabel def={titleDef} htmlFor={titleEditable ? "mar-title-input" : undefined} />
          {titleEditable ? (
            <input
              id="mar-title-input"
              className="mar-input mar-input--title"
              value={merged[titleDef.key] ?? ""}
              onChange={(event) => setField(titleDef.key, event.target.value)}
              placeholder={t(`metaAdsRecords.${titleDef.label}`)}
            />
          ) : (
            <div className="mar-sheet__name">{titleValue || " "}</div>
          )}
        </div>

        {def.sections.map((section, index) => (
          <div className="mar-section" key={index}>
            {section.heading ? <h2 className="mar-section__heading">{t(`metaAdsRecords.${section.heading}`)}</h2> : null}
            <div className="mar-section__grid">
              {["start", "end"].map((side) => (
                <div className="mar-section__col" key={side}>
                  {section[`${side}Heading`] ? <h2 className="mar-section__heading">{t(`metaAdsRecords.${section[`${side}Heading`]}`)}</h2> : null}
                  {section[`${side}Subheading`] ? <h3 className="mar-section__subheading">{t(`metaAdsRecords.${section[`${side}Subheading`]}`)}</h3> : null}
                  {(section[side] || []).map((field) => (
                    <RecordField
                      key={field.key}
                      def={field}
                      record={record}
                      draft={draft}
                      onChange={setField}
                      isNew={isNew}
                      editable={isFieldEditable(field, { canEdit: canManage, isNew, record })}
                      lookupOptions={field.lookup ? lookups[field.lookup] || [] : []}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}

        {tabs.length ? (
          <div className="mar-tabs">
            <div className="mar-tabs__list" role="tablist">
              {tabs.map((item) => (
                <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={tab === item.key ? "is-active" : ""} onClick={() => setTab(item.key)}>
                  {t(`metaAdsRecords.${item.label}`)}
                </button>
              ))}
            </div>
            <div className="mar-tabs__panel" role="tabpanel">
              {tabs.filter((item) => item.key === tab).map((item) => {
                if (item.kind === "json") return <JsonViewer key={item.key} value={item.value ? item.value(merged) : merged[item.field]} />;
                if (item.kind === "ai") {
                  return (
                    <AiInstructionsTable
                      key={item.key}
                      rows={aiRows}
                      readOnly={!canManage}
                      onChange={(rows) => {
                        setAiRows(rows);
                        setAiDirty(true);
                      }}
                    />
                  );
                }
                return (
                  <CreativeMedia
                    key={item.key}
                    kind={item.kind}
                    record={merged}
                    editable={canManage}
                    onChange={setField}
                  />
                );
              })}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
