export interface CityOption {
  city_id: number;
  city: string;
  /** State / province / region */
  state?: string;
  stateCode?: string;
  country: string;
  /** ISO 3166-1 alpha-2 */
  countryCode?: string;
  district?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  population?: number | null;
  timezone?: string | null;
  currency?: string | null;
  flag?: string;
  /** Full hierarchy label: "Pali, Rajasthan, India" */
  label?: string;
  slug?: string;
}

export interface IndexMetrics {
  cpi_index: number;
  rent_index: number;
  groceries_index: number;
  restaurant_price_index: number;
  local_purchasing_power_index: number;
}

export interface PriceItem {
  item_id: number;
  item_name: string;
  average_price: number;
  highest_price: number;
  lowest_price: number;
  currency: string;
}

export interface CityData {
  city_id: number;
  name: string;
  currency: string;
  symbol: string;
  prices: PriceItem[];
  indices: IndexMetrics;
  exchange_rate: number;
  /** Real | Nearby | Regional | Cached | API | … */
  data_source?: string;
  /** 0–1 */
  confidence?: number;
  confidence_label?: string;
  estimation_note?: string;
}
