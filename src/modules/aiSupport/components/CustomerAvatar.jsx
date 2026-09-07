import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { avatarInitials, isKnownDeadAvatar, rememberDeadAvatar } from "../lib/customerIdentity.js";

// The one avatar used across the inbox list, the thread header and the customer
// drawer. A picture URL from Meta is a cache, not a fact: it expires, and the CDN
// answers 403/404 later. When the <img> fails, this falls back to initials (or the
// user glyph) instead of leaving a broken-image tile in the list, and remembers the
// dead URL for the session so a re-render does not retry it.

export default function CustomerAvatar({
  url = "",
  name = "",
  className = "",
  imgClassName = "",
  fallbackClassName = "",
  iconClassName = "h-5 w-5",
  showInitials = true,
  onDead = null,
}) {
  const avatar = String(url || "").trim();
  const [failed, setFailed] = useState(() => isKnownDeadAvatar(avatar));

  useEffect(() => {
    setFailed(isKnownDeadAvatar(avatar));
  }, [avatar]);

  const usable = avatar && /^https?:\/\//i.test(avatar) && !failed;
  if (usable) {
    return (
      <img
        src={avatar}
        alt=""
        className={`${className} ${imgClassName}`.trim()}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => {
          rememberDeadAvatar(avatar);
          setFailed(true);
          onDead?.(avatar);
        }}
      />
    );
  }
  const initials = showInitials ? avatarInitials(name) : "";
  return (
    <span
      data-customer-avatar-fallback="true"
      aria-hidden="true"
      className={`grid place-items-center overflow-hidden ${className} ${fallbackClassName}`.trim()}
    >
      {initials ? <span className="text-xs font-bold leading-none tracking-wide">{initials}</span> : <User className={iconClassName} />}
    </span>
  );
}
