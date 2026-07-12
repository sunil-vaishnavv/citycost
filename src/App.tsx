import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { 
  Globe, 
  Sparkles, 
  TrendingUp, 
  Search, 
  ChevronDown, 
  HelpCircle, 
  Loader2, 
  ArrowRightLeft, 
  AlertCircle, 
  Compass,
  Check,
  Info,
  Sun,
  Moon,
  Share2,
  Printer,
  Copy,
  TrendingDown,
  ChevronRight
} from 'lucide-react';

import { AdUnit } from './components/AdUnit';
import { ConsentBanner } from './components/ConsentBanner';
import { SummaryDashboard } from './components/SummaryDashboard';
import { IndexChart } from './components/IndexChart';
import { DetailedPriceList } from './components/DetailedPriceList';
import type { CountryPageViewData } from './components/CountryPage';
import type { CityPageViewData } from './components/CityPage';

import { CityOption, CityData } from './types';
import { 
  getCountryFlag, 
  slugify, 
  getRecentComparisons, 
  addRecentComparison,
  formatCityLabel,
  RecentComparison 
} from './utils/helpers';
import {
  applyHomeMeta,
  applyCompareMeta,
  applyCountryMeta,
  applyCityMeta,
  applyAuthorityMeta,
  applyIntentMeta,
} from './utils/seo';
import {
  getAuthorityPage,
  isAuthorityPath,
  AUTHORITY_FOOTER_LINKS,
  type AuthorityPageId,
} from '../lib/eeat-engine/client.js';
import {
  parseCityLandingPath,
  parseCategoryHubPath,
  parseCountryGuidePath,
} from '../lib/search-intent/intent.js';
import type { IntentLandingPublic } from '../lib/search-intent/types.js';

const CountryPage = lazy(() => import('./components/CountryPage'));
const CityPage = lazy(() => import('./components/CityPage'));
const AuthorityPage = lazy(() => import('./components/AuthorityPage'));
const IntentLandingPage = lazy(() => import('./components/IntentLandingPage'));

