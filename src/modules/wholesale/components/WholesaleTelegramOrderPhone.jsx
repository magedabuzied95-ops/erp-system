import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageCircle, Save } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";
import { IS_WHOLESALE_APP } from "../../../shared/constants/app";

// Wholesale copy only, on the Telegram channels page: the posts carry no price, so their
// button opens WhatsApp with this number and the model + colour already written.

export default function WholesaleTelegramOrderPhone({ cardClassName = "" }) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!IS_WHOLESALE_APP) return;
    api.get("/wholesale/telegram/order-phone").then((res) => setPhone(res.data?.order_whatsapp || "")).catch(() => {});
  }, []);

  if (!IS_WHOLESALE_APP) return null;

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await api.put("/wholesale/telegram/order-phone", { order_whatsapp: phone });
      setPhone(res.data?.order_whatsapp || "");
      toast.success(t("orders.wholesale.telegram.saved"));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className={cardClassName}>
      <div className="mb-1 flex items-center gap-2 text-sm font-black text-[var(--text)]">
        <MessageCircle className="h-4 w-4" aria-hidden="true" />
        {t("orders.wholesale.telegram.title")}
      </div>
      <p className="mb-3 text-xs font-bold text-[var(--text-muted)]">{t("orders.wholesale.telegram.hint")}</p>
      <div className="flex flex-wrap gap-2">
        <input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          inputMode="tel"
          dir="ltr"
          placeholder="01xxxxxxxxx"
          className="h-[var(--control-height-md)] min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-bold text-[var(--text)] outline-none"
        />
        <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 py-2 text-sm font-black text-[var(--primary-contrast)] disabled:opacity-60">
          <Save className="h-4 w-4" aria-hidden="true" />
          {t("orders.wholesale.telegram.save")}
        </button>
      </div>
    </form>
  );
}
