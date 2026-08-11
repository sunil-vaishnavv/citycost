import { useEffect, useRef } from 'react';
import { ADSENSE_CLIENT, SHOW_ADS } from '../config';
import { loadAdSenseScript } from '../lib/adsense-loader';

interface AdUnitProps {
  slotId: string;
  minHeight?: string;
  className?: string;
}

export function AdUnit({ slotId, minHeight = '100px', className = '' }: AdUnitProps) {
  const initiated = useRef(false);

  useEffect(() => {
    // Do not push to adsbygoogle when ads are disabled
    if (!SHOW_ADS) return;
    if (initiated.current) return;

    let cancelled = false;
    void loadAdSenseScript()
      .then(() => {
        if (cancelled || initiated.current) return;
        ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({});
        initiated.current = true;
      })
      .catch((error) => {
        console.warn('AdSense tag push ignored or blocked:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [slotId]);

  // When ads are disabled: render nothing — no container, no space, no scripts
  if (!SHOW_ADS) return null;

  return (
    <div 
      className={`relative w-full overflow-hidden bg-slate-50 border border-slate-150/70 rounded-2xl flex flex-col items-center justify-center p-3 sm:p-4 my-6 transition-all hover:border-slate-200 ${className}`}
      style={{ minHeight }}
    >
      <div className="absolute top-1.5 left-3 text-[9px] font-bold text-slate-400 uppercase tracking-wider select-none pointer-events-none">
        Sponsored
      </div>
      <div className="absolute top-1.5 right-3 text-[9px] font-medium text-slate-300 uppercase select-none pointer-events-none">
        ID: {slotId}
      </div>
      
      <div className="w-full flex items-center justify-center mt-3">
          <ins
          className="adsbygoogle"
          style={{ display: 'block', width: '100%', minHeight }}
          data-ad-client={ADSENSE_CLIENT}
          data-ad-slot={slotId}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      </div>
    </div>
  );
}
