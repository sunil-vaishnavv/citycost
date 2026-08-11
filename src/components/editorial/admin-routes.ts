/** Client-side admin URL helpers for the editorial SPA (no router library). */

export type ArticlesRoute =
  | { view: 'list' }
  | { view: 'new' }
  | { view: 'detail'; articleId: number };

export function parseArticlesRoute(pathname: string): ArticlesRoute {
  const path = (pathname.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  if (path === '/admin/articles/new') return { view: 'new' };
  const detail = path.match(/^\/admin\/articles\/(\d+)$/);
  if (detail) {
    const articleId = Number(detail[1]);
    if (Number.isFinite(articleId) && articleId > 0) {
      return { view: 'detail', articleId };
    }
  }
  return { view: 'list' };
}

export function articlesPath(route: ArticlesRoute): string {
  if (route.view === 'new') return '/admin/articles/new';
  if (route.view === 'detail') return `/admin/articles/${route.articleId}`;
  return '/admin/articles';
}

export function navigateArticles(route: ArticlesRoute, opts?: { replace?: boolean }) {
  const path = articlesPath(route);
  const state = { editorialArticles: route };
  if (opts?.replace) {
    window.history.replaceState(state, '', path);
  } else {
    window.history.pushState(state, '', path);
  }
}

export function adminPageFromPath(pathname: string): 'dashboard' | 'articles' | 'topics' | 'automation' | 'settings' {
  const path = (pathname.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  if (path.startsWith('/admin/articles')) return 'articles';
  if (path.startsWith('/admin/topics')) return 'topics';
  if (path.startsWith('/admin/automation')) return 'automation';
  if (path.startsWith('/admin/settings')) return 'settings';
  return 'dashboard';
}

export function adminPathForPage(page: 'dashboard' | 'articles' | 'topics' | 'automation' | 'settings'): string {
  if (page === 'dashboard') return '/admin';
  return `/admin/${page}`;
}
