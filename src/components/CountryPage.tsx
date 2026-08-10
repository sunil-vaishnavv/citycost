import { Globe, MapPin, TrendingUp, TrendingDown } from 'lucide-react';
import TrustStrip from './TrustStrip';
import PageTrustBlock from './PageTrustBlock';
import { buildCountryTrustSignals } from '../../lib/eeat-engine/trust-signals.js';
import {
  buildCountryBudgetSection,
  buildCountryConclusion,
  buildCountryIntro,
  buildCountryLivingExpensesSection,
  buildCountryMajorCitiesSection,
  buildCountryOverviewSection,
  buildCountryRegionalSection,
  buildCountryToc,
  expandCountryFaqs,
  type CountryContentInput,
} from '../../lib/public-content/country-content.js';
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

export interface CountryPageViewData {
  code: string;
  slug: string;
  name: string;
  currency: string;
  symbol: string;
  exchange_rate: number;
  population: number;
  avg_salary: number;
  avg_rent: number;
  avg_groceries_index: number;
  avg_cpi: number;
  cheapest: Array<{ city: string; slug: string; rent: number; cpi: number }>;
  expensive: Array<{ city: string; slug: string; rent: number; cpi: number }>;
  cities: Array<{
    city: string;
    state?: string;
    slug: string;
    population?: number;
    cpi: number;
    rent: number;
  }>;
  top_comparisons: Array<{ slug: string; label: string }>;
  most_compared_cities?: Array<{
    city: string;
    slug: string;
    state?: string;
    compare_count: number;
  }>;
  related_countries: Array<{ slug: string; name: string }>;
  faqs: Array<{ q: string; a: string }>;
  summary: string;
  canonical: string;
  last_updated?: string;
  content_version?: string;
  related_articles?: Array<{ slug: string; title: string; excerpt?: string | null }>;
}

interface Props {
  data: CountryPageViewData;
  onNavigate: (path: string) => void;
  onCompare: (slug: string) => void;
}

function fmt(n: number, symbol: string) {
  return `${symbol}${Math.round(n).toLocaleString()}`;
}

function toInput(data: CountryPageViewData): CountryContentInput {
  return {
    name: data.name,
    slug: data.slug,
    currency: data.currency,
    symbol: data.symbol,
    population: data.population,
    avg_salary: data.avg_salary,
    avg_rent: data.avg_rent,
    avg_cpi: data.avg_cpi,
    avg_groceries_index: data.avg_groceries_index,
    cheapest: data.cheapest,
    expensive: data.expensive,
    cities: data.cities,
    top_comparisons: data.top_comparisons,
    most_compared_cities: data.most_compared_cities,
    related_countries: data.related_countries,
    faqs: data.faqs,
    summary: data.summary,
  };
}

