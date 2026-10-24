import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

import { Button, EmptyState, LoadingState, Modal } from "../../shared/ui";
import ThemedSelect from "../../shared/ui/ThemedSelect";
import { hasPermission } from "../../shared/auth/authStorage";
import { formatMoney, formatNumber } from "../tiktokAds/tiktokAdsApi";
import { errorMessage, googleAdsApi, readSelectedAccountId, writeSelectedAccountId } from "./googleAdsApi";

const GoogleAdsContext = createContext(null);
export const useGoogleAds = () => useContext(GoogleAdsContext);

// What every Google Ads page shares: the connection, the chosen ad account, its
// structure and tracking, one confirm dialog and the request helper that refreshes
// them after a change. Pages are routes under /google-ads, like the TikTok module.
export function GoogleAdsProvider({ children }) {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const label = useCallback((arabic, english) => (ar ? arabic : english), [ar]);
  const lang = ar ? "ar" : "en";
  const manage = hasPermission("google_ads.manage");

  const [setup, setSetup] = useState({ loading: true, data: null, error: null });
  const [accounts, setAccounts] = useState([]);
  const [accountsError, setAccountsError] = useState(null);
  const [accountId, setAccountIdState] = useState(() => readSelectedAccountId());
  const [structure, setStructure] = useState({ campaigns: [], groups: [] });
  const [tracking, setTracking] = useState(undefined);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState(null);

  const load = useCallback(async () => {
    setAccountsError(null);
    try {
      const data = await googleAdsApi.setup();
      setSetup({ loading: false, data, error: null });
      if (data?.connected) {
        try {
          const result = await googleAdsApi.accounts();
          setAccounts(result?.accounts || []);
        } catch (error) {
          setAccounts([]);
          setAccountsError(error);
        }
      } else {
        setAccounts([]);
      }
    } catch (error) {
      setSetup({ loading: false, data: null, error });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Coming back from Google: ?google_ads=connected | error
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("google_ads");
    if (!outcome) return;
    if (outcome === "connected") toast.success(label("تم ربط جوجل بنجاح", "Google connected successfully"));
    else toast.error(label("تعذر إكمال الربط. حاول مرة أخرى.", "Authorization failed. Please reconnect."));
    params.delete("google_ads");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [label]);

  const selectable = useMemo(() => accounts.filter((item) => !item.manager), [accounts]);
  const account = selectable.find((item) => String(item.id) === String(accountId)) || selectable[0] || null;
  const currentId = account ? String(account.id) : "";

  const setAccountId = useCallback((next) => {
    setAccountIdState(String(next));
    writeSelectedAccountId(next);
  }, []);

  useEffect(() => {
    if (account && String(account.id) !== String(accountId)) setAccountId(account.id);
  }, [account, accountId, setAccountId]);

  useEffect(() => {
    let active = true;
    setStructure({ campaigns: [], groups: [] });
    if (currentId) {
      googleAdsApi.get(currentId, "/structure")
        .then((data) => { if (active) setStructure({ campaigns: [], groups: [], ...data }); })
        .catch((error) => { if (active) toast.error(errorMessage(error)); });
    }
    return () => { active = false; };
  }, [currentId, refreshKey]);

  useEffect(() => {
    let active = true;
    setTracking(undefined);
    if (currentId) {
      googleAdsApi.get(currentId, "/tracking")
        .then((data) => { if (active) setTracking(data?.tracking || null); })
        .catch(() => { if (active) setTracking(null); });
    }
    return () => { active = false; };
  }, [currentId, refreshKey]);

  // Runs a change; a saved change bumps refreshKey so every page reloads its data.
  const action = useCallback(async (fn, refresh = true) => {
    setBusy(true);
    try {
      await fn();
      if (refresh) {
        setRefreshKey((key) => key + 1);
        toast.success(label("تم حفظ التغييرات", "Changes saved"));
      }
      return true;
    } catch (error) {
      toast.error(errorMessage(error) || label("حصل خطأ، حاول تاني", "Something went wrong"));
      return false;
    } finally {
      setBusy(false);
    }
  }, [label]);

  // body === null reads; anything else posts. A validate-only post changes nothing.
  const request = useCallback((path, body, done) => action(async () => {
    const result = body === null ? await googleAdsApi.get(currentId, path) : await googleAdsApi.post(currentId, path, body);
    done?.(result);
  }, body !== null && body.validateOnly !== true), [action, currentId]);

  const confirm = useCallback((options) => setConfirmState(options), []);
  const runConfirmed = async () => {
    const pending = confirmState;
    await pending?.onConfirm?.();
    setConfirmState(null);
  };

  const money = useCallback((value) => formatMoney(value, account?.currencyCode || "EGP", lang), [account?.currencyCode, lang]);
  const count = useCallback((value, digits = 0) => formatNumber(value, lang, digits), [lang]);

  const value = {
    label, lang, manage, setup, accounts, selectable, accountsError, account, accountId: currentId, setAccountId,
    structure, tracking, setTracking, refreshKey, busy, action, request, confirm, money, count, reload: load,
  };

  return (
    <GoogleAdsContext.Provider value={value}>
      {children}
      <Modal
        open={Boolean(confirmState)}
        size="sm"
        title={confirmState?.title}
        description={confirmState?.body}
        onClose={() => setConfirmState(null)}
        footer={(
          <>
            <Button onClick={() => setConfirmState(null)}>{label("إلغاء", "Cancel")}</Button>
            <Button variant={confirmState?.danger ? "danger" : "primary"} loading={busy} onClick={runConfirmed}>
              {confirmState?.confirmLabel || label("تأكيد", "Confirm")}
            </Button>
          </>
        )}
      />
    </GoogleAdsContext.Provider>
  );
}

// Pages that work on an ad account render only once one is connected and chosen.
export function RequireAccount({ children }) {
  const { label, setup, selectable, accountsError, account } = useGoogleAds();
  if (setup.loading) return <LoadingState />;
  if (setup.error) {
    return <EmptyState title={label("إعلانات جوجل مش جاهزة", "Google Ads is not available")} description={errorMessage(setup.error)} />;
  }
  if (!setup.data?.connected || !account) {
    const connected = setup.data?.connected;
    return (
      <EmptyState
        title={connected ? label("مفيش حساب إعلاني متاح", "No ad account available") : label("مفيش حساب جوجل مربوط", "No Google Ads account connected")}
        description={accountsError
          ? errorMessage(accountsError)
          : connected && !selectable.length
            ? label("الحساب المربوط مالوش حسابات إعلانية يقدر يديرها.", "The connected login has no ad accounts it can manage.")
            : label("اربط حساب Google Ads عشان تشوف الحملات ونتايجها هنا.", "Connect Google Ads to see campaigns and their results here.")}
        action={<Link className="m1-button m1-button--primary m1-button--md" to="/google-ads/connect">{label("ربط حساب جوجل", "Connect Google")}</Link>}
      />
    );
  }
  return children;
}

// The ad-account switcher; with a single account it is just the account's name.
export function AccountPicker() {
  const { label, selectable, account, setAccountId, busy } = useGoogleAds();
  if (!account) return null;
  if (selectable.length < 2) {
    return <span className="tiktok-ads-toolbar__account">{account.descriptiveName || account.id}</span>;
  }
  return (
    <ThemedSelect
      value={String(account.id)}
      disabled={busy}
      onChange={setAccountId}
      options={selectable.map((item) => ({ value: String(item.id), label: `${item.descriptiveName || item.id} (${item.currencyCode})` }))}
      ariaLabel={label("الحساب الإعلاني", "Ad account")}
    />
  );
}

// ThemedSelect with the same label block the kit's Input / Textarea draw.
export function SelectField({ label, className = "", ...props }) {
  return (
    <div className={`m1-control ${className}`.trim()}>
      <span className="m1-control__label">{label}</span>
      <ThemedSelect ariaLabel={label} {...props} />
    </div>
  );
}
