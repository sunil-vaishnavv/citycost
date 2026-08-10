/** Shared types for public Tool + Content SEO blocks (not editorial-engine). */

export type TocItem = { id: string; label: string };

export type FaqItem = { q: string; a: string };

export type ContentLink = { label: string; href: string };

export type ProseSection = {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

export type HubArticleCard = {
  slug: string;
  title: string;
  excerpt: string | null;
  content_type: string;
  reading_time_minutes: number | null;
  published_at: string;
  last_public_update_at: string | null;
};

export type HomeHubPayload = {
  countries: Array<{ slug: string; name: string }>;
  popular_cities: Array<{ slug: string; city: string; country: string; label: string }>;
  popular_comparisons: Array<{ slug: string; label: string }>;
  latest_articles: HubArticleCard[];
  recently_updated: HubArticleCard[];
  editorial_picks: HubArticleCard[];
  relocation_guides: HubArticleCard[];
  seasonal_guides: HubArticleCard[];
  stats: {
    indexable_cities: number;
    indexable_countries: number;
    indexable_comparisons: number;
    published_articles: number;
  };
};
