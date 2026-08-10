import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Globe, MapPin, TrendingUp } from 'lucide-react';
import {
  HOME_RELATED_RESOURCES,
  HOME_TOC,
  buildHomeAboutSection,
  buildHomeComparisonsIntro,
  buildHomeCompleteGuide,
  buildHomeCountryIntro,
  buildHomeDataSourcesSection,
  buildHomeFaqs,
  buildHomeHowItWorks,
  buildHomeMethodologySection,
  buildHomeRelocationIntro,
} from '../../lib/public-content/homepage-content.js';
import type { HomeHubPayload } from '../../lib/public-content/types.js';
import { AUTHORITY_PAGES } from '../../lib/eeat-engine/client.js';
import { applyHomeFaqSchema, applyHomeMeta } from '../utils/seo';
import ContentPageShell, {
  ContentCard,
  ContentChipLink,
  ContentCtaBand,
  ContentLinkGroup,
  ContentNavLink,
  ContentSectionHeading,
} from './ContentPageShell';
import PageMetaBar from './PageMetaBar';
import PageTrustBlock from './PageTrustBlock';
import PublicFaq from './PublicFaq';
import PublicProseSection from './PublicProseSection';
import PublicToc from './PublicToc';

interface Props {
  onNavigate: (path: string) => void;
  onCompareSlug: (slug: string) => void;
  /** Fallback countries if hub API is slow/unavailable */
  fallbackCountries?: Array<{ slug: string; name: string }>;
}

const FALLBACK_COMPARES = [
  { slug: 'new-york-vs-london', label: 'New York vs London' },
  { slug: 'london-vs-tokyo', label: 'London vs Tokyo' },
  { slug: 'paris-vs-berlin', label: 'Paris vs Berlin' },
  { slug: 'sydney-vs-singapore', label: 'Sydney vs Singapore' },
  { slug: 'mumbai-vs-delhi', label: 'Mumbai vs Delhi' },
  { slug: 'toronto-vs-vancouver', label: 'Toronto vs Vancouver' },
  { slug: 'san-francisco-vs-dubai', label: 'San Francisco vs Dubai' },
  { slug: 'zurich-vs-dublin', label: 'Zurich vs Dublin' },
];

