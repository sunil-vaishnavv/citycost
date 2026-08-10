import { MapPin, Building2 } from 'lucide-react';
import TrustStrip from './TrustStrip';
import PageTrustBlock from './PageTrustBlock';
import { buildTrustSignals } from '../../lib/eeat-engine/trust-signals.js';
import type { CitySeoSections } from '../../lib/seo-content.js';
import {
  buildCityBudgetSection,
  buildCityConclusion,
  buildCityEducationSection,
  buildCityFoodSection,
  buildCityHealthcareSection,
  buildCityHousingSection,
  buildCityIntro,
  buildCityOverviewSection,
  buildCitySalarySection,
  buildCityToc,
  buildCityTransportSection,
  expandCityFaqs,
  type CityContentInput,
} from '../../lib/public-content/city-content.js';
import ContentPageShell, {
  ContentBreadcrumb,
  ContentCard,
  ContentCtaBand,
  ContentHero,
  ContentLinkGroup,
  ContentNavLink,
  ContentSectionHeading,
} from './ContentPageShell';
import PageMetaBar from './PageMetaBar';
import PublicFaq from './PublicFaq';
import PublicProseSection from './PublicProseSection';
import PublicToc from './PublicToc';

export interface CityPageViewData {
  city: string;
  state: string;
  country: string;
  countryCode: string;
  countrySlug: string;
  slug: string;
  population: number | null;
  timezone: string;
  currency: string;
  symbol: string;
  indices: {
    cpi_index: number;
    rent_index: number;
    groceries_index: number;
    restaurant_price_index: number;
    local_purchasing_power_index: number;
  };
  rent_1br: number;
  salary: number;
  groceries_sample: number;
  transport_sample: number;
  utilities: number;
  restaurant_meal: number;
  nearby: Array<{ city: string; slug: string; state?: string }>;
  related_comparisons: Array<{ slug: string; label: string }>;
  similar_cost_cities?: Array<{ city: string; slug: string; state?: string; cpi: number }>;
  faqs: Array<{ q: string; a: string }>;
  summary: string;
  data_source: string;
  confidence_label: string;
  latitude: number | null;
  longitude: number | null;
  last_updated?: string;
  sections?: CitySeoSections;
  pros?: string[];
  cons?: string[];
  estimation_note?: string | null;
  related_articles?: Array<{ slug: string; title: string; excerpt?: string | null }>;
}

interface Props {
  data: CityPageViewData;
  onNavigate: (path: string) => void;
  onCompare: (slug: string) => void;
}

function fmt(n: number, symbol: string) {
  return `${symbol}${Math.round(n).toLocaleString()}`;
}

function toInput(data: CityPageViewData): CityContentInput {
  return {
    city: data.city,
    state: data.state,
    country: data.country,
    countrySlug: data.countrySlug,
    slug: data.slug,
    currency: data.currency,
    symbol: data.symbol,
    population: data.population,
    indices: data.indices,
    rent_1br: data.rent_1br,
    salary: data.salary,
    groceries_sample: data.groceries_sample,
    transport_sample: data.transport_sample,
    utilities: data.utilities,
    restaurant_meal: data.restaurant_meal,
    summary: data.summary,
    data_source: data.data_source,
    confidence_label: data.confidence_label,
    nearby: data.nearby,
    similar_cost_cities: data.similar_cost_cities,
    related_comparisons: data.related_comparisons,
    faqs: data.faqs,
    sections: data.sections,
    pros: data.pros,
    cons: data.cons,
    estimation_note: data.estimation_note,
  };
}

