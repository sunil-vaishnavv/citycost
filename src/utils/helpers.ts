export function getCountryFlag(country: string, fallbackFlag?: string): string {
  if (fallbackFlag) return fallbackFlag;
  if (!country) return '🏙️';
  const cleanCountry = country.trim().toLowerCase();
  
  const flagMap: Record<string, string> = {
    'united states': '🇺🇸',
    'usa': '🇺🇸',
    'united kingdom': '🇬🇧',
    'uk': '🇬🇧',
    'england': '🇬🇧',
    'japan': '🇯🇵',
    'france': '🇫🇷',
    'germany': '🇩🇪',
    'australia': '🇦🇺',
    'singapore': '🇸🇬',
    'india': '🇮🇳',
    'canada': '🇨🇦',
    'united arab emirates': '🇦🇪',
    'uae': '🇦🇪',
    'dubai': '🇦🇪',
    'switzerland': '🇨🇭',
    'ireland': '🇮🇪',
    'brazil': '🇧🇷',
    'netherlands': '🇳🇱',
    'south africa': '🇿🇦',
    'spain': '🇪🇸',
    'italy': '🇮🇹',
    'south korea': '🇰🇷',
    'china': '🇨🇳',
    'sweden': '🇸🇪',
    'norway': '🇳🇴',
    'denmark': '🇩🇰',
    'finland': '🇫🇮',
    'iceland': '🇮🇸',
    'new zealand': '🇳🇿',
    'saudi arabia': '🇸🇦',
    'austria': '🇦🇹',
    'belgium': '🇧🇪',
    'mexico': '🇲🇽',
    'turkey': '🇹🇷',
    'russia': '🇷🇺',
    'hong kong': '🇭🇰',
    'macau': '🇲🇴',
    'taiwan': '🇹🇼',
    'thailand': '🇹🇭',
    'malaysia': '🇲🇾',
    'indonesia': '🇮🇩',
    'vietnam': '🇻🇳',
    'philippines': '🇵🇭',
    'portugal': '🇵🇹',
    'greece': '🇬🇷',
    'poland': '🇵🇱',
    'czech republic': '🇨🇿',
    'hungary': '🇭🇺',
    'romania': '🇷🇴',
    'bulgaria': '🇧🇬',
    'serbia': '🇷🇸',
    'croatia': '🇭🇷',
    'slovenia': '🇸🇮',
    'slovakia': '🇸🇰',
    'ukraine': '🇺🇦',
    'belarus': '🇧🇾',
    'estonia': '🇪🇪',
    'latvia': '🇱🇻',
    'lithuania': '🇱🇹',
    'luxembourg': '🇱🇺',
    'monaco': '🇲🇨',
    'qatar': '🇶🇦',
    'kuwait': '🇰🇼',
    'bahrain': '🇧🇭',
    'oman': '🇴🇲',
    'jordan': '🇯🇴',
    'lebanon': '🇱🇧',
    'israel': '🇮🇱',
    'iran': '🇮🇷',
    'iraq': '🇮🇶',
    'egypt': '🇪🇬',
    'nigeria': '🇳🇬',
    'kenya': '🇰🇪',
    'morocco': '🇲🇦',
    'ghana': '🇬🇭',
    'ethiopia': '🇪🇹',
    'tanzania': '🇹🇿',
    'uganda': '🇺🇬',
    'rwanda': '🇷🇼',
    'pakistan': '🇵🇰',
    'bangladesh': '🇧🇩',
    'sri lanka': '🇱🇰',
    'nepal': '🇳🇵',
    'argentina': '🇦🇷',
    'chile': '🇨🇱',
    'peru': '🇵🇪',
    'colombia': '🇨🇴',
    'venezuela': '🇻🇪',
    'ecuador': '🇪🇨',
    'bolivia': '🇧🇴',
    'uruguay': '🇺🇾',
    'paraguay': '🇵🇾',
    'panama': '🇵🇦',
    'costa rica': '🇨🇷',
    'cuba': '🇨🇺',
    'jamaica': '🇯🇲',
    'dominican republic': '🇩🇴',
    'guatemala': '🇬🇹',
    'kazakhstan': '🇰🇿',
    'uzbekistan': '🇺🇿',
    'azerbaijan': '🇦🇿',
    'georgia': '🇬🇪',
    'armenia': '🇦🇲',
    'mongolia': '🇲🇳',
    'cambodia': '🇰🇭',
    'laos': '🇱🇦',
    'myanmar': '🇲🇲',
    'brunei': '🇧🇳',
    'fiji': '🇫🇯',
    'malta': '🇲🇹',
    'cyprus': '🇨🇾',
    "cote d'ivoire": '🇨🇮',
    'senegal': '🇸🇳',
    'tunisia': '🇹🇳',
    'algeria': '🇩🇿',
    'libya': '🇱🇾',
    'angola': '🇦🇴',
    'mozambique': '🇲🇿',
    'zimbabwe': '🇿🇼',
    'zambia': '🇿🇲',
    'botswana': '🇧🇼',
    'namibia': '🇳🇦',
    'mauritius': '🇲🇺',
    'madagascar': '🇲🇬',
    'democratic republic of the congo': '🇨🇩',
    'republic of the congo': '🇨🇬',
    'cameroon': '🇨🇲',
    'north macedonia': '🇲🇰',
    'bosnia and herzegovina': '🇧🇦',
    'albania': '🇦🇱',
    'montenegro': '🇲🇪',
    'moldova': '🇲🇩',
    'kosovo': '🇽🇰',
  };

  return flagMap[cleanCountry] || '🌐';
}

