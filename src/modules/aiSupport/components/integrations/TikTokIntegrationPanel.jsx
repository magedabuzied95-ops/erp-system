// TikTok integration panel.
//
// Two TikTok apps, two approval states, two cards — see the header comments in
// TikTokConnectionCard (publishing, connectable today) and TikTokBusinessCard
// (messaging + comments, awaiting a separate Business API grant). Neither is an
// inbox conversation source, which is why this panel says so up front instead
// of letting the reader assume TikTok DMs will start arriving.

import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";

import TikTokBusinessCard from "../TikTokBusinessCard.jsx";
import TikTokConnectionCard from "../TikTokConnectionCard.jsx";

export default function TikTokIntegrationPanel() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-xs leading-5 text-slate-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />
        {t("aiSupport.integrations.tiktok.scopeNote")}
      </p>
      <TikTokConnectionCard />
      <TikTokBusinessCard />
    </div>
  );
}
