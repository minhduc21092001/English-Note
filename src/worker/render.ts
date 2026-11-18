import type { PostRow } from './types';

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function layout(title: string, body: string, description = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
<link rel="stylesheet" href="/site.css">
</head>
<body class="site">
<header class="site-header"><div class="wrap"><a class="brand" href="/">English Notes</a><span class="tag">My learning journal</span></div></header>
<main class="wrap">${body}</main>
<footer class="site-footer"><div class="wrap">Notes from my English learning journey.</div></footer>
</body>
</html>`;
}

export function renderHome(posts: PostRow[]): string {
  const items = posts.length
    ? posts
        .map(
          (p) => `<article class="card">
  ${p.category ? `<span class="chip">${esc(p.category)}</span>` : ''}
  <h2><a href="/post/${encodeURIComponent(p.slug)}">${esc(p.title)}</a></h2>
  <p class="meta">${fmtDate(p.created_at)}</p>
  ${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ''}
</article>`,
        )
        .join('\n')
    : '<p class="empty">No posts yet.</p>';
  return layout('English Notes', `<h1 class="page-title">Latest posts</h1>${items}`, 'A personal blog about learning English.');
}

export function renderPost(p: PostRow): string {
  return layout(
    `${p.title} – English Notes`,
    `<article>
  <p><a href="/">← All posts</a></p>
  ${p.category ? `<span class="chip">${esc(p.category)}</span>` : ''}
  <h1 class="post-title">${esc(p.title)}</h1>
  <p class="meta">${fmtDate(p.created_at)}</p>
  <div class="prose">${p.content}</div>
</article>`,
    p.excerpt,
  );
}

export function renderNotFound(): string {
  return layout('Not found – English Notes', '<h1 class="page-title">Page not found</h1><p><a href="/">Back to home</a></p>');
}
