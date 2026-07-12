import { useState, useEffect } from 'react';
import { Shield, Check, X } from 'lucide-react';

export function ConsentBanner() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('gdpr-consent');
      if (!stored) {
        setIsVisible(true);
      } else {
        applyConsent(stored as 'granted' | 'denied');
      }
    }
  }, []);

  const applyConsent = (status: 'granted' | 'denied') => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('gdpr-consent', status);
      
      const gtag = (window as any).gtag;
      if (typeof gtag === 'function') {
        gtag('consent', 'update', {
          'ad_storage': status,
          'analytics_storage': status,
          'ad_user_data': status,
          'ad_personalization': status
        });
      }
    }
  };

  const handleAcceptAll = () => {
    applyConsent('granted');
    setIsVisible(false);
  };

  const handleDenyAll = () => {
    applyConsent('denied');
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 p-4 sm:p-6 bg-slate-900 border-t border-slate-800 text-white shadow-2xl animate-in slide-in-from-bottom duration-300">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-start gap-4 max-w-3xl">
          <div className="p-3 bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 rounded-xl shrink-0 mt-1">
            <Shield className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              GDPR Consent Mode v2 Compliance Notice
            </h4>
            <p className="text-xs text-slate-300 leading-relaxed font-medium">
              We use cookies and equivalent technologies to measure analytics and display personalized Google AdSense ads. In compliance with European Data Protection laws, you can manage your preferences. Rejecting consent will fallback to non-personalized ads.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto shrink-0">
          <button
            onClick={handleDenyAll}
            className="flex-1 md:flex-none text-xs font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700/80 border border-slate-700 px-5 py-3 rounded-xl transition-all active:scale-98 flex items-center justify-center gap-1.5"
          >
            <X className="w-3.5 h-3.5" />
            <span>Non-Personalized Only</span>
          </button>
          
          <button
            onClick={handleAcceptAll}
            className="flex-1 md:flex-none text-xs font-extrabold text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-900/30 px-5 py-3 rounded-xl transition-all active:scale-98 flex items-center justify-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Accept All Cookie Services</span>
          </button>
        </div>
      </div>
    </div>
  );
}
