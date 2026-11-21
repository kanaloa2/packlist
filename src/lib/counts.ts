import type { CountRule, ItemCategory } from '../types';

/** Things you wear once a day default to "one per day"; everything else to "same for the whole trip". */
export function defaultCountRule(name: string, category: ItemCategory): CountRule {
  if (/\b(socks?|underwear|undies|boxers?|briefs?|bras?|panties|undershirts?|t-?shirts?|tees?)\b/i.test(name)) return 'perDay';
  if (category === 'Medications' && /\b(daily|pills?|vitamins?|doses?)\b/i.test(name)) return 'perDay';
  return 'trip';
}