/** Format hierarchical city label for UI + API queries */
export function formatCityLabel(city: {
  city: string;
  state?: string;
  country: string;
  label?: string;
}): string {
  if (city.label) return city.label;
  return [city.city, city.state, city.country].filter((p) => p && String(p).trim()).join(', ');
}

export function slugify(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export interface RecentComparison {
  cityA: string;
  cityB: string;
  slug: string;
  timestamp: number;
}

export function getRecentComparisons(): RecentComparison[] {
  try {
    const raw = localStorage.getItem('col_recent_searches');
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error fetching recent comparisons', e);
  }
  return [];
}

export function addRecentComparison(cityA: string, cityB: string) {
  try {
    const list = getRecentComparisons();
    const slugA = slugify(cityA.split(',')[0]);
    const slugB = slugify(cityB.split(',')[0]);
    const slug = `${slugA}-vs-${slugB}`;

    // Remove existing if identical to prevent duplicates
    const filtered = list.filter(
      item => 
        !(item.cityA.toLowerCase() === cityA.toLowerCase() && item.cityB.toLowerCase() === cityB.toLowerCase()) &&
        !(item.cityA.toLowerCase() === cityB.toLowerCase() && item.cityB.toLowerCase() === cityA.toLowerCase())
    );

    const updated = [
      { cityA, cityB, slug, timestamp: Date.now() },
      ...filtered
    ].slice(0, 4); // Store top 4 searches

    localStorage.setItem('col_recent_searches', JSON.stringify(updated));
  } catch (e) {
    console.error('Error updating recent comparisons', e);
  }
}

export function convertAndFormat(amount: number, fromExchangeRate: number, toExchangeRate: number, toSymbol: string) {
  const priceInUsd = amount / fromExchangeRate;
  const targetLocalPrice = priceInUsd * toExchangeRate;
  return `${toSymbol}${targetLocalPrice.toLocaleString(undefined, { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  })}`;
}

export function calculateDifferencePercent(valBase: number, rateBase: number, valCompare: number, rateCompare: number) {
  const usdBase = valBase / rateBase;
  const usdCompare = valCompare / rateCompare;
  const diff = ((usdCompare - usdBase) / usdBase) * 100;
  return diff;
}
