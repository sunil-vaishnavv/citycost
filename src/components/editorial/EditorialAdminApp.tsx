import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  CalendarClock,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  LayoutDashboard,
  ListTree,
  Lock,
  LogOut,
  Menu,
  Moon,
  Settings2,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { ApiError, getAuthToken, login as apiLogin, logout as apiLogout } from './api';
import { Button, Callout, Field, Input } from './ui';
import DashboardPanel from './DashboardPanel';
import ArticlesPanel from './ArticlesPanel';
import TopicsPanel from './TopicsPanel';
import AutomationPanel from './AutomationPanel';
import SettingsPanel from './SettingsPanel';
import { JobCenterDropdown, JobsProvider, useEditorialJobs } from './jobs/JobsProvider';
import { adminPageFromPath, adminPathForPage, navigateArticles } from './admin-routes';

export type AdminPage = 'dashboard' | 'articles' | 'topics' | 'automation' | 'settings';

const NAV_ITEMS: Array<{ key: AdminPage; label: string; icon: ReactNode; description: string }> = [
  { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-[18px] w-[18px]" />, description: 'Overview' },
  { key: 'articles', label: 'Articles', icon: <FileText className="h-[18px] w-[18px]" />, description: 'Drafting & publishing' },
  { key: 'topics', label: 'Topics', icon: <ListTree className="h-[18px] w-[18px]" />, description: 'Strategy pipeline' },
  { key: 'automation', label: 'Automation', icon: <CalendarClock className="h-[18px] w-[18px]" />, description: 'Daily pipeline' },
  { key: 'settings', label: 'Settings', icon: <Settings2 className="h-[18px] w-[18px]" />, description: 'Configuration' },
];

function useTheme() {
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const saved = localStorage.getItem('col_theme');
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add('dark');
      localStorage.setItem('col_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('col_theme', 'light');
    }
  }, [dark]);

  return { dark, toggle: () => setDark((d) => !d) };
}

function BackgroundMesh() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900" />
      <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-teal-200/30 blur-3xl dark:bg-teal-500/10" />
      <div className="absolute -top-24 right-0 h-96 w-96 rounded-full bg-indigo-200/25 blur-3xl dark:bg-indigo-500/10" />
      <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-slate-200/40 blur-3xl dark:bg-white/[0.03]" />
    </div>
  );
}

function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await apiLogin(password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen text-slate-900 dark:text-slate-100">
      <BackgroundMesh />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm editorial-fade-in">
          <div className="mb-7 flex flex-col items-center text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-900/20 dark:bg-teal-600 dark:shadow-teal-900/30">
              <Sparkles className="h-5 w-5" />
            </span>
            <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.25em] text-teal-700 dark:text-teal-400">
              CityCost Editorial
            </p>
            <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Editorial Control
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Sign in to generate drafts, review, optimize SEO, and run daily automation.
            </p>
          </div>

          <form
            onSubmit={submit}
            className="space-y-4 rounded-2xl border border-slate-200/70 bg-white/80 p-6 shadow-xl shadow-slate-200/50 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60 dark:shadow-none"
          >
            <Field label="Admin password">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
            </Field>
            {error && <Callout tone="rose">{error}</Callout>}
            <Button type="submit" variant="primary" className="w-full" size="lg" loading={loading} icon={<Lock className="h-4 w-4" />}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function HeaderJobsButton() {
  const jobs = useEditorialJobs();
  return <JobCenterDropdown jobs={jobs.jobs} onSelect={(id) => jobs.openDrawer(id)} />;
}

