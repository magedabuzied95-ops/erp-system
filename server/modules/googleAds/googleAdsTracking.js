import { fail } from './googleAdsApi.js';

export const purchaseAction = () => ({
  name: 'M1 Store - Website Purchase', type: 'WEBPAGE', category: 'PURCHASE', status: 'ENABLED',
  countingType: 'MANY_PER_CLICK', primaryForGoal: true,
  valueSettings: { defaultValue: 0, defaultCurrencyCode: 'EGP', alwaysUseDefaultValue: false },
});
// Google provides HTML snippets. Extract the destination, never execute their HTML/JS.
export const conversionDestination = snippets => {
  for (const snippet of snippets || []) {
    const value = String(snippet.eventSnippet || '').match(/['"]send_to['"]\s*:\s*['"](AW-\d+\/[A-Za-z0-9_-]+)['"]/);
    if (value) return value[1];
  }
  throw fail('Google has not generated the purchase tag yet. Try setup again shortly.', 409);
};
