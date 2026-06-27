import { NavLink } from "react-router-dom";
import { Image, Settings2, Users2, Video } from "lucide-react";

const tabClass = ({ isActive }) =>
  `inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black transition ${
    isActive
      ? "border-cyan-300/40 bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-500/15"
      : "border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/[0.1]"
  }`;

export default function AiMarketingCenterNav() {
  return (
    <div className="mb-4 -mx-1 overflow-x-auto px-1 pb-1">
      <div className="flex min-w-max flex-nowrap gap-2">
        <NavLink to="/marketing/ai-center" end className={tabClass}>
          <Image className="h-4 w-4" />
          Images
        </NavLink>
        <NavLink to="/marketing/ai-center/leads" className={tabClass}>
          <Users2 className="h-4 w-4" />
          Leads
        </NavLink>
        <NavLink to="/marketing/ai-center/videos" className={tabClass}>
          <Video className="h-4 w-4" />
          Videos
        </NavLink>
        <NavLink to="/ai/settings" className={tabClass}>
          <Settings2 className="h-4 w-4" />
          Settings
        </NavLink>
      </div>
    </div>
  );
}
