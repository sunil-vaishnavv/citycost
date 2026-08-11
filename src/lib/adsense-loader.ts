/**
 * Load Google AdSense (adsbygoogle.js) only when SHOW_ADS is enabled.
 *
 * Previously index.html loaded this script unconditionally, which initialized
 * AdSense/SODAR (ep2.adtrafficquality.google) even with ads disabled.
 *
 * When enabling ads (SHOW_ADS=true), ensure CSP script-src includes
 * https://ep2.adtrafficquality.google for SODAR (see server.ts).
 */
import { ADSENSE_CLIENT, SHOW_ADS } from '../config';

let loadPromise: Promise<void> | null = null;

export function loadAdSenseScript(): Promise<void> {
  if (!SHOW_ADS) return Promise.resolve();
  if (typeof document === 'undefined') return Promise.resolve();

  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-citycost-adsense="true"]'
    );
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('AdSense script failed to load')),
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
    script.crossOrigin = 'anonymous';
    script.dataset.citycostAdsense = 'true';
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error('AdSense script failed to load'));
    document.head.appendChild(script);
  });

  return loadPromise;
}