export default function CityPage({ data, onNavigate, onCompare }: Props) {
  const trust = buildTrustSignals({
    data_source: data.data_source,
    confidence_label: data.confidence_label,
    last_updated: data.last_updated,
  });
  const input = toInput(data);
  const toc = buildCityToc(input);
  const faqs = expandCityFaqs(input);
  const relatedCityLinks = [
    ...data.nearby.map((c) => ({
      label: c.state ? `${c.city}, ${c.state}` : c.city,
      href: `/city/${c.slug}`,
    })),
    ...(data.similar_cost_cities || []).map((c) => ({
      label: `${c.city} (CPI ${c.cpi})`,
      href: `/city/${c.slug}`,
    })),
  ].slice(0, 12);

  return (
    <ContentPageShell>
      <ContentBreadcrumb
        onNavigate={onNavigate}
        items={[
          { label: 'Home', href: '/' },
          { label: data.country, href: `/country/${data.countrySlug}` },
          { label: data.city },
        ]}
      />

      <ContentHero
        eyebrow="City overview"
        icon={<Building2 className="h-3.5 w-3.5" />}
        title={`Cost of Living in ${data.city}${data.state ? `, ${data.state}` : ''}`}
        intro={buildCityIntro(input)}
        meta={<PageMetaBar lastUpdated={data.last_updated} onNavigate={onNavigate} />}
      />

      <ContentCard>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Country', value: data.country },
            { label: 'State / Region', value: data.state || '—' },
            { label: 'Population', value: data.population ? data.population.toLocaleString() : '—' },
            { label: 'Timezone', value: data.timezone },
            { label: 'Currency', value: data.currency },
            { label: 'Avg 1BR rent', value: fmt(data.rent_1br, data.symbol) },
            { label: 'Avg salary', value: fmt(data.salary, data.symbol) },
            { label: 'Cost index (CPI)', value: String(data.indices.cpi_index) },
            { label: 'Groceries (milk 1L)', value: fmt(data.groceries_sample, data.symbol) },
            { label: 'Transport ticket', value: fmt(data.transport_sample, data.symbol) },
            { label: 'Utilities (85m²)', value: fmt(data.utilities, data.symbol) },
            { label: 'Restaurant meal', value: fmt(data.restaurant_meal, data.symbol) },
          ].map((item) => (
            <div
              key={item.label}
              className="bg-slate-50 dark:bg-slate-800/60 border border-slate-150 dark:border-slate-800 rounded-2xl p-3"
            >
              <div className="text-[9px] uppercase tracking-wider font-bold text-slate-400">
                {item.label}
              </div>
              <div
                className="text-sm font-extrabold text-slate-800 dark:text-white mt-1 truncate"
                title={item.value}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <TrustStrip trust={trust} onNavigate={onNavigate} />
        </div>
      </ContentCard>

      <PublicToc items={toc} />

      <PublicProseSection {...buildCityOverviewSection(input)} />
      <PublicProseSection {...buildCityHousingSection(input)} />
      <PublicProseSection {...buildCityFoodSection(input)} />
      <PublicProseSection {...buildCityTransportSection(input)} />
      <PublicProseSection {...buildCityHealthcareSection(input)} />
      <PublicProseSection {...buildCityEducationSection(input)} />
      <PublicProseSection {...buildCitySalarySection(input)} />
      <PublicProseSection {...buildCityBudgetSection(input)} />

      {(data.pros?.length || data.cons?.length) && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {!!data.pros?.length && (
            <ContentCard>
              <ContentSectionHeading>Why consider {data.city}</ContentSectionHeading>
              <ul className="mt-4 space-y-2.5">
                {data.pros.map((p) => (
                  <li
                    key={p}
                    className="flex gap-3 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300"
                  >
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </ContentCard>
          )}
          {!!data.cons?.length && (
            <ContentCard>
              <ContentSectionHeading>Watch-outs</ContentSectionHeading>
              <ul className="mt-4 space-y-2.5">
                {data.cons.map((p) => (
                  <li
                    key={p}
                    className="flex gap-3 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300"
                  >
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </ContentCard>
          )}
        </div>
      )}

      {relatedCityLinks.length > 0 && (
        <ContentCard>
          <div id="related-cities" className="scroll-mt-28">
            <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
              <MapPin className="h-4 w-4 text-teal-500" />
              Related cities
            </h2>
            <div className="mt-4">
              <ContentLinkGroup
                title="Nearby & similar cost"
                links={relatedCityLinks}
                onNavigate={onNavigate}
              />
            </div>
          </div>
        </ContentCard>
      )}

      {data.related_comparisons.length > 0 && (
        <ContentCard>
          <div id="related-comparisons" className="scroll-mt-28">
            <ContentSectionHeading>Top comparisons</ContentSectionHeading>
            <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {data.related_comparisons.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => onCompare(c.slug)}
                  className="truncate rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs font-semibold text-slate-700 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </ContentCard>
      )}

      {(data.related_articles?.length ?? 0) > 0 && (
        <ContentCard>
          <ContentSectionHeading>Related articles</ContentSectionHeading>
          <ul className="mt-4 space-y-2">
            {data.related_articles!.map((a) => (
              <li key={a.slug}>
                <ContentNavLink
                  href={`/blog/${a.slug}`}
                  onNavigate={onNavigate}
                  className="text-sm font-semibold text-teal-700 hover:underline dark:text-teal-300"
                >
                  {a.title}
                </ContentNavLink>
              </li>
            ))}
          </ul>
        </ContentCard>
      )}

      <ContentCard>
        <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
          Country page
        </h2>
        <button
          type="button"
          onClick={() => onNavigate(`/country/${data.countrySlug}`)}
          className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-semibold text-slate-700 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
        >
          Cost of living in {data.country}
        </button>
      </ContentCard>

      <PublicFaq id="city-faq" items={faqs} onNavigate={onNavigate} />

      <PublicProseSection {...buildCityConclusion(input)} />

      <PageTrustBlock
        lastUpdated={data.last_updated}
        pageSources={[data.data_source, data.confidence_label].filter(Boolean)}
        onNavigate={onNavigate}
      />

      <ContentCtaBand title={`Compare ${data.city} with another city`}>
        <p>
          Use the calculator above to run a side-by-side on rent, groceries, salary, and purchasing
          power — or open a related comparison from this page.
        </p>
      </ContentCtaBand>
    </ContentPageShell>
  );
}
