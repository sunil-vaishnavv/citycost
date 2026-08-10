/**
 * Country-specific validator — reusable registry of local-context signals (not one-article hardcoding).
 */

import type { WriterDraftPayload } from '../../draft-validate.js';
import { draftBodyText } from '../../../reviewer/text-utils.js';
import type { ValidatorFinding, ValidatorResult } from './types.js';
import { statusFromScore } from './score.js';

export interface CountryContextProfile {
  /** ISO-ish slug or lowercase country name key */
  key: string;
  aliases: string[];
  /** Natural local signals — currency, regions, housing norms, transport, etc. */
  signals: string[];
  /** Soft anti-stuffing: max mentions of a single keyword before warning */
  stuffRisk?: string[];
}

/** Extensible registry — add countries without special-casing articles. */
export const COUNTRY_CONTEXT_REGISTRY: CountryContextProfile[] = [
  {
    key: 'india',
    aliases: ['india', 'indian'],
    signals: [
      'rupee',
      '₹',
      'inr',
      'metro',
      'tier-2',
      'tier 2',
      'pg ',
      'paying guest',
      'autorickshaw',
      'auto-rickshaw',
      'state',
      'gst',
      'upi',
    ],
    stuffRisk: ['incredible india'],
  },
  {
    key: 'portugal',
    aliases: ['portugal', 'portuguese'],
    signals: ['euro', '€', 'lisbon', 'porto', 'nhr', 'alfama', 'comboios', 'finanças'],
  },
  {
    key: 'germany',
    aliases: ['germany', 'german'],
    signals: ['euro', '€', 'anmeldung', 'kaution', 'bundesland', 'deutschlandticket', 'gebrauchtwohnung'],
  },
  {
    key: 'spain',
    aliases: ['spain', 'spanish'],
    signals: ['euro', '€', 'comunidad', 'autónomo', 'empadronamiento', 'mercado'],
  },
  {
    key: 'united kingdom',
    aliases: ['uk', 'united kingdom', 'britain', 'england'],
    signals: ['pound', '£', 'council tax', 'nhs', 'zone', 'flatshare', 'gbp'],
  },
  {
    key: 'united states',
    aliases: ['usa', 'united states', 'us', 'america'],
    signals: ['dollar', '$', 'usd', 'state tax', 'health insurance', 'subway', '401k'],
  },
  {
    key: 'france',
    aliases: ['france', 'french'],
    signals: ['euro', '€', 'préfecture', 'caf', 'appartement', 'navigo'],
  },
  {
    key: 'japan',
    aliases: ['japan', 'japanese'],
    signals: ['yen', '¥', 'jpy', 'ward', 'jr ', 'key money', 'konbini'],
  },
  {
    key: 'thailand',
    aliases: ['thailand', 'thai'],
    signals: ['baht', '฿', 'thb', 'soi', 'bts', 'condo', 'work permit'],
  },
  {
    key: 'mexico',
    aliases: ['mexico', 'mexican'],
    signals: ['peso', 'mxn', 'colonia', 'imss', 'metrobus'],
  },
];

export function resolveCountryProfile(country?: string): CountryContextProfile | null {
  if (!country) return null;
  const n = country.toLowerCase().trim();
  return (
    COUNTRY_CONTEXT_REGISTRY.find(
      (p) => p.key === n || p.aliases.some((a) => n === a || n.includes(a) || a.includes(n))
    ) || null
  );
}

export function validateCountrySpecific(
  draft: WriterDraftPayload,
  opts: { guideId: string; country?: string }
): ValidatorResult {
  const findings: ValidatorFinding[] = [];
  // Only enforce for country / moving / retirement / budget style national guides
  const national =
    opts.guideId === 'country' ||
    opts.guideId === 'moving' ||
    opts.guideId === 'retirement' ||
    opts.guideId === 'budget';
  if (!national) {
    return {
      category: 'country_specific',
      status: 'PASS',
      score: 100,
      findings: [{ code: 'skipped', message: 'Not a national-scope guide', severity: 'info' }],
    };
  }

  const profile = resolveCountryProfile(opts.country);
  const body = draftBodyText(draft).toLowerCase();

  if (!profile) {
    // Generic national framing without a registry hit — soft check
    const genericLocal =
      /\b(region|currency|local|nationwide|cities|province|state)\b/i.test(body);
    if (!genericLocal) {
      findings.push({
        code: 'missing_local_framing',
        message: 'Country-scope guide lacks local/regional framing',
        severity: 'warn',
      });
    }
    const score = findings.length ? 70 : 90;
    return {
      category: 'country_specific',
      status: statusFromScore(score, false, findings.length > 0),
      score,
      findings,
    };
  }

  const hits = profile.signals.filter((s) => body.includes(s.toLowerCase()));
  if (hits.length < 2) {
    findings.push({
      code: 'thin_local_context',
      message: `Expected more ${profile.key}-specific context (currency, regions, local norms)`,
      severity: 'warn',
    });
  }

  for (const risk of profile.stuffRisk || []) {
    const count = body.split(risk.toLowerCase()).length - 1;
    if (count >= 3) {
      findings.push({
        code: 'keyword_stuffing',
        message: `Possible stuffing of "${risk}"`,
        severity: 'warn',
      });
    }
  }

  // Force-natural: country name repeated every sentence is stuffing
  const alias = profile.aliases[0];
  if (alias) {
    const sentences = body.split(/[.!?]+/).filter((s) => s.trim().length > 20);
    const withName = sentences.filter((s) => s.includes(alias)).length;
    if (sentences.length >= 8 && withName / sentences.length > 0.7) {
      findings.push({
        code: 'forced_country_mentions',
        message: 'Country name appears in most sentences (unnatural)',
        severity: 'warn',
      });
    }
  }

  const score = Math.max(50, 100 - findings.length * 12);
  return {
    category: 'country_specific',
    status: statusFromScore(score, false, findings.length > 0),
    score,
    findings,
  };
}
