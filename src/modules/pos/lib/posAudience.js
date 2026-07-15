export const inferPosAudienceFromProduct = (...values) => {
  const source = values
    .flat(Infinity)
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  if (!source) return "";
  if (/\b(women|woman|female|ladies)\b|\u062d\u0631\u064a\u0645\u064a|\u0646\u0633\u0627\u0626\u064a|\u0646\u0633\u0627\u0621/.test(source)) return "women";
  if (/\b(kids|kid|children|child|boys|girls)\b|\u0623\u0637\u0641\u0627\u0644|\u0627\u0637\u0641\u0627\u0644|\u0648\u0644\u0627\u062f\u064a|\u0628\u0646\u0627\u062a\u064a/.test(source)) return "kids";
  if (/\b(men|man|male)\b|\u0631\u062c\u0627\u0644\u064a|\u0631\u062c\u0627\u0644/.test(source)) return "men";
  return "";
};
