import { ITEM_CATEGORIES, ITEM_TYPES, type Item } from '../types';

const PATTERNS: [RegExp, (typeof ITEM_TYPES)[number]][] = [
  [/\b(jackets?|coats?|blazers?|parkas?|windbreakers?|raincoats?|vests?)\b/i, 'Jackets & coats'],
  [/\b(sweaters?|hoodies?|cardigans?|sweatshirts?|fleeces?|pullovers?|jumpers?)\b/i, 'Sweaters'],
  [/\b(shirts?|t-?shirts?|tees?|blouses?|polos?|tops?|tanks?|camis?)\b/i, 'Shirts'],
  [/\b(pants|jeans|trousers|chinos|slacks|leggings|joggers|sweatpants)\b/i, 'Pants'],
  [/\b(shorts)\b/i, 'Shorts'],
  [/\b(dress(es)?|skirts?|gowns?)\b/i, 'Dresses & skirts'],
  [/\b(shoes?|sneakers?|boots?|sandals?|heels|loafers|flip ?flops|trainers|slippers)\b/i, 'Shoes'],
  [/\b(socks?)\b/i, 'Socks'],
  [/\b(underwear|undies|boxers?|briefs?|bras?|panties|undershirts?)\b/i, 'Underwear'],
  [/\b(pajamas?|pyjamas?|pjs|nightgowns?|robes?|sleepwear)\b/i, 'Sleepwear'],
  [/\b(swimsuits?|bikinis?|trunks|swim ?wear|board ?shorts)\b/i, 'Swimwear'],
  [/\b(hats?|caps?|beanies?|visors?)\b/i, 'Hats'],
  [/\b(bags?|backpacks?|purses?|totes?|clutch(es)?)\b/i, 'Bags'],
  [/\b(belts?|ties?|scarf|scarves|gloves?|watch(es)?|sunglasses|jewel(le)?ry|necklaces?|earrings?|bracelets?|rings?|cufflinks)\b/i, 'Accessories'],
];

/** A best guess at an item's type from its name (e.g. "Navy blazer" → "Jackets & coats"), or ''. */
export function suggestKind(name: string): string {
  // Check swimwear before shorts/shirts so "board shorts" and "swim trunks" land in Swimwear.
  const swim = PATTERNS.find(([, k]) => k === 'Swimwear')!;
  if (swim[0].test(name)) return swim[1];
  // The last matching word usually names the thing: "dress shoes" are shoes, "dress shirt" a shirt.
  let best = '';
  let bestAt = -1;
  for (const [re, kind] of PATTERNS) {
    const global = new RegExp(re.source, 'gi');
    for (const m of name.matchAll(global)) {
      if (m.index! > bestAt) {
        bestAt = m.index!;
        best = kind;
      }
    }
  }
  return best;
}

/** The label an item is grouped under when grouping by type: its type, or its category if it has none. */
export function typeLabel(item: Pick<Item, 'kind' | 'category'>): string {
  return item.kind?.trim() || item.category;
}

/**
 * Sort order for type groups: suggested types in their natural order, then the user's own
 * types alphabetically, then category fallbacks (Toiletries, Documents, …) in category order.
 */
export function typeRank(label: string): [number, string] {
  const lower = label.toLowerCase();
  const preset = ITEM_TYPES.findIndex((t) => t.toLowerCase() === lower);
  if (preset >= 0) return [preset, ''];
  const cat = (ITEM_CATEGORIES as readonly string[]).findIndex((c) => c.toLowerCase() === lower);
  if (cat >= 0) return [200 + cat, ''];
  return [100, lower];
}

/** Types to offer in the item form: the suggestions plus every type the user has made up. */
export function typeOptions(items: Pick<Item, 'kind'>[]): string[] {
  const custom = new Map<string, string>();
  for (const i of items) {
    const k = i.kind?.trim();
    if (k && !ITEM_TYPES.some((t) => t.toLowerCase() === k.toLowerCase())) custom.set(k.toLowerCase(), k);
  }
  return [...ITEM_TYPES, ...[...custom.values()].sort((a, b) => a.localeCompare(b))];
}
