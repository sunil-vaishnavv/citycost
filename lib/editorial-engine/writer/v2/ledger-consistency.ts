/**
 * Numerical consistency between a draft and its calculation ledger, and across
 * the draft's own sections (body, FAQ, summary must not contradict each other).
 *
 * Deliberately conservative: only sentences that make an explicit comparison
 * or state an explicit difference are checked, so ordinary price mentions
 * (suburb rents, ranges) are not flagged.
 */

import type { WriterDraftPayload } from '../draft-validate.js';
import type { CalculationLedger } from '../../research/comparison-ledger.js';
import { collectDraftText, type TextLocation } from './prose-integrity.js';

export interface LedgerFinding {
  code:
    | 'direction_contradicts_ledger'
    | 'difference_mismatch'
    | 'inconsistent_difference'
    | 'conflates_remainder';
  severity: 'error' | 'warning';
  message: string;
  location?: TextLocation;
}

const DIFF_TOLERANCE = 0.12;
const AMOUNT_RE = /(?:A\$|AU\$|AUD\s?|US\$|USD\s?|C\$|CAD\s?|NZ\$|S\$|HK\$|\$|€|EUR\s?|£|GBP\s?|¥|₹|INR\s?)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s?(k\b)?/gi;

function amounts(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    let n = Number(m[1]!.replace(/,/g, ''));
    if (m[2]) n *= 1000;
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const RENT_CUE = /\b(rent|rents|housing|apartment|one-bed|1-bed|lease)\b/i;
const OTHER_CATEGORY_CUE = /\b(grocer|food|transport|transit|fare|restaurant|dining|salary|salaries|wage|tax|utilit|internet|childcare|school)\w*/i;
const DIFF_CUE = /\b(difference|gap|cheaper by|less|more|lower|higher|saves?|saving)\b/i;
const MONTH_CUE = /\b(month|monthly|per month|a month)\b|\/mo\b/i;

const AMT = String.raw`((?:A\$|AU\$|AUD\s?|US\$|USD\s?|C\$|NZ\$|S\$|HK\$|\$|€|EUR\s?|£|GBP\s?|¥|₹)\s?\d[\d,]*(?:\.\d+)?\s?k?)`;
const HEDGE = String.raw`(?:about|around|roughly|nearly|almost|some|approximately|just (?:over|under)|close to)?\s*`;
/**
 * Amount a sentence explicitly presents as a difference. Deliberately narrow:
 * "a gap of A$786", "A$786 more/less (a month)", "cheaper by A$786", "saves A$786".
 * Ordinary prices ("rents above A$2,200 a month, higher than …") do not match.
 */
const DIFF_PATTERNS = [
  new RegExp(String.raw`\b(?:difference|gap|saving|savings)\s+(?:of|is|was|comes to|works out (?:to|at)|:)?\s*` + HEDGE + AMT, 'i'),
  new RegExp(
    String.raw`\b(?:difference|gap)\b[^.$€£¥₹]{0,50}?\b(?:is|was|of|comes to|works out (?:to|at)|sits at|stands at)\s+` + HEDGE + AMT,
    'i'
  ),
  new RegExp(AMT + String.raw`\s*(?:a month|per month|monthly|each month|\/mo)?\s+(?:more|less|cheaper|lower|higher)\b`, 'i'),
  new RegExp(String.raw`\b(?:cheaper|less|lower|more|higher|dearer)\s+by\s+` + HEDGE + AMT, 'i'),
  new RegExp(String.raw`\bsaves?\s+(?:you\s+)?` + HEDGE + AMT, 'i'),
];

function statedDifference(sentence: string): number | null {
  for (const re of DIFF_PATTERNS) {
    const m = re.exec(sentence);
    if (m) return amounts(m[1] || '')[0] ?? null;
  }
  return null;
}

/** Every difference the ledger can legitimately support (same-currency or converted). */
function ledgerDifferences(ledger: CalculationLedger | null | undefined): number[] {
  if (!ledger) return [];
  const out: number[] = [];
  if (ledger.difference) out.push(ledger.difference.amount);
  if (ledger.rent_difference != null) out.push(ledger.rent_difference);
  const [a, b] = ledger.sides;
  if (a && b && ledger.same_currency) {
    for (const key of ['modeled_remainder', 'net_salary', 'utilities_85m2', 'internet', 'core_basket', 'rent_1br_centre'] as const) {
      const x = a[key];
      const y = b[key];
      if (typeof x === 'number' && typeof y === 'number' && x !== y) out.push(Math.abs(x - y));
    }
  }
  return out.filter((n) => n > 0);
}

function withinTolerance(stated: number, expected: number): boolean {
  if (expected <= 0) return false;
  return Math.abs(stated - expected) / expected <= DIFF_TOLERANCE;
}

export function validateLedgerConsistency(
  draft: WriterDraftPayload,
  ledger: CalculationLedger | null | undefined
): LedgerFinding[] {
  const findings: LedgerFinding[] = [];
  const texts = collectDraftText(draft).filter((t) => t.loc.field !== 'cell' && t.loc.field !== 'heading');
  const cityNames = (ledger?.sides || []).map((s) => s.city).filter(Boolean);
  const pair = cityNames.length === 2 ? cityNames : [];

  const statedBasketDiffs: Array<{ value: number; loc: TextLocation; sentence: string }> = [];
  const statedRentDiffs: Array<{ value: number; loc: TextLocation; sentence: string }> = [];

  for (const { text, loc } of texts) {
    for (const sentence of sentences(text)) {
      // 1) Direction of explicit comparisons between the two ledger cities.
      if (pair.length === 2) {
        const names = pair.map(esc).join('|');
        const cheaperRe = new RegExp(
          String.raw`\b(${names})\b[^.]{0,60}?\b(?:is|are|remains|stays|comes out|works out)\b[^.]{0,25}?\b(?:cheaper|less expensive|more affordable|lower[- ]cost|lower)\b[^.]{0,20}?\bthan\b[^.]{0,15}?\b(${names})\b`,
          'i'
        );
        const dearerRe = new RegExp(
          String.raw`\b(${names})\b[^.]{0,60}?\b(?:is|are|remains|stays|comes out|works out)\b[^.]{0,25}?\b(?:more expensive|pricier|costlier|dearer|higher[- ]cost|higher)\b[^.]{0,20}?\bthan\b[^.]{0,15}?\b(${names})\b`,
          'i'
        );
        let claimedCheaper: string | null = null;
        const c = cheaperRe.exec(sentence);
        const d = dearerRe.exec(sentence);
        if (c && c[1]!.toLowerCase() !== c[2]!.toLowerCase()) claimedCheaper = c[1]!;
        else if (d && d[1]!.toLowerCase() !== d[2]!.toLowerCase()) claimedCheaper = d[2]!;
        if (claimedCheaper) {
          const canon = pair.find((n) => n.toLowerCase() === claimedCheaper!.toLowerCase())!;
          let expected: string | null = null;
          let basis = '';
          if (RENT_CUE.test(sentence)) {
            expected = ledger?.rent_cheaper ?? null;
            basis = '1-bed city-centre rent';
          } else if (!OTHER_CATEGORY_CUE.test(sentence)) {
            expected = ledger?.difference?.cheaper ?? null;
            basis = 'core monthly basket';
          }
          if (expected && expected !== canon) {
            findings.push({
              code: 'direction_contradicts_ledger',
              severity: 'error',
              message: `Says ${canon} is cheaper, but the ledger's ${basis} is lower in ${expected}: "${sentence.slice(0, 160)}"`,
              location: loc,
            });
          }
        }
      }

      // 2) Stated differences (checked against the ledger and against each other).
      if (DIFF_CUE.test(sentence) && MONTH_CUE.test(sentence) && (pair.length !== 2 || pair.some((n) => sentence.toLowerCase().includes(n.toLowerCase())) || /\bdifference|gap\b/i.test(sentence))) {
        const value = statedDifference(sentence);
        if (value != null) {
          if (RENT_CUE.test(sentence) && !/\bbasket|total|overall|essentials?\b/i.test(sentence)) {
            statedRentDiffs.push({ value, loc, sentence });
          } else if (!OTHER_CATEGORY_CUE.test(sentence)) {
            statedBasketDiffs.push({ value, loc, sentence });
          }
        }
      }

      // 3) Modeled remainder presented as savings / disposable income.
      // A correct disclaimer ("…is not disposable income or savings") is not a conflation.
      const negatedSavings = /\b(?:not|isn't|is not|never|rather than|instead of)\s+(?:\w+\s+){0,2}(?:disposable income|savings?)\b/i.test(sentence);
      if (!negatedSavings && /\b(disposable income|savings?|left to save|you (?:can|could|will) save)\b/i.test(sentence)) {
        const remainders = (ledger?.sides || []).map((s) => s.modeled_remainder).filter((v): v is number => v != null);
        const hit = /\bremainder\b/i.test(sentence) || amounts(sentence).some((a) => remainders.some((r) => Math.abs(a - r) / r <= 0.02));
        if (hit) {
          findings.push({
            code: 'conflates_remainder',
            severity: 'warning',
            message: `Modeled remainder presented as savings/disposable income: "${sentence.slice(0, 160)}"`,
            location: loc,
          });
        }
      }
    }
  }

  const supported = ledgerDifferences(ledger);
  const checkAgainst = (
    stated: typeof statedBasketDiffs,
    expected: number | null | undefined,
    label: string
  ) => {
    if (expected != null && expected > 0) {
      for (const s of stated) {
        // Any figure the ledger supports (basket, rent, remainder, salary…) is legitimate.
        if (supported.some((v) => withinTolerance(s.value, v))) continue;
        if (!withinTolerance(s.value, expected)) {
          findings.push({
            code: 'difference_mismatch',
            severity: 'error',
            message: `${label} stated as ${Math.round(s.value)} but the ledger gives ${expected}: "${s.sentence.slice(0, 160)}"`,
            location: s.loc,
          });
        }
      }
    } else if (stated.length >= 2) {
      const vals = stated.map((s) => s.value);
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      if (lo > 0 && (hi - lo) / lo > DIFF_TOLERANCE) {
        findings.push({
          code: 'inconsistent_difference',
          severity: 'error',
          message: `${label} is stated inconsistently across sections (${vals.map(Math.round).join(' vs ')})`,
          location: stated[stated.length - 1]!.loc,
        });
      }
    }
  };
  checkAgainst(statedBasketDiffs, ledger?.difference?.amount, 'Monthly basket difference');
  checkAgainst(statedRentDiffs, ledger?.rent_difference, 'Monthly rent difference');
  return findings;
}