function ArticleList({
  title,
  id,
  articles,
  onNavigate,
  emptyHint,
}: {
  title: string;
  id: string;
  articles: HomeHubPayload['latest_articles'];
  onNavigate: (path: string) => void;
  emptyHint?: string;
}) {
  return (
    <ContentCard>
      <div id={id} className="scroll-mt-28">
        <ContentSectionHeading>
          <span className="inline-flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-teal-500" />
            {title}
          </span>
        </ContentSectionHeading>
        {articles.length === 0 ? (
          <p className="mt-4 text-[15px] leading-relaxed text-slate-600 dark:text-slate-400">
            {emptyHint || 'Published guides will appear here when the editorial blog has live articles.'}{' '}
            <ContentNavLink
              href="/blog"
              onNavigate={onNavigate}
              className="font-semibold text-teal-700 hover:underline dark:text-teal-300"
            >
              Visit the blog
            </ContentNavLink>
            .
          </p>
        ) : (
          <ul className="mt-5 space-y-3">
            {articles.map((a) => (
              <li key={a.slug}>
                <ContentNavLink
                  href={`/blog/${a.slug}`}
                  onNavigate={onNavigate}
                  className="block rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 transition hover:border-teal-300 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-teal-500/40"
                >
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">{a.title}</span>
                  {a.excerpt && (
                    <span className="mt-1 block text-xs leading-relaxed text-slate-500 dark:text-slate-400 line-clamp-2">
                      {a.excerpt}
                    </span>
                  )}
                </ContentNavLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ContentCard>
  );
}

export default function HomepageSeoContent({
  onNavigate,
  onCompareSlug,
  fallbackCountries = [],
}: Props) {
  const [hub, setHub] = useState<HomeHubPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/seo/home-hub');
        if (!res.ok) return;
        const data = (await res.json()) as HomeHubPayload;
        if (!cancelled) setHub(data);
      } catch {
        /* graceful: static sections still render */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = hub?.stats;
  const faqs = useMemo(() => buildHomeFaqs(stats), [stats]);
  const countries = hub?.countries?.length ? hub.countries : fallbackCountries;
  const comparisons = hub?.popular_comparisons?.length ? hub.popular_comparisons : FALLBACK_COMPARES;
  const how = buildHomeHowItWorks();
  const guide = buildHomeCompleteGuide();
  const method = buildHomeMethodologySection();
  const sources = buildHomeDataSourcesSection();
  const about = buildHomeAboutSection();

  useEffect(() => {
    applyHomeMeta();
    applyHomeFaqSchema(faqs);
  }, [faqs]);

  const homeUpdated = AUTHORITY_PAGES.methodology?.last_updated || null;

  return (
    <ContentPageShell>
      <PageMetaBar lastUpdated={homeUpdated} onNavigate={onNavigate} />

      <PublicToc items={HOME_TOC} />

      <PublicProseSection {...how} />
      <PublicProseSection {...guide} />

      <ContentCard>
        <div id="popular-relocation-guides" className="scroll-mt-28 space-y-4">
          <ContentSectionHeading>Popular Relocation Guides</ContentSectionHeading>
          <p className="text-[15px] leading-[1.8] text-slate-700 dark:text-slate-300">
            {buildHomeRelocationIntro()}
          </p>
          {(hub?.relocation_guides?.length ?? 0) > 0 ? (
            <ul className="flex flex-wrap gap-2.5">
              {hub!.relocation_guides.map((a) => (
                <li key={`rel-${a.slug}`}>
                  <ContentChipLink
                    href={`/blog/${a.slug}`}
                    label={a.title}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <ContentLinkGroup
              title="Start with these knowledge hubs"
              links={[
                { label: 'Blog & guides', href: '/blog' },
                { label: 'Methodology', href: '/methodology' },
                { label: 'About CityCost', href: '/about' },
                ...comparisons.slice(0, 4).map((c) => ({
                  label: c.label,
                  href: `/compare/${c.slug}`,
                })),
              ]}
              onNavigate={onNavigate}
            />
          )}
        </div>
      </ContentCard>

      <ContentCard>
        <div id="country-explorer" className="scroll-mt-28 space-y-4">
          <ContentSectionHeading>
            <span className="inline-flex items-center gap-2">
              <Globe className="h-5 w-5 text-teal-500" />
              Country Explorer
            </span>
          </ContentSectionHeading>
          <p className="text-[15px] leading-[1.8] text-slate-700 dark:text-slate-300">
            {buildHomeCountryIntro(countries.length || stats?.indexable_countries || 0)}
          </p>
          <div className="flex flex-wrap gap-2">
            {countries.map((c) => (
              <button
                key={c.slug}
                type="button"
                onClick={() => onNavigate(`/country/${c.slug}`)}
                className="cursor-pointer rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-600 transition hover:border-teal-300 hover:text-teal-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-teal-500/40 dark:hover:text-teal-300"
              >
                {c.name}
              </button>
            ))}
          </div>
          {(hub?.popular_cities?.length ?? 0) > 0 && (
            <div className="border-t border-slate-100 pt-4 dark:border-white/10">
              <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                <MapPin className="h-4 w-4 text-teal-500" />
                Popular cities
              </h3>
              <div className="flex flex-wrap gap-2">
                {hub!.popular_cities.map((c) => (
                  <button
                    key={c.slug}
                    type="button"
                    onClick={() => onNavigate(`/city/${c.slug}`)}
                    className="cursor-pointer rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-600 transition hover:border-teal-300 hover:text-teal-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                  >
                    {c.city}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </ContentCard>

      <ContentCard>
        <div id="popular-comparisons" className="scroll-mt-28 space-y-4">
          <ContentSectionHeading>
            <span className="inline-flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-500" />
              Popular City Comparisons
            </span>
          </ContentSectionHeading>
          <p className="text-[15px] leading-[1.8] text-slate-700 dark:text-slate-300">
            {buildHomeComparisonsIntro()}
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {comparisons.map((pair) => (
              <button
                key={pair.slug}
                type="button"
                onClick={() => onCompareSlug(pair.slug)}
                className="cursor-pointer truncate rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-center text-[11px] font-extrabold text-slate-600 transition hover:border-teal-300 hover:text-teal-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
              >
                {pair.label}
              </button>
            ))}
          </div>
        </div>
      </ContentCard>

      <ArticleList
        id="latest-editorial"
        title="Latest Editorial Guides"
        articles={hub?.latest_articles || []}
        onNavigate={onNavigate}
      />

      {(hub?.recently_updated?.length ?? 0) > 0 && (
        <ArticleList
          id="recently-updated-guides"
          title="Recently Updated Guides"
          articles={hub!.recently_updated}
          onNavigate={onNavigate}
        />
      )}

      {(hub?.editorial_picks?.length ?? 0) > 0 && (
        <ArticleList
          id="editorial-picks"
          title="Editorial Picks"
          articles={hub!.editorial_picks}
          onNavigate={onNavigate}
        />
      )}

      {(hub?.seasonal_guides?.length ?? 0) > 0 && (
        <ArticleList
          id="seasonal-guides"
          title="Seasonal Guides"
          articles={hub!.seasonal_guides}
          onNavigate={onNavigate}
          emptyHint="No seasonal-titled guides are published yet."
        />
      )}

      <PublicFaq id="homepage-faq" items={faqs} onNavigate={onNavigate} />

      <PublicProseSection {...method} />
      <PublicProseSection {...sources} />
      <PublicProseSection {...about} />

      <ContentCard>
        <div id="related-resources" className="scroll-mt-28">
          <ContentLinkGroup
            title="Related Resources"
            links={HOME_RELATED_RESOURCES}
            onNavigate={onNavigate}
          />
        </div>
      </ContentCard>

      <PageTrustBlock
        lastUpdated={homeUpdated}
        pageSources={['CityCost Index', 'Public SEO catalog', 'Published editorial guides']}
        onNavigate={onNavigate}
      />

      <ContentCtaBand title="Compare any two cities">
        <p>
          Use the calculator at the top of this page, or open a country hub and drill into city
          pages. Transparent methodology and data sources stay one click away.
        </p>
      </ContentCtaBand>
    </ContentPageShell>
  );
}
