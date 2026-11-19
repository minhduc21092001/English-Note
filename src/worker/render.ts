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
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function layout(title: string, body: string, description = '', wide = false): string {
  const w = wide ? ' wrap-wide' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
<link rel="stylesheet" href="/site.css">
<script src="/folder-colors.js" defer></script>
</head>
<body class="site">
<header class="site-header"><div class="wrap${w}">
  <a class="brand" href="/"><span class="logo">E</span>English Notes</a>
</div></header>
<main class="wrap${w}">${body}</main>
<footer class="site-footer"><div class="wrap${w}"><span>© English Notes</span><span>Notes from my English learning journey.</span></div></footer>
</body>
</html>`;
}

// ---------------------------------------------------------------- folders (one per category)

export const OTHER_NAME = 'Khác';
export const OTHER_KEY = '_other';

/** Stable URL key of a category. Empty category (or "Khác") -> the "Khác" folder. Case-insensitive. */
export function categoryKey(category: string): string {
  const t = category.trim().toLocaleLowerCase('vi');
  return !t || t === 'khác' ? OTHER_KEY : t;
}

export interface Folder {
  key: string;
  name: string;
  count: number;
}

export function buildFolders(posts: PostRow[]): Folder[] {
  const map = new Map<string, Folder>();
  for (const p of posts) {
    const key = categoryKey(p.category);
    const f = map.get(key);
    if (f) f.count++;
    else map.set(key, { key, name: key === OTHER_KEY ? OTHER_NAME : p.category.trim(), count: 1 });
  }
  return [...map.values()].sort((a, b) =>
    a.key === OTHER_KEY ? 1 : b.key === OTHER_KEY ? -1 : a.name.localeCompare(b.name, 'vi'),
  );
}

const folderUrl = (key: string) => `/folder/${encodeURIComponent(key)}`;
const plural = (n: number) => `${n} ${n === 1 ? 'post' : 'posts'}`;

const PALETTES: [string, string][] = [
  ['#e0a42a', '#f8c95c'], // yellow
  ['#4a8bd4', '#7db4ee'], // blue
  ['#47a574', '#7ccf9f'], // green
  ['#de6550', '#f48d78'], // coral
  ['#8a6fd1', '#b49af0'], // purple
  ['#2da2a7', '#64cdd1'], // teal
];
const OTHER_PALETTE: [string, string] = ['#8a919b', '#b8bec6'];

function paletteFor(key: string): [string, string] {
  if (key === OTHER_KEY) return OTHER_PALETTE;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return PALETTES[h % PALETTES.length];
}

// Colours the owner picked (right-click a folder); set by the Worker right before rendering a page.
let COLORS: Record<string, string> = {};
export function setFolderColors(c: Record<string, string>) {
  COLORS = c;
}
/** A darker shade of a pastel colour, used for the back of the folder. Same maths as public/folder-colors.js. */
function darken(hex: string, f = 0.8): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v * f).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/** CSS custom properties (colours) for a folder, usable on any element. */
const colorVars = (key: string) => {
  const custom = COLORS[key];
  if (custom) {
    const back = darken(custom);
    return `--back:${back};--front:${custom};--c:${back}`;
  }
  const [back, front] = paletteFor(key);
  return `--back:${back};--front:${front};--c:${back}`;
};

function folderSvg(open = false): string {
  return `<svg class="folder-svg${open ? ' is-open' : ''}" viewBox="0 0 200 160" aria-hidden="true">
  <path class="f-back" d="M16 30a12 12 0 0 1 12-12h46l16 16h74a12 12 0 0 1 12 12v86a12 12 0 0 1-12 12H28a12 12 0 0 1-12-12z"/>
  <rect class="f-paper" x="30" y="46" width="140" height="74" rx="6"/>
  <path class="f-front" d="M16 64a12 12 0 0 1 12-12h144a12 12 0 0 1 12 12v70a12 12 0 0 1-12 12H28a12 12 0 0 1-12-12z"/>
</svg>`;
}

function chip(category: string, link = true): string {
  const key = categoryKey(category);
  const name = key === OTHER_KEY ? OTHER_NAME : category.trim();
  return link
    ? `<a class="chip" data-folder="${esc(key)}" style="${colorVars(key)}" href="${folderUrl(key)}">${esc(name)}</a>`
    : `<span class="chip" data-folder="${esc(key)}" style="${colorVars(key)}">${esc(name)}</span>`;
}

function postRow(p: PostRow): string {
  return `<a class="post-row" href="/post/${encodeURIComponent(p.slug)}">
  ${chip(p.category, false)}
  <h3>${esc(p.title)}</h3>
  ${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ''}
  <p class="meta">${fmtDate(p.created_at)}</p>
</a>`;
}

// ---------------------------------------------------------------- pages

export function renderHome(folders: Folder[], recent: PostRow[]): string {
  const grid = folders.length
    ? `<div class="folders">${folders
        .map(
          (f) => `<a class="folder" data-folder="${esc(f.key)}" style="${colorVars(f.key)}" href="${folderUrl(f.key)}">
  ${folderSvg()}
  <span class="f-name">${esc(f.name)}</span>
  <span class="f-count">${plural(f.count)}</span>
</a>`,
        )
        .join('\n')}</div>`
    : '<p class="empty">No posts yet.</p>';
  const latest = recent.length
    ? `<div class="section-head"><h2>Latest posts</h2></div><div class="post-list">${recent.map(postRow).join('\n')}</div>`
    : '';
  return layout(
    'English Notes',
    `<section class="hero">
  <p class="hero-kicker">my learning journey</p>
  <h1>English Notes</h1>
</section>
<div class="section-head"><h2>Folders</h2></div>
${grid}
${latest}`,
    'A personal blog about learning English.',
    true,
  );
}

export function renderFolder(folder: Folder, posts: PostRow[]): string {
  return layout(
    `${folder.name} – English Notes`,
    `<nav class="crumbs"><a href="/">Folders</a><span class="sep">/</span><span>${esc(folder.name)}</span></nav>
<div class="folder-head" data-folder="${esc(folder.key)}" style="${colorVars(folder.key)}">${folderSvg(true)}<div><h1 class="page-title">${esc(folder.name)}</h1><p class="meta">${plural(folder.count)}</p></div></div>
<div class="post-list">${posts.map(postRow).join('\n')}</div>`,
    `Posts in ${folder.name}`,
    true,
  );
}

export function renderPost(p: PostRow): string {
  const key = categoryKey(p.category);
  const folderName = key === OTHER_KEY ? OTHER_NAME : p.category.trim();
  return layout(
    `${p.title} – English Notes`,
    `<nav class="crumbs"><a href="/">Folders</a><span class="sep">/</span><a href="${folderUrl(key)}">${esc(folderName)}</a></nav>
<article class="article">
  ${chip(p.category)}
  <h1 class="post-title">${esc(p.title)}</h1>
  <p class="meta">${fmtDate(p.created_at)}</p>
  <div class="prose">${p.content}</div>
</article>`,
    p.excerpt,
    true,
  );
}

export function renderNotFound(): string {
  return layout('Not found – English Notes', '<h1 class="page-title">Page not found</h1><p><a href="/">Back to home</a></p>');
}
