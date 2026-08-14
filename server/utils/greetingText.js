// Facebook does not always give a commenter name, so "{{customer_name}}" can resolve to an
// empty string and leave the Arabic vocative dangling: "أهلاً بحضرتك يا  ❤️".
//
// This runs as the LAST step before a message is sent, because the private-reply worker
// re-renders templates itself — tidying only where a template is first rendered fixes the
// log and not the message the customer receives.
//
// \b is ASCII-only in JavaScript regexes, so the vocative is matched by explicit spacing
// rather than a word boundary.
export const tidyGreetingText = (value = "") => String(value ?? "")
  .replace(/[ \t]+يا(?=[ \t]*(?:$|[\n\p{Extended_Pictographic}،.,!؟?]))/gu, "")
  .replace(/[ \t]{2,}/g, " ")
  .split("\n")
  .map((line) => line.replace(/[ \t]+$/g, ""))
  .join("\n")
  .trim();

export default tidyGreetingText;