export default function App() {
  const [cities, setCities] = useState<CityOption[]>([]);
  const [loadingCities, setLoadingCities] = useState(true);
  const [baseSuggestions, setBaseSuggestions] = useState<CityOption[]>([]);
  const [compareSuggestions, setCompareSuggestions] = useState<CityOption[]>([]);
  const [searchingBase, setSearchingBase] = useState(false);
  const [searchingCompare, setSearchingCompare] = useState(false);
  
  const [baseCityQuery, setBaseCityQuery] = useState('');
  const [compareCityQuery, setCompareCityQuery] = useState('');
  const [selectedBase, setSelectedBase] = useState<string>('');
  const [selectedCompare, setSelectedCompare] = useState<string>('');
  
  const [isComparing, setIsComparing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [dataBase, setDataBase] = useState<CityData | null>(null);
  const [dataCompare, setDataCompare] = useState<CityData | null>(null);
  
  const [baseOpen, setBaseOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  const [recentSearches, setRecentSearches] = useState<RecentComparison[]>([]);
  
  // Theme: driven by localStorage → system preference → light
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const saved = localStorage.getItem('col_theme');
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const applyThemeClass = (dark: boolean) => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add('dark');
      localStorage.setItem('col_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('col_theme', 'light');
    }
  };

  const toggleTheme = () => {
    setIsDarkMode((prev) => !prev);
  };

  // Sync <html class="dark"> + localStorage whenever theme state changes
  useEffect(() => {
    applyThemeClass(isDarkMode);
  }, [isDarkMode]);

  /** Navigate to homepage and clear active comparison (keep recent list). */
  const goHome = () => {
    setIsRoute404(false);
    setSeoCountry(null);
    setSeoCity(null);
    setAuthorityPageId(null);
    setIntentPage(null);
    setCompareSeoLinks(null);
    setDataBase(null);
    setDataCompare(null);
    setAiSummary(null);
    setBaseCityQuery('');
    setCompareCityQuery('');
    setSelectedBase('');
    setSelectedCompare('');
    setErrorMsg(null);
    setIsComparing(false);
    setBaseOpen(false);
    setCompareOpen(false);
    routeRestored.current = true;
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.pushState({ view: 'home' }, '', '/');
    }
    applyHomeMeta();
  };

  const [copyFeedback, setCopyFeedback] = useState(false);

  const [isRoute404, setIsRoute404] = useState(false);
  const [seoCountry, setSeoCountry] = useState<CountryPageViewData | null>(null);
  const [seoCity, setSeoCity] = useState<CityPageViewData | null>(null);
  const [authorityPageId, setAuthorityPageId] = useState<AuthorityPageId | null>(null);
  const [intentPage, setIntentPage] = useState<IntentLandingPublic | null>(null);
  const [seoPageLoading, setSeoPageLoading] = useState(false);
  const [catalogCountries, setCatalogCountries] = useState<Array<{ slug: string; name: string }>>([]);
  const [compareSeoLinks, setCompareSeoLinks] = useState<{
    related: Array<{ slug: string; label: string }>;
    nearby: Array<{ slug: string; label: string }>;
  } | null>(null);
  
  const baseRef = useRef<HTMLDivElement>(null);
  const compareRef = useRef<HTMLDivElement>(null);
  const baseSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compareSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeRestored = useRef(false);

  function clearComparisonState() {
    setDataBase(null);
    setDataCompare(null);
    setAiSummary(null);
    setBaseCityQuery('');
    setCompareCityQuery('');
    setSelectedBase('');
    setSelectedCompare('');
    setErrorMsg(null);
    setIsComparing(false);
    setCompareSeoLinks(null);
  }

  async function loadCountryPage(slug: string) {
    setSeoPageLoading(true);
    setIsRoute404(false);
    setSeoCity(null);
    setAuthorityPageId(null);
    setIntentPage(null);
    clearComparisonState();
    try {
      const res = await fetch(`/api/seo/country/${encodeURIComponent(slug)}`);
      if (!res.ok) {
        setSeoCountry(null);
        setIsRoute404(true);
        return;
      }
      const data = (await res.json()) as CountryPageViewData;
      setSeoCountry(data);
      applyCountryMeta(data);
    } catch (err) {
      console.error('Country page load failed:', err);
      setSeoCountry(null);
      setIsRoute404(true);
    } finally {
      setSeoPageLoading(false);
    }
  }

  async function loadCityPage(slug: string) {
    setSeoPageLoading(true);
    setIsRoute404(false);
    setSeoCountry(null);
    setAuthorityPageId(null);
    setIntentPage(null);
    clearComparisonState();
    try {
      const res = await fetch(`/api/seo/city/${encodeURIComponent(slug)}`);
      if (!res.ok) {
        setSeoCity(null);
        setIsRoute404(true);
        return;
      }
      const data = (await res.json()) as CityPageViewData;
      setSeoCity(data);
      applyCityMeta(data);
    } catch (err) {
      console.error('City page load failed:', err);
      setSeoCity(null);
      setIsRoute404(true);
    } finally {
      setSeoPageLoading(false);
    }
  }

  function loadAuthorityPage(id: AuthorityPageId) {
    const doc = getAuthorityPage(id);
    if (!doc) {
      setAuthorityPageId(null);
      setIsRoute404(true);
      return;
    }
    setIsRoute404(false);
    setSeoCountry(null);
    setSeoCity(null);
    setIntentPage(null);
    clearComparisonState();
    setAuthorityPageId(id);
    applyAuthorityMeta(doc);
  }

  async function loadIntentPage(path: string) {
    setSeoPageLoading(true);
    setIsRoute404(false);
    setSeoCountry(null);
    setSeoCity(null);
    setAuthorityPageId(null);
    clearComparisonState();
    try {
      const clean = path.split('?')[0];
      const res = await fetch(`/api/intent/page?path=${encodeURIComponent(clean)}`);
      if (!res.ok) {
        setIntentPage(null);
        setIsRoute404(true);
        return;
      }
      const data = (await res.json()) as IntentLandingPublic;
      setIntentPage(data);
      applyIntentMeta(data);
    } catch (err) {
      console.error('Intent page load failed:', err);
      setIntentPage(null);
      setIsRoute404(true);
    } finally {
      setSeoPageLoading(false);
    }
  }

  function navigateSeo(path: string) {
    const clean = path.split('?')[0];
    if (typeof window !== 'undefined' && window.location.pathname + (window.location.search || '') !== path) {
      window.history.pushState({ view: 'seo' }, '', path);
    }
    const authorityId = isAuthorityPath(clean);
    const categoryHub = parseCategoryHubPath(clean);
    const countryGuide = parseCountryGuidePath(clean);
    const cityLanding = parseCityLandingPath(clean);
    const countryMatch = clean.match(/^\/country\/([a-z0-9-]+)$/i);
    const cityMatch = clean.match(/^\/city\/([a-z0-9-]+)$/i);
    if (clean === '/' || clean === '') {
      goHome();
      return;
    }
    if (authorityId) {
      loadAuthorityPage(authorityId);
      return;
    }
    if (categoryHub || countryGuide || cityLanding) {
      void loadIntentPage(clean);
      return;
    }
    if (countryMatch) {
      void loadCountryPage(countryMatch[1]);
      return;
    }
    if (cityMatch) {
      void loadCityPage(cityMatch[1]);
      return;
    }
    setIsRoute404(true);
  }

  async function openCompareSlug(slug: string) {
    const parts = slug.split('-vs-');
    if (parts.length !== 2) return;
    const [slugA, slugB] = parts;
    setSeoCountry(null);
    setSeoCity(null);
    setAuthorityPageId(null);
    setIntentPage(null);
    setIsRoute404(false);
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', `/compare/${slug}`);
    }
    try {
      const [resA, resB] = await Promise.all([
        fetch(`/api/cities?slug=${encodeURIComponent(slugA)}`),
        fetch(`/api/cities?slug=${encodeURIComponent(slugB)}`),
      ]);
      const dataA = await resA.json();
      const dataB = await resB.json();
      const cityA = (dataA.cities || [])[0] as CityOption | undefined;
      const cityB = (dataB.cities || [])[0] as CityOption | undefined;
      if (cityA && cityB) {
        const queryA = formatCityLabel(cityA);
        const queryB = formatCityLabel(cityB);
        setBaseCityQuery(queryA);
        setCompareCityQuery(queryB);
        await handleCompare(queryA, queryB);
        return;
      }
      // Catalog comparisons may use short names not in geo slug index
      const compsRes = await fetch('/api/seo/comparisons');
      const compsData = await compsRes.json();
      const hit = (compsData.comparisons || []).find((p: { slug: string }) => p.slug === slug) as
        | { queryA: string; queryB: string }
        | undefined;
      if (hit) {
        setBaseCityQuery(hit.queryA);
        setCompareCityQuery(hit.queryB);
        await handleCompare(hit.queryA, hit.queryB);
        return;
      }
    } catch (err) {
      console.error('openCompareSlug failed:', err);
    }
    setIsRoute404(true);
  }

  async function searchCities(query: string): Promise<CityOption[]> {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    params.set('limit', '25');
    const res = await fetch(`/api/cities?${params.toString()}`);
    if (!res.ok) throw new Error(`City search failed (${res.status})`);
    const data = await res.json();
    return (data.cities || []) as CityOption[];
  }

  function scheduleCitySearch(
    query: string,
    target: 'base' | 'compare'
  ) {
    const timerRef = target === 'base' ? baseSearchTimer : compareSearchTimer;
    const setSearching = target === 'base' ? setSearchingBase : setSearchingCompare;
    const setSuggestions = target === 'base' ? setBaseSuggestions : setCompareSuggestions;

    if (timerRef.current) clearTimeout(timerRef.current);
    setSearching(true);
    timerRef.current = setTimeout(async () => {
      try {
        const results = await searchCities(query);
        setSuggestions(results);
      } catch (err) {
        console.error('City search error:', err);
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 200);
  }

  useEffect(() => {
    async function loadPopularCities() {
      try {
        const popular = await searchCities('');
        setCities(popular);
        setBaseSuggestions(popular);
        setCompareSuggestions(popular);
      } catch (err: any) {
        console.error("Cities fetch error:", err);
        const msg = String(err?.message || '');
        if (msg.includes('429') || msg.toLowerCase().includes('too many')) {
          setErrorMsg("Too many requests — wait a moment and refresh the page.");
        } else {
          setErrorMsg("Failed to connect to the backend server. Please verify the server is running.");
        }
      } finally {
        setLoadingCities(false);
      }
    }
    loadPopularCities();
    setRecentSearches(getRecentComparisons());

    return () => {
      if (baseSearchTimer.current) clearTimeout(baseSearchTimer.current);
      if (compareSearchTimer.current) clearTimeout(compareSearchTimer.current);
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (baseRef.current && !baseRef.current.contains(event.target as Node)) {
        setBaseOpen(false);
      }
      if (compareRef.current && !compareRef.current.contains(event.target as Node)) {
        setCompareOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Browser back/forward: restore compare / country / city routes or homepage
  useEffect(() => {
    function onPopState() {
      const path = window.location.pathname;
      const compareMatch = path.match(/^\/compare\/([a-z0-9-]+)-vs-([a-z0-9-]+)/i);
      const countryMatch = path.match(/^\/country\/([a-z0-9-]+)$/i);
      const cityMatch = path.match(/^\/city\/([a-z0-9-]+)$/i);

      if (path === '/' || path === '') {
        setIsRoute404(false);
        setSeoCountry(null);
        setSeoCity(null);
        setAuthorityPageId(null);
        setIntentPage(null);
        clearComparisonState();
        applyHomeMeta();
        return;
      }

      const authorityId = isAuthorityPath(path);
      if (authorityId) {
        loadAuthorityPage(authorityId);
        return;
      }

      if (parseCategoryHubPath(path) || parseCountryGuidePath(path) || parseCityLandingPath(path)) {
        void loadIntentPage(path);
        return;
      }

      if (countryMatch) {
        void loadCountryPage(countryMatch[1]);
        return;
      }

      if (cityMatch) {
        void loadCityPage(cityMatch[1]);
        return;
      }

      if (compareMatch) {
        setIsRoute404(false);
        setSeoCountry(null);
        setSeoCity(null);
        setAuthorityPageId(null);
        setIntentPage(null);
        routeRestored.current = false;
        void openCompareSlug(`${compareMatch[1]}-vs-${compareMatch[2]}`);
        return;
      }

      setIsRoute404(true);
    }

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // ── SEO: Update document head whenever the active comparison changes ───────
  useEffect(() => {
    const path = typeof window !== 'undefined' ? window.location.pathname : '/';
    const isComparePage = /^\/compare\//i.test(path);
    const isCountryPage = /^\/country\//i.test(path);
    const isCityPage = /^\/city\//i.test(path);

    if (isCountryPage || isCityPage) return;

    if (isComparePage && dataBase && dataCompare) {
      applyCompareMeta(selectedBase, selectedCompare, {
        cpiA:  dataBase.indices.cpi_index,
        cpiB:  dataCompare.indices.cpi_index,
        rentA: dataBase.indices.rent_index,
        rentB: dataCompare.indices.rent_index,
        ppA:   dataBase.indices.local_purchasing_power_index,
        ppB:   dataCompare.indices.local_purchasing_power_index,
      });
    } else if (!isComparePage && !seoCountry && !seoCity && !authorityPageId && !intentPage) {
      applyHomeMeta();
    }
  }, [dataBase, dataCompare, selectedBase, selectedCompare, seoCountry, seoCity, authorityPageId, intentPage]);

  // Related / nearby comparison links for compare pages
  useEffect(() => {
    if (!dataBase || !dataCompare || !selectedBase || !selectedCompare) {
      setCompareSeoLinks(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/seo/compare-links?a=${encodeURIComponent(selectedBase.split(',')[0])}&b=${encodeURIComponent(selectedCompare.split(',')[0])}`
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setCompareSeoLinks(data);
      } catch {
        if (!cancelled) setCompareSeoLinks(null);
      }
    })();
    return () => { cancelled = true; };
  }, [dataBase, dataCompare, selectedBase, selectedCompare]);

  useEffect(() => {
    if (loadingCities || routeRestored.current) return;

    async function restoreFromRoute() {
      const path = window.location.pathname;
      const compareMatch = path.match(/^\/compare\/([a-z0-9-]+)-vs-([a-z0-9-]+)/i);
      const countryMatch = path.match(/^\/country\/([a-z0-9-]+)$/i);
      const cityMatch = path.match(/^\/city\/([a-z0-9-]+)$/i);
      const authorityId = isAuthorityPath(path);

      if (authorityId) {
        routeRestored.current = true;
        loadAuthorityPage(authorityId);
        return;
      }

      if (parseCategoryHubPath(path) || parseCountryGuidePath(path) || parseCityLandingPath(path)) {
        routeRestored.current = true;
        void loadIntentPage(path);
        return;
      }

      if (countryMatch) {
        routeRestored.current = true;
        await loadCountryPage(countryMatch[1]);
        return;
      }

      if (cityMatch) {
        routeRestored.current = true;
        await loadCityPage(cityMatch[1]);
        return;
      }

      if (path !== '/' && !compareMatch) {
        setIsRoute404(true);
        routeRestored.current = true;
        return;
      }

      if (compareMatch) {
        const slugA = compareMatch[1];
        const slugB = compareMatch[2];
        routeRestored.current = true;
        await openCompareSlug(`${slugA}-vs-${slugB}`);
        return;
      }

      routeRestored.current = true;
    }

    restoreFromRoute();
  }, [loadingCities]);

  useEffect(() => {
    fetch('/api/seo/countries')
      .then((r) => r.json())
      .then((d) => setCatalogCountries(d.countries || []))
      .catch(() => setCatalogCountries([]));
  }, []);

  async function handleCompare(cityA: string, cityB: string) {
    if (!cityA || !cityB) {
      setErrorMsg("Please select two cities to compare.");
      return;
    }
    if (cityA.trim() === cityB.trim()) {
      setErrorMsg("Please select two different cities for comparison.");
      return;
    }

    setSeoCountry(null);
    setSeoCity(null);
    setAuthorityPageId(null);
    setIntentPage(null);
    setIsRoute404(false);
    setIsComparing(true);
    setErrorMsg(null);
    setAiSummary(null);

    try {
      const [resA, resB] = await Promise.all([
        fetch(`/api/city_prices?query=${encodeURIComponent(cityA.trim())}`),
        fetch(`/api/city_prices?query=${encodeURIComponent(cityB.trim())}`)
      ]);

      if (!resA.ok || !resB.ok) {
        throw new Error("One or both city API endpoints failed to respond.");
      }

      const dataA: CityData = await resA.json();
      const dataB: CityData = await resB.json();

      setDataBase(dataA);
      setDataCompare(dataB);
      setSelectedBase(cityA);
      setSelectedCompare(cityB);

      addRecentComparison(cityA, cityB);
      setRecentSearches(getRecentComparisons());

      const slugA = slugify(cityA.split(',')[0]);
      const slugB = slugify(cityB.split(',')[0]);
      const targetPath = `/compare/${slugA}-vs-${slugB}`;
      
      if (typeof window !== 'undefined') {
        if (window.location.pathname !== targetPath) {
          window.history.pushState({}, '', targetPath);
        }
        
        const gtag = (window as any).gtag;
        if (typeof gtag === 'function') {
          gtag('event', 'compare_cities', {
            'city_a': cityA,
            'city_b': cityB,
            'cpi_a': dataA.indices?.cpi_index || 0,
            'cpi_b': dataB.indices?.cpi_index || 0
          });
        }
      }
    } catch (err: any) {
      console.error("Comparison load error:", err);
      setErrorMsg("Could not fetch comparison data. Please check your network connection or try another city name.");
    } finally {
      setIsComparing(false);
    }
  }

  async function generateAISummary() {
    if (!dataBase || !dataCompare) return;
    setLoadingSummary(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/ai_summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cityA: selectedBase,
          cityB: selectedCompare,
          dataA: dataBase,
          dataB: dataCompare
        })
      });

      if (!res.ok) throw new Error("AI Summary API request failed.");
      const data = await res.json();
      setAiSummary(data.summary);
    } catch (err: any) {
      console.error("AI Generation error:", err);
      setErrorMsg("Failed to generate AI insights. Check server logs or try again.");
    } finally {
      setLoadingSummary(false);
    }
  }

  const canCompare =
    baseCityQuery.trim().length > 0 &&
    compareCityQuery.trim().length > 0 &&
    baseCityQuery.trim().toLowerCase() !== compareCityQuery.trim().toLowerCase() &&
    !isComparing;

  const showBaseCustom =
    baseOpen &&
    baseCityQuery.trim().length >= 2 &&
    !searchingBase &&
    baseSuggestions.length === 0;

  const showCompareCustom =
    compareOpen &&
    compareCityQuery.trim().length >= 2 &&
    !searchingCompare &&
    compareSuggestions.length === 0;

  const handleCopyLink = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    }
  };

  const cityAName = dataBase ? dataBase.name.split(',')[0] : '';
  const cityBName = dataCompare ? dataCompare.name.split(',')[0] : '';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 font-sans antialiased">
      <header className="sticky top-0 z-40 bg-brand-slate/90 dark:bg-brand-slate/95 backdrop-blur-md border-b border-white/10 shadow-sm no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4 flex flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={goHome}
              aria-label="CityCost Global — Go to homepage"
              title="CityCost Global — Home"
              className="flex items-center cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <img 
                src="/Logoo.png" 
                alt="CityCost Global — Cost of Living Comparison Tool"
                width="120"
                height="60"
                fetchPriority="high"
                className="h-14 sm:h-16 lg:h-20 w-auto object-contain drop-shadow-sm pointer-events-none" 
              />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all hover:scale-105 border border-white/15 shadow-sm"
              aria-label="Toggle Dark Mode"
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <span className="relative flex h-2 w-2" title="System online">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          </div>
        </div>
      </header>

      <section className="relative bg-gradient-to-br from-brand-slate to-indigo-950 text-white overflow-hidden py-14 sm:py-20 px-4 sm:px-6 lg:px-8 no-print">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-600 rounded-full mix-blend-screen filter blur-3xl opacity-10 pointer-events-none"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-teal-500 rounded-full mix-blend-screen filter blur-3xl opacity-10 pointer-events-none"></div>
        <div className="absolute top-10 right-10 w-24 h-24 border border-white/5 rounded-full pointer-events-none"></div>
        <div className="absolute bottom-12 left-10 w-32 h-32 border border-white/5 rounded-full pointer-events-none"></div>

        <div className="max-w-4xl mx-auto text-center space-y-4 sm:space-y-6 relative z-10">
          <span className="text-xs font-bold text-teal-400 bg-teal-950/50 border border-teal-900 px-3 py-1.5 rounded-full uppercase tracking-widest inline-flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Interactive Living Index Calculator</span>
          </span>
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black font-display tracking-tight leading-none text-white">
            <span className="text-gradient-indigo-teal text-white">Compare</span> the Cost of Living Between Cities
          </h1>
          <p className="text-xs sm:text-base text-slate-300 max-w-2xl mx-auto font-medium">
            Analyze rent, groceries, local purchasing power, and dining expenditures side by side. Instantly compute how far your wages will stretch.
          </p>
        </div>

        <div className="max-w-4xl mx-auto mt-8 sm:mt-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl text-slate-800 dark:text-slate-200 relative z-20">
          <div className="grid grid-cols-1 md:grid-cols-11 items-center gap-4">
            
            <div className="md:col-span-5 space-y-1.5 relative" ref={baseRef}>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Base Reference City A
              </label>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type="text"
                  value={baseCityQuery}
                  onChange={(e) => {
                    const value = e.target.value;
                    setBaseCityQuery(value);
                    setBaseOpen(true);
                    scheduleCitySearch(value, 'base');
                  }}
                  onFocus={() => {
                    setBaseOpen(true);
                    if (baseSuggestions.length === 0) scheduleCitySearch(baseCityQuery, 'base');
                  }}
                  placeholder="Reference City e.g., New York..."
                  className="w-full bg-slate-50 dark:bg-slate-800 hover:bg-slate-100/50 dark:hover:bg-slate-700/50 focus:bg-white dark:focus:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-indigo-500 rounded-2xl pl-10 pr-10 py-3 text-sm font-semibold transition-all outline-hidden text-slate-800 dark:text-slate-100"
                  id="base_city_input"
                  autoComplete="off"
                />
                <button 
                  onClick={() => setBaseOpen(!baseOpen)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                  type="button"
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${baseOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {baseOpen && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl max-h-60 overflow-y-auto overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                  {searchingBase && (
                    <div className="px-4 py-3 text-xs text-slate-400 font-semibold flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Searching cities worldwide...
                    </div>
                  )}
                  {!searchingBase && baseSuggestions.length > 0 ? (
                    baseSuggestions.map((c) => {
                      const label = formatCityLabel(c);
                      const flag = c.flag || getCountryFlag(c.country);
                      return (
                        <button
                          key={`base-${c.city_id}`}
                          type="button"
                          onClick={() => {
                            setBaseCityQuery(label);
                            setBaseOpen(false);
                          }}
                          className="w-full px-4 py-3 text-left text-sm hover:bg-indigo-50/60 dark:hover:bg-indigo-950/40 hover:text-indigo-600 dark:hover:text-indigo-400 font-semibold transition-colors flex items-center justify-between border-b border-slate-100 dark:border-slate-700/50 last:border-0"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="text-lg shrink-0">{flag}</span>
                            <span className="truncate">
                              <span>{c.city}</span>
                              {(c.state || c.country) && (
                                <span className="text-slate-400 text-xs font-normal">
                                  {`, ${[c.state, c.country].filter(Boolean).join(', ')}`}
                                </span>
                              )}
                            </span>
                          </span>
                          {baseCityQuery === label && <Check className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />}
                        </button>
                      );
                    })
                  ) : null}
                  {showBaseCustom && (
                    <button
                      type="button"
                      onClick={() => setBaseOpen(false)}
                      className="w-full px-4 py-3.5 text-left text-xs text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50/30 dark:bg-indigo-950/20 flex items-center gap-1.5"
                    >
                      <Info className="w-4 h-4 shrink-0" />
                      <span>Use &quot;{baseCityQuery}&quot; as custom city entry</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="md:col-span-1 flex justify-center pt-3 md:pt-4">
              <button
                onClick={() => {
                  const tempQuery = baseCityQuery;
                  setBaseCityQuery(compareCityQuery);
                  setCompareCityQuery(tempQuery);
                }}
                className="bg-slate-100 dark:bg-slate-800 hover:bg-indigo-600 dark:hover:bg-indigo-500 hover:text-white dark:hover:text-white text-slate-500 dark:text-slate-300 p-3 rounded-full border border-slate-200 dark:border-slate-700 shadow-xs transition-all hover:scale-110 active:rotate-180"
                title="Swap cities"
                id="swap_cities_button"
                type="button"
              >
                <ArrowRightLeft className="w-4 h-4 rotate-90 md:rotate-0" />
              </button>
            </div>

            <div className="md:col-span-5 space-y-1.5 relative" ref={compareRef}>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Comparison City B
              </label>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type="text"
                  value={compareCityQuery}
                  onChange={(e) => {
                    const value = e.target.value;
                    setCompareCityQuery(value);
                    setCompareOpen(true);
                    scheduleCitySearch(value, 'compare');
                  }}
                  onFocus={() => {
                    setCompareOpen(true);
                    if (compareSuggestions.length === 0) scheduleCitySearch(compareCityQuery, 'compare');
                  }}
                  placeholder="Comparison City e.g., London..."
                  className="w-full bg-slate-50 dark:bg-slate-800 hover:bg-slate-100/50 dark:hover:bg-slate-700/50 focus:bg-white dark:focus:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-teal-500 rounded-2xl pl-10 pr-10 py-3 text-sm font-semibold transition-all outline-hidden text-slate-800 dark:text-slate-100"
                  id="compare_city_input"
                  autoComplete="off"
                />
                <button 
                  onClick={() => setCompareOpen(!compareOpen)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                  type="button"
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${compareOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {compareOpen && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl max-h-60 overflow-y-auto overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                  {searchingCompare && (
                    <div className="px-4 py-3 text-xs text-slate-400 font-semibold flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Searching cities worldwide...
                    </div>
                  )}
                  {!searchingCompare && compareSuggestions.length > 0 ? (
                    compareSuggestions.map((c) => {
                      const label = formatCityLabel(c);
                      const flag = c.flag || getCountryFlag(c.country);
                      return (
                        <button
                          key={`compare-${c.city_id}`}
                          type="button"
                          onClick={() => {
                            setCompareCityQuery(label);
                            setCompareOpen(false);
                          }}
                          className="w-full px-4 py-3 text-left text-sm hover:bg-teal-50/60 dark:hover:bg-teal-950/40 hover:text-teal-600 dark:hover:text-teal-400 font-semibold transition-colors flex items-center justify-between border-b border-slate-100 dark:border-slate-700/50 last:border-0"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="text-lg shrink-0">{flag}</span>
                            <span className="truncate">
                              <span>{c.city}</span>
                              {(c.state || c.country) && (
                                <span className="text-slate-400 text-xs font-normal">
                                  {`, ${[c.state, c.country].filter(Boolean).join(', ')}`}
                                </span>
                              )}
                            </span>
                          </span>
                          {compareCityQuery === label && <Check className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />}
                        </button>
                      );
                    })
                  ) : null}
                  {showCompareCustom && (
                    <button
                      type="button"
                      onClick={() => setCompareOpen(false)}
                      className="w-full px-4 py-3.5 text-left text-xs text-teal-600 dark:text-teal-400 font-bold bg-teal-50/30 dark:bg-teal-950/20 flex items-center gap-1.5"
                    >
                      <Info className="w-4 h-4 shrink-0" />
                      <span>Use &quot;{compareCityQuery}&quot; as custom city entry</span>
                    </button>
                  )}
                </div>
              )}
            </div>

          </div>

          <div className="mt-5 pt-5 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5 self-start sm:self-auto">
              <HelpCircle className="w-4 h-4 text-slate-400 shrink-0" />
              <span>Select popular benchmarks or type any worldwide municipality!</span>
            </div>

            <button
              onClick={() => handleCompare(baseCityQuery, compareCityQuery)}
              disabled={!canCompare}
              className="w-full sm:w-auto bg-slate-900 dark:bg-indigo-600 hover:bg-indigo-600 dark:hover:bg-indigo-500 text-white font-extrabold text-xs px-8 py-3.5 rounded-2xl transition-all shadow-md active:scale-98 flex items-center justify-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-slate-900 dark:disabled:hover:bg-indigo-600"
              id="compare_button"
              type="button"
            >
              {isComparing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Compiling dynamic parameters...</span>
                </>
              ) : (
                <span>Compare Cities</span>
              )}
            </button>
          </div>
        </div>
      </section>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 relative z-30">
        
        {isRoute404 ? (
          <div className="text-center py-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 space-y-6 shadow-xs max-w-2xl mx-auto animate-in fade-in duration-300">
            <div className="w-20 h-20 bg-rose-50 dark:bg-rose-950/30 text-rose-500 rounded-full flex items-center justify-center mx-auto border border-rose-100 dark:border-rose-900/50">
              <AlertCircle className="w-10 h-10 animate-bounce" />
            </div>
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-rose-500 bg-rose-50 dark:bg-rose-950/40 border border-rose-200/50 px-2.5 py-1 rounded-full uppercase tracking-wider">
                Error 404: Page Not Found
              </span>
              <h3 className="text-2xl font-extrabold text-slate-800 dark:text-white font-display">Lost in the Index Metrics?</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed font-medium">
                We couldn&apos;t find the page you were searching for. It may have been relocated, or is not yet in our SEO catalog.
              </p>
            </div>
            <button
              onClick={goHome}
              className="bg-slate-900 dark:bg-indigo-600 hover:bg-indigo-600 dark:hover:bg-indigo-500 text-white font-extrabold text-xs px-6 py-3 rounded-xl transition-all cursor-pointer"
              type="button"
            >
              Return to Cost Calculator
            </button>
          </div>
        ) : seoPageLoading ? (
          <div className="space-y-6 py-6 no-print">
            <div className="h-44 bg-slate-100 dark:bg-slate-800 rounded-3xl shimmer-bg"></div>
            <div className="h-80 bg-slate-100 dark:bg-slate-800 rounded-3xl shimmer-bg"></div>
          </div>
        ) : authorityPageId ? (
          <Suspense fallback={<div className="h-44 bg-slate-100 dark:bg-slate-800 rounded-3xl shimmer-bg" />}>
            <AuthorityPage doc={getAuthorityPage(authorityPageId)!} onNavigate={navigateSeo} />
          </Suspense>
        ) : intentPage ? (
          <Suspense fallback={<div className="h-44 bg-slate-100 dark:bg-slate-800 rounded-3xl shimmer-bg" />}>
            <IntentLandingPage data={intentPage} onNavigate={navigateSeo} />
          </Suspense>
        ) : seoCountry ? (
          <Suspense fallback={<div className="h-44 bg-slate-100 dark:bg-slate-800 rounded-3xl shimmer-bg" />}>
            <CountryPage data={seoCountry} onNavigate={navigateSeo} onCompare={openCompareSlug} />
          </Suspense>
        ) : seoCity ? (
          <Suspense fallback={<div className="h-44 bg-slate-100 dark:bg-slate-800 rounded-3xl shimmer-bg" />}>
            <CityPage data={seoCity} onNavigate={navigateSeo} onCompare={openCompareSlug} />
          </Suspense>
        ) : (
          <>
            {recentSearches.length > 0 && !isComparing && (
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-wrap items-center gap-3 shadow-xs no-print">
            <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 flex items-center gap-1 shrink-0">
              <Compass className="w-3.5 h-3.5 text-indigo-500" />
              <span>Recent Enquiries:</span>
            </span>
            <div className="flex flex-wrap gap-2">
              {recentSearches.map((item, idx) => {
                const cityAOnly = item.cityA.split(',')[0];
                const cityBOnly = item.cityB.split(',')[0];
                return (
                  <button
                    key={`recent-${idx}`}
                    onClick={() => {
                      setBaseCityQuery(item.cityA);
                      setCompareCityQuery(item.cityB);
                      handleCompare(item.cityA, item.cityB);
                    }}
                    className="text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl transition-all hover-lift flex items-center gap-1"
                  >
                    <span>{cityAOnly}</span>
                    <span className="text-slate-400 text-[9px] font-normal font-mono">vs</span>
                    <span>{cityBOnly}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <AdUnit slotId="1234567890" minHeight="100px" className="mb-2 shadow-xs no-print" />

        {errorMsg && (
          <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 rounded-2xl p-4 flex items-start gap-3 animate-in slide-in-from-bottom-2 duration-200 no-print">
            <AlertCircle className="w-5 h-5 text-rose-500 dark:text-rose-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-extrabold text-rose-800 dark:text-rose-300">Connection or Lookup Notice</h4>
              <p className="text-xs text-rose-600/90 dark:text-rose-400/90 font-semibold mt-1">{errorMsg}</p>
            </div>
          </div>
        )}

        {isComparing && (
          <div className="space-y-6 py-6 no-print">
            <div className="h-44 bg-slate-100 dark:bg-slate-800 rounded-3xl shimmer-bg"></div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-7 h-80 bg-slate-100 dark:bg-slate-800 rounded-3xl shimmer-bg"></div>
              <div className="lg:col-span-5 h-80 bg-slate-100 dark:bg-slate-800 rounded-3xl shimmer-bg"></div>
            </div>
            <div className="h-60 bg-slate-100 dark:bg-slate-800 rounded-3xl shimmer-bg"></div>
          </div>
        )}

        {dataBase && dataCompare && !isComparing && (
          <div className="flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 shadow-xs no-print">
            <div className="text-xs text-slate-400 dark:text-slate-500 font-bold flex items-center gap-1">
              <Info className="w-4 h-4" />
              <span className="hidden sm:inline">Use controls below to save, export, or print reports!</span>
              <span className="inline sm:hidden">Export Comparison Report:</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyLink}
                className="text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 bg-white dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 px-4 py-2 rounded-xl transition-all border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md flex items-center gap-1.5 cursor-pointer"
              >
                {copyFeedback ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Share Link</span>
                  </>
                )}
              </button>

              <button
                onClick={() => window.print()}
                className="text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 bg-white dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 px-4 py-2 rounded-xl transition-all border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Report</span>
              </button>
            </div>
          </div>
        )}

        {dataBase && dataCompare && !isComparing && (
          <div className="space-y-8 animate-in fade-in duration-300">
            
            <div className="print-card">
              <SummaryDashboard dataBase={dataBase} dataCompare={dataCompare} onNavigate={navigateSeo} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
              <div className="lg:col-span-12 print-card">
                <IndexChart dataBase={dataBase} dataCompare={dataCompare} />
              </div>
            </div>

            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xs relative overflow-hidden hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-300 no-print" id="ai_summary_card">
              <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50/50 dark:bg-indigo-950/10 rounded-full blur-2xl pointer-events-none"></div>
              
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-4 flex-wrap gap-4">
                <div className="flex items-center gap-2.5">
                  <div className="bg-gradient-to-tr from-indigo-500 to-purple-600 text-white p-2 rounded-xl shadow-xs">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-bold font-display text-slate-900 dark:text-white">AI Mobility & Affinity Assessment</h3>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold">Smart deep narrative insights powered by Gemini 3.5 Flash</p>
                  </div>
                </div>

                {!aiSummary && !loadingSummary && (
                  <button
                    onClick={generateAISummary}
                    className="bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-500 active:scale-98 text-white text-xs font-extrabold px-5 py-2.5 rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                    id="btn_get_ai_summary"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Generate AI Insights</span>
                  </button>
                )}
              </div>

              <div className="mt-6">
                {loadingSummary ? (
                  <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
                    <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
                    <span className="text-sm font-bold text-slate-600 dark:text-slate-300">Compiling analysis parameters...</span>
                    <span className="text-xs text-slate-400">Comparing relative rents, tax ratios, and buying indexes</span>
                  </div>
                ) : aiSummary ? (
                  <div className="space-y-4 text-slate-700 dark:text-slate-300 text-sm leading-relaxed max-w-none">
                    {aiSummary.split('\n\n').map((paragraph, pIdx) => {
                      const formattedText = paragraph.replace(/\*\*(.*?)\*\*/g, '<strong class="text-indigo-600 dark:text-indigo-400">$1</strong>');
                      return (
                        <p 
                          key={`ai-p-${pIdx}`} 
                          dangerouslySetInnerHTML={{ __html: formattedText }}
                          className="font-medium"
                        />
                      );
                    })}
                    <div className="pt-4 border-t border-slate-100 dark:border-slate-800/85 flex items-center justify-between text-[10px] text-slate-400 font-bold">
                      <span>Analysis based on comparative cost indices</span>
                      <span>Automated cost-of-living calculator</span>
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200 dark:border-slate-800 border-dashed rounded-2xl py-12 text-center flex flex-col items-center justify-center px-4">
                    <Sparkles className="w-8 h-8 text-indigo-300 dark:text-indigo-600 mb-3" />
                    <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">Need a comprehensive natural language breakdown?</h4>
                    <p className="text-xs text-slate-500 max-w-md mt-1 font-medium">
                      Click below to trigger the AI analysis, generating a custom formatted summary of lifestyle compatibility, food baskets, lease factors, and salary ratios between {selectedBase.split(',')[0]} and {selectedCompare.split(',')[0]}.
                    </p>
                    <button
                      onClick={generateAISummary}
                      className="mt-4 bg-slate-900 dark:bg-indigo-600 hover:bg-indigo-600 dark:hover:bg-indigo-500 text-white text-xs font-extrabold px-6 py-3 rounded-xl transition-all hover-lift shadow-xs cursor-pointer"
                    >
                      Compile Living Analysis
                    </button>
                  </div>
                )}
              </div>
            </section>

            <AdUnit slotId="1234567891" minHeight="120px" className="my-6 shadow-xs no-print" />

            <div className="print-card">
              <DetailedPriceList dataBase={dataBase} dataCompare={dataCompare} />
            </div>

            <section className="bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-4 shadow-xs mt-6">
              <h3 className="text-base sm:text-lg font-extrabold font-display text-slate-800 dark:text-white flex items-center gap-2">
                <Globe className="w-5 h-5 text-indigo-500" />
                Cost of Living Comparison Analysis: {cityAName} vs {cityBName}
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed font-medium">
                {(() => {
                  const diffCpi = (((dataCompare.indices.cpi_index - dataBase.indices.cpi_index) / dataBase.indices.cpi_index) * 100).toFixed(0);
                  const diffRent = (((dataCompare.indices.rent_index - dataBase.indices.rent_index) / dataBase.indices.rent_index) * 100).toFixed(0);
                  const diffGroceries = (((dataCompare.indices.groceries_index - dataBase.indices.groceries_index) / dataBase.indices.groceries_index) * 100).toFixed(0);
                  const diffRestaurants = (((dataCompare.indices.restaurant_price_index - dataBase.indices.restaurant_price_index) / dataBase.indices.restaurant_price_index) * 100).toFixed(0);
                  
                  const cpiStatus = Number(diffCpi) > 0 ? "higher" : "lower";
                  const rentStatus = Number(diffRent) > 0 ? "more expensive" : "cheaper";
                  const groceriesStatus = Number(diffGroceries) > 0 ? "more expensive" : "cheaper";
                  const restaurantsStatus = Number(diffRestaurants) > 0 ? "higher" : "lower";
                  
                  const absCpi = Math.abs(Number(diffCpi));
                  const absRent = Math.abs(Number(diffRent));
                  const absGroceries = Math.abs(Number(diffGroceries));
                  const absRestaurants = Math.abs(Number(diffRestaurants));

                  const betterPower = dataBase.indices.local_purchasing_power_index > dataCompare.indices.local_purchasing_power_index ? cityAName : cityBName;
                  const worsePower = dataBase.indices.local_purchasing_power_index > dataCompare.indices.local_purchasing_power_index ? cityBName : cityAName;
                  const powerDiff = Math.abs(((dataCompare.indices.local_purchasing_power_index - dataBase.indices.local_purchasing_power_index) / dataBase.indices.local_purchasing_power_index) * 100).toFixed(0);

                  return `The cost of living in ${cityBName} is approximately ${absCpi}% ${cpiStatus} than in ${cityAName}. Rent prices in ${cityBName} are ${absRent}% ${rentStatus} than in ${cityAName}, representing a substantial difference in monthly shelter expenses. For everyday costs, groceries in ${cityBName} are ${absGroceries}% ${groceriesStatus}, and dining out at local restaurants is about ${absRestaurants}% ${restaurantsStatus} compared to ${cityAName}. When analyzing local purchasing power, residents in ${betterPower} enjoy a ${powerDiff}% higher purchasing power standard than in ${worsePower}, allowing their net monthly salaries to go further for local goods and services. This comprehensive cost comparison indicates that relocating between ${cityAName} and ${cityBName} will require a strategic budget adjustment to match your target lifestyle, savings objectives, and consumer spending habits.`;
                })()}
              </p>
              
              <div className="pt-5 border-t border-slate-200 dark:border-slate-800 space-y-4">
                <h4 className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500">Frequently Asked Questions</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 p-4 rounded-2xl">
                    <h5 className="text-xs font-extrabold text-slate-800 dark:text-slate-200">Is it cheaper to live in {cityAName} or {cityBName}?</h5>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 font-medium leading-relaxed">
                      Overall, {dataBase.indices.cpi_index < dataCompare.indices.cpi_index ? cityAName : cityBName} is cheaper than {dataBase.indices.cpi_index < dataCompare.indices.cpi_index ? cityBName : cityAName}. The cost of living in {cityBName} is {Math.abs(Number((((dataCompare.indices.cpi_index - dataBase.indices.cpi_index) / dataBase.indices.cpi_index) * 100).toFixed(0)))}% {dataCompare.indices.cpi_index > dataBase.indices.cpi_index ? 'higher' : 'lower'} than in {cityAName} (excluding rent).
                    </p>
                  </div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 p-4 rounded-2xl">
                    <h5 className="text-xs font-extrabold text-slate-800 dark:text-slate-200">How do rent prices compare between {cityAName} and {cityBName}?</h5>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 font-medium leading-relaxed">
                      Rent prices in {cityBName} are {Math.abs(Number((((dataCompare.indices.rent_index - dataBase.indices.rent_index) / dataBase.indices.rent_index) * 100).toFixed(0)))}% {dataCompare.indices.rent_index > dataBase.indices.rent_index ? 'higher' : 'lower'} than in {cityAName}.
                    </p>
                  </div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 p-4 rounded-2xl">
                    <h5 className="text-xs font-extrabold text-slate-800 dark:text-slate-200">Which city has better purchasing power, {cityAName} or {cityBName}?</h5>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 font-medium leading-relaxed">
                      {dataBase.indices.local_purchasing_power_index > dataCompare.indices.local_purchasing_power_index ? cityAName : cityBName} has higher local purchasing power. Residents can purchase more goods and services on an average net salary compared to {dataBase.indices.local_purchasing_power_index > dataCompare.indices.local_purchasing_power_index ? cityBName : cityAName}.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {compareSeoLinks && (compareSeoLinks.related.length > 0 || compareSeoLinks.nearby.length > 0) && (
              <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs mt-6 no-print">
                {compareSeoLinks.related.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Related comparisons</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {compareSeoLinks.related.map((p) => (
                        <button
                          key={p.slug}
                          type="button"
                          onClick={() => openCompareSlug(p.slug)}
                          className="text-[11px] font-extrabold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 bg-slate-50 dark:bg-slate-800 border border-slate-150 dark:border-slate-700 px-3 py-3 rounded-xl cursor-pointer text-center truncate"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {compareSeoLinks.nearby.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Nearby comparisons</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {compareSeoLinks.nearby.map((p) => (
                        <button
                          key={p.slug}
                          type="button"
                          onClick={() => openCompareSlug(p.slug)}
                          className="text-[11px] font-extrabold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 bg-slate-50 dark:bg-slate-800 border border-slate-150 dark:border-slate-700 px-3 py-3 rounded-xl cursor-pointer text-center truncate"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            <AdUnit slotId="1234567892" minHeight="100px" className="my-6 shadow-xs no-print" />

          </div>
        )}

        {(!dataBase || !dataCompare) && !isComparing && (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div className="text-center py-16 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 space-y-4">
              <Compass className="w-12 h-12 text-indigo-500 mx-auto animate-spin" style={{ animationDuration: '6s' }} />
              <h3 className="text-lg font-bold text-slate-800 dark:text-white font-display">Select City Comparison</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed font-medium">
                Use the searchable dropdown inputs above to choose your base city and comparison city, then press **Compare Cities** to compile indices, raw pricing charts, and smart summaries.
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xs">
              <article className="prose prose-slate dark:prose-invert max-w-none space-y-4">
                <h3 className="text-lg font-extrabold font-display text-slate-800 dark:text-white">
                  Global Cost of Living Comparison & City Comparison Tool
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-medium">
                  Welcome to the ultimate <strong>city comparison tool</strong> for calculating and comparing costs worldwide. 
                  Whether you are planning a relocation, traveling abroad, or assessing global wages, understanding the 
                  complexities of a <strong>cost of living comparison</strong> is crucial. Local prices, taxes, and household costs 
                  vary drastically from one region to another, making a reliable index calculator an indispensable resource.
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-medium">
                  Our comprehensive database aggregates critical factors including housing rents, supermarket grocery budgets, 
                  utility fees, and restaurant pricing indices. This allows you to evaluate your true household purchasing power. 
                  When choosing the <strong>best cities to live</strong>, looking solely at nominal salaries can be deceptive. A high-salary 
                  city with excessive renting costs can often leave you with less disposable income than a low-cost city with 
                  balanced consumer prices. 
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-medium">
                  Our comparison engine utilizes normalized indexing modeled relative to baseline costs in New York City, 
                  ensuring a stable relative ratio. To explore external data methodologies, we suggest consulting verified authoritative resources 
                  such as the <a href="https://en.wikipedia.org/wiki/Cost_of_living" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline font-bold">Wikipedia Cost of Living Guide</a> or 
                  reviewing crowdsourced indexes directly on the <a href="https://www.numbeo.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline font-bold">Wikipedia Numbeo Database</a>. 
                  Start planning your international move or holiday budget with confidence by selecting any city pair above.
                </p>
              </article>

              <div className="border-t border-slate-150 dark:border-slate-800/80 pt-6 space-y-4">
                <h4 className="text-[10px] font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Globe className="w-4 h-4 text-indigo-500" />
                  <span>Explore by Country</span>
                </h4>
                <div className="flex flex-wrap gap-2">
                  {catalogCountries.map((c) => (
                    <button
                      key={c.slug}
                      type="button"
                      onClick={() => navigateSeo(`/country/${c.slug}`)}
                      className="text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl cursor-pointer"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-150 dark:border-slate-800/80 pt-6 space-y-4">
                <h4 className="text-[10px] font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                  <span>Popular City Comparisons</span>
                </h4>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">
                  Quickly jump into our highest-volume, pre-rendered programmatic comparison pages:
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {[
                    { from: "New York", to: "London", slug: "new-york-vs-london" },
                    { from: "London", to: "Tokyo", slug: "london-vs-tokyo" },
                    { from: "Paris", to: "Berlin", slug: "paris-vs-berlin" },
                    { from: "Sydney", to: "Singapore", slug: "sydney-vs-singapore" },
                    { from: "Mumbai", to: "Delhi", slug: "mumbai-vs-delhi" },
                    { from: "Toronto", to: "Vancouver", slug: "toronto-vs-vancouver" },
                    { from: "San Francisco", to: "Dubai", slug: "san-francisco-vs-dubai" },
                    { from: "Zurich", to: "Dublin", slug: "zurich-vs-dublin" }
                  ].map((pair) => (
                    <a
                      key={pair.slug}
                      href={`/compare/${pair.slug}`}
                      onClick={async (e) => {
                        e.preventDefault();
                        window.history.pushState({}, '', `/compare/${pair.slug}`);
                        
                        const slugA = slugify(pair.from);
                        const slugB = slugify(pair.to);
                        try {
                          const [resA, resB] = await Promise.all([
                            fetch(`/api/cities?slug=${encodeURIComponent(slugA)}`),
                            fetch(`/api/cities?slug=${encodeURIComponent(slugB)}`),
                          ]);
                          const dataA = await resA.json();
                          const dataB = await resB.json();
                          const fCity = (dataA.cities || [])[0] as CityOption | undefined;
                          const tCity = (dataB.cities || [])[0] as CityOption | undefined;
                          if (fCity && tCity) {
                            const queryA = formatCityLabel(fCity);
                            const queryB = formatCityLabel(tCity);
                            setBaseCityQuery(queryA);
                            setCompareCityQuery(queryB);
                            handleCompare(queryA, queryB);
                            return;
                          }
                        } catch (err) {
                          console.error('Popular pair resolve failed:', err);
                        }
                        handleCompare(pair.from, pair.to);
                      }}
                      className="text-[11px] font-extrabold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 bg-slate-50 dark:bg-slate-800 border border-slate-150 dark:border-slate-850 px-3.5 py-3 rounded-xl transition-all text-center truncate block hover-lift"
                    >
                      {pair.from} vs {pair.to}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
          </>
        )}

      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-brand-slate py-12 mt-16 text-center text-[11px] text-slate-400 dark:text-slate-500 font-bold space-y-1.5 no-print">
        <div className="max-w-4xl mx-auto px-4 mb-6">
          <AdUnit slotId="1234567893" minHeight="90px" className="shadow-xs border-slate-100 dark:border-slate-800/80" />
        </div>
        <nav className="flex flex-wrap justify-center gap-x-3 gap-y-2 max-w-3xl mx-auto px-4 pb-3" aria-label="Authority links">
          {AUTHORITY_FOOTER_LINKS.map((l) => (
            <button
              key={l.href}
              type="button"
              onClick={() => navigateSeo(l.href)}
              className="hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
            >
              {l.label}
            </button>
          ))}
        </nav>
        <p className="tracking-wide">Cost-of-Living Comparison Tool • Crafted with Premium Engineering</p>
        <p>© 2026 Cost-of-Living Comparison Tool • Built with ❤️</p>
      </footer>

      <ConsentBanner />
    </div>
  );
}