export default function EditorialAdminApp() {
  const [token, setToken] = useState<string | null>(() => getAuthToken());
  const [page, setPage] = useState<AdminPage>(() => adminPageFromPath(window.location.pathname));
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { dark, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    const onPop = () => setPage(adminPageFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigatePage = (next: AdminPage) => {
    setPage(next);
    window.history.pushState({ editorialPage: next }, '', adminPathForPage(next));
  };

  const logout = async () => {
    await apiLogout();
    setToken(null);
  };

  const activeNav = useMemo(() => NAV_ITEMS.find((n) => n.key === page) || NAV_ITEMS[0], [page]);

  const openArticle = (articleId: number) => {
    setPage('articles');
    navigateArticles({ view: 'detail', articleId });
    try {
      sessionStorage.setItem('editorial_open_article_id', String(articleId));
      window.dispatchEvent(new CustomEvent('editorial:open-article', { detail: { articleId } }));
    } catch {
      /* ignore */
    }
  };

  if (!token) {
    return <LoginScreen onLoggedIn={() => setToken(getAuthToken())} />;
  }

  const sidebarWidth = collapsed ? 'lg:w-[76px]' : 'lg:w-64';
  const contentPad = collapsed ? 'lg:pl-[76px]' : 'lg:pl-64';

  return (
    <JobsProvider onOpenArticle={openArticle}>
    <div className="relative min-h-screen text-slate-900 dark:text-slate-100">
      <BackgroundMesh />

      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200/70 bg-white/90 backdrop-blur-xl transition-[width,transform] duration-300 dark:border-white/10 dark:bg-slate-950/90 ${sidebarWidth} ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div
          className={`flex h-16 shrink-0 items-center gap-2.5 border-b border-slate-100 px-4 dark:border-white/10 ${
            collapsed ? 'justify-center lg:px-2' : ''
          }`}
        >
          <img
            src="/favicon.png"
            alt="CityCost"
            width={32}
            height={32}
            className="h-8 w-8 shrink-0 rounded-xl object-contain"
          />
          {!collapsed && (
            <span className="min-w-0 truncate font-display text-sm font-bold tracking-tight text-slate-900 dark:text-white">
              CityCost Editorial
            </span>
          )}
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="ml-auto text-slate-400 hover:text-slate-700 lg:hidden dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.map((item) => {
            const active = item.key === page;
            return (
              <button
                key={item.key}
                type="button"
                title={collapsed ? item.label : undefined}
                onClick={() => {
                  navigatePage(item.key);
                  setMobileNavOpen(false);
                }}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-slate-900 text-white dark:bg-teal-600/90 dark:text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5'
                } ${collapsed ? 'justify-center' : ''}`}
              >
                {item.icon}
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-slate-100 p-3 dark:border-white/10">
          <button
            type="button"
            onClick={toggleTheme}
            title={collapsed ? (dark ? 'Light mode' : 'Dark mode') : undefined}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5 ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            {!collapsed && <span>{dark ? 'Light mode' : 'Dark mode'}</span>}
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            title={collapsed ? 'Sign out' : undefined}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10 ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            <LogOut className="h-[18px] w-[18px]" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute top-1/2 -right-3 z-50 hidden h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-slate-200/80 bg-white text-slate-500 shadow-md shadow-slate-200/60 transition-colors hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 lg:grid dark:border-white/10 dark:bg-slate-900 dark:text-slate-400 dark:shadow-none dark:hover:border-teal-500/40 dark:hover:bg-teal-500/10 dark:hover:text-teal-400"
        >
          {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
        </button>
      </aside>

      <div className={`relative z-10 flex min-h-screen flex-col transition-[padding] duration-300 ${contentPad}`}>
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-slate-200/70 bg-white/80 px-4 backdrop-blur-xl sm:px-6 lg:px-8 dark:border-white/10 dark:bg-slate-950/80">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="text-slate-500 hover:text-slate-800 lg:hidden dark:text-slate-400 dark:hover:text-slate-100"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-bold tracking-tight text-slate-900 dark:text-white">
              {activeNav.label}
            </p>
            <p className="hidden truncate text-xs text-slate-500 sm:block dark:text-slate-400">
              {activeNav.description}
            </p>
          </div>
          <HeaderJobsButton />
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div key={page} className="editorial-fade-in">
            {page === 'dashboard' && <DashboardPanel onNavigate={navigatePage} />}
            {page === 'articles' && <ArticlesPanel />}
            {page === 'topics' && <TopicsPanel onNavigate={navigatePage} />}
            {page === 'automation' && <AutomationPanel />}
            {page === 'settings' && <SettingsPanel />}
          </div>
        </main>
      </div>
    </div>
    </JobsProvider>
  );
}
