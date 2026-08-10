import {
  buildCompareFaqs,
  buildCompareFood,
  buildCompareHealthcare,
  buildCompareHousing,
  buildCompareProsCons,
  buildCompareRecommendation,
  buildCompareSalary,
  buildCompareSummary,
  buildCompareToc,
  buildCompareTransport,
  type CompareContentInput,
} from '../../lib/public-content/compare-content.js';
import type { CompareSeoEnrichment } from '../../lib/seo-content.js';
import ContentPageShell, {
  ContentBreadcrumb,
  ContentCard,
  ContentLinkGroup,
  ContentSectionHeading,
} from './ContentPageShell';
import PageMetaBar from './PageMetaBar';
import PublicFaq from './PublicFaq';
import PublicProseSection from './PublicProseSection';
import PublicToc from './PublicToc';

export type { CompareContentInput };

interface Props {
  input: CompareContentInput;
  lastUpdated?: string | null;
  relatedLinks?: Array<{ label: string; href: string }>;
  onNavigate: (path: string) => void;
  onCompareSlug?: (slug: string) => void;
}

/** Long-form SEO content below the comparison tool widgets. */
export default function CompareContentSections({
  input,
  lastUpdated,
  relatedLinks = [],
  onNavigate,
}: Props) {
  const summary = buildCompareSummary(input);
  const housing = buildCompareHousing(input);
  const food = buildCompareFood(input);
  const transport = buildCompareTransport(input);
  const healthcare = buildCompareHealthcare(input);
  const salary = buildCompareSalary(input);
  const { pros, cons } = buildCompareProsCons(input);
  const recommendation = buildCompareRecommendation(input);
  const faqs = buildCompareFaqs(input);
  const toc = buildCompareToc();

  return (
    <ContentPageShell>
      <ContentBreadcrumb
        onNavigate={onNavigate}
        items={[
          { label: 'Home', href: '/' },
          { label: 'Compare' },
          { label: `${input.cityA} vs ${input.cityB}` },
        ]}
      />
      <PageMetaBar lastUpdated={lastUpdated} onNavigate={onNavigate} />
      <PublicToc items={toc} />
      <PublicProseSection {...summary} />
      <PublicProseSection {...housing} />
      <PublicProseSection {...food} />
      <PublicProseSection {...transport} />
      <PublicProseSection {...healthcare} />
      <PublicProseSection {...salary} />
      <PublicProseSection {...pros} />
      <PublicProseSection {...cons} />
      <PublicProseSection {...recommendation} />
      <PublicFaq id="compare-faq" items={faqs} onNavigate={onNavigate} />
      {relatedLinks.length > 0 && (
        <ContentCard>
          <div id="compare-related" className="scroll-mt-28">
            <ContentLinkGroup
              title="Related comparisons & hubs"
              links={relatedLinks}
              onNavigate={onNavigate}
            />
          </div>
        </ContentCard>
      )}
      <ContentCard>
        <div id="compare-conclusion" className="scroll-mt-28 space-y-3">
          <ContentSectionHeading>Conclusion</ContentSectionHeading>
          <p className="text-[15px] leading-[1.8] text-slate-700 dark:text-slate-300">
            {input.cityA} vs {input.cityB} should be decided on the constraint that binds your
            household—rent, everyday CPI, or local purchasing power—not a single headline. Re-run
            the calculator above after you have neighbourhood rent quotes, and read Methodology if
            confidence labels differ between the two sides.
          </p>
        </div>
      </ContentCard>
    </ContentPageShell>
  );
}

/** Helper to map live CityData-like objects into CompareContentInput sides. */
export function sideFromCityData(
  label: string,
  data: {
    country?: string;
    currency?: string;
    symbol?: string;
    indices: {
      cpi_index: number;
      rent_index: number;
      groceries_index: number;
      restaurant_price_index: number;
      local_purchasing_power_index: number;
    };
    prices?: Array<{ item_name: string; average_price: number }>;
  }
): CompareContentInput['a'] {
  const byName = (n: string) => data.prices?.find((p) => p.item_name === n)?.average_price;
  return {
    city: label.split(',')[0].trim(),
    country: data.country,
    currency: data.currency,
    symbol: data.symbol,
    cpi: data.indices.cpi_index,
    rent_index: data.indices.rent_index,
    groceries_index: data.indices.groceries_index,
    restaurant_index: data.indices.restaurant_price_index,
    purchasing_power: data.indices.local_purchasing_power_index,
    rent_1br: byName('Apartment (1 bedroom) in City Centre'),
    salary: byName('Average Monthly Net Salary (After Tax)'),
    transport: byName('One-way Ticket (Local Transport)'),
    utilities: byName(
      'Basic (Electricity, Heating, Cooling, Water, Garbage) for 85m2 Apartment'
    ),
    groceries_sample: byName('Milk (regular), (1 liter)'),
    restaurant_meal: byName('Meal, Inexpensive Restaurant'),
  };
}

export type { CompareSeoEnrichment };