export default function CountryPage({ data, onNavigate, onCompare }: Props) {
  const trust = buildCountryTrustSignals({
    last_updated: data.last_updated,
    content_version: data.content_version,
  });
  const input = toInput(data);
  const toc = buildCountryToc(input);
  const faqs = expandCountryFaqs(input);

  return (
    <ContentPageShell>
      <ContentBreadcrumb
        onNavigate={onNavigate}
        items={[
          { label: 'Home', href: '/' },
          { label: 'Countries' },
          { label: data.name },
        ]}
      />

      <ContentHero
        eyebrow="Country overview"
        icon={<Globe className="h-3.5 w-3.5" />}
        title={`Cost of Living in ${data.name}`}
        intro={buildCountryIntro(input)}
        meta={<PageMetaBar lastUpdated={data.last_updated} onNavigate={onNavigate} />}
      />

      <ContentCard>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Currency', value: data.currency },
            {
              label: 'Population (indexed)',
              value: data.population ? data.population.toLocaleString() : '—',
            },
            { label: 'Avg salary', value: fmt(data.avg_salary, data.symbol) },
            { label: 'Avg 1BR rent', value: fmt(data.avg_rent, data.symbol) },
            { label: 'Avg groceries idx', value: String(data.avg_groceries_index) },
            { label: 'Avg CPI', value: String(data.avg_cpi) },
            { label: 'Indexed cities', value: String(data.cities.length) },
            { label: 'FX vs USD', value: String(data.exchange_rate) },
          ].map((item) => (
            <div
              key={item.label}
              className="bg-slate-50 dark:bg-slate-800/60 border border-slate-150 dark:border-slate-800 rounded-2xl p-3"
            >
              <div className="text-[9px] uppercase tracking-wider font-bold text-slate-400">
                {item.label}
              </div>
              <div className="text-sm font-extrabold text-slate-800 dark:text-white mt-1">
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

      <PublicProseSection {...buildCountryOverviewSection(input)} />
      <PublicProseSection {...buildCountryRegionalSection(input)} />
      <PublicProseSection {...buildCountryLivingExpensesSection(input)} />
      <PublicProseSection {...buildCountryMajorCitiesSection(input)} />
      <PublicProseSection {...buildCountryBudgetSection(input)} />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ContentCard>
          <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
            <TrendingDown className="h-4 w-4 text-emerald-500" />
            Cheapest cities
          </h2>
          <ul className="mt-4 space-y-2">
            {data.cheapest.map((c) => (
              <li key={c.slug}>
                <button
                  type="button"
                  onClick={() => onNavigate(`/city/${c.slug}`)}
                  className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:border-teal-300 hover:text-teal-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-teal-500/40 dark:hover:text-teal-300"
                >
                  <span>{c.city}</span>
                  <span className="font-mono text-slate-400">{fmt(c.rent, data.symbol)}</span>
                </button>
              </li>
            ))}
          </ul>
        </ContentCard>

        <ContentCard>
          <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
            <TrendingUp className="h-4 w-4 text-rose-500" />
            Most expensive cities
          </h2>
          <ul className="mt-4 space-y-2">
            {data.expensive.map((c) => (
              <li key={c.slug}>
                <button
                  type="button"
                  onClick={() => onNavigate(`/city/${c.slug}`)}
                  className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:border-teal-300 hover:text-teal-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-teal-500/40 dark:hover:text-teal-300"
                >
                  <span>{c.city}</span>
                  <span className="font-mono text-slate-400">{fmt(c.rent, data.symbol)}</span>
                </button>
              </li>
            ))}
          </ul>
        </ContentCard>
      </div>

      {(data.most_compared_cities?.length ?? 0) > 0 && (
        <ContentCard>
          <ContentSectionHeading>Most compared cities</ContentSectionHeading>
          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {data.most_compared_cities!.map((c) => (
              <button
                key={`mc-${c.slug}`}
                type="button"
                onClick={() => onNavigate(`/city/${c.slug}`)}
                className="cursor-pointer truncate rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-center text-sm font-semibold text-slate-700 transition hover:border-teal-300 hover:text-teal-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-teal-500/40 dark:hover:text-teal-300"
              >
                {c.city}
              </button>
            ))}
          </div>
        </ContentCard>
      )}

      <ContentCard>
        <div id="country-city-list" className="scroll-mt-28">
          <ContentSectionHeading>
            <span className="inline-flex items-center gap-2">
              <MapPin className="h-5 w-5 text-teal-500" />
              Cities in {data.name}
            </span>
          </ContentSectionHeading>
          <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {data.cities.map((c) => (
              <button
                key={c.slug}
                type="button"
                onClick={() => onNavigate(`/city/${c.slug}`)}
                className="cursor-pointer truncate rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-left text-sm font-semibold text-slate-700 transition hover:border-teal-300 hover:text-teal-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-teal-500/40 dark:hover:text-teal-300"
              >
                {c.city}
                {c.state ? `, ${c.state}` : ''}
              </button>
            ))}
          </div>
        </div>
      </ContentCard>

      {data.top_comparisons.length > 0 && (
        <ContentCard>
          <div id="related-comparisons" className="scroll-mt-28">
            <ContentSectionHeading>Top comparisons</ContentSectionHeading>
            <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {data.top_comparisons.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => onCompare(c.slug)}
                  className="cursor-pointer truncate rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-center text-sm font-semibold text-slate-700 transition hover:border-teal-300 hover:text-teal-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-teal-500/40 dark:hover:text-teal-300"
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </ContentCard>
      )}

      {data.related_countries.length > 0 && (
        <ContentCard>
          <div id="related-countries" className="scroll-mt-28">
            <ContentLinkGroup
              title="Related countries"
              links={data.related_countries.map((c) => ({
                label: c.name,
                href: `/country/${c.slug}`,
              }))}
              onNavigate={onNavigate}
            />
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

      <PublicFaq id="country-faq" items={faqs} onNavigate={onNavigate} />

      <PublicProseSection {...buildCountryConclusion(input)} />

      <PageTrustBlock
        lastUpdated={data.last_updated}
        pageSources={['CityCost Index (aggregated eligible cities)']}
        onNavigate={onNavigate}
      />

      <ContentCtaBand title={`Compare cities in ${data.name}`}>
        <p>
          Pick two metros from the list above, or use the calculator at the top of the site to
          compare any {data.name} city with a peer abroad.
        </p>
      </ContentCtaBand>
    </ContentPageShell>
  );
}
