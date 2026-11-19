import { buildFolders, categoryKey, renderFolder, renderHome, renderNotFound, renderPost, setFolderColors } from './render';
import type { Env, PostRow } from './types';

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};
const MAX_IMAGE = 8 * 1024 * 1024;

// Create the table on first use, so a fresh deploy needs no separate migration step (schema.sql mirrors this).
let schemaReady: Promise<unknown> | null = null;
function ensureSchema(db: D1Database): Promise<unknown> {
  schemaReady ??= db
    .batch([
      db.prepare(
        "CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', excerpt TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_posts_pub ON posts (published, created_at DESC)'),
      db.prepare('CREATE TABLE IF NOT EXISTS folder_colors (key TEXT PRIMARY KEY, color TEXT NOT NULL)'),
      db.prepare("CREATE TABLE IF NOT EXISTS templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
    ])
    .catch((e) => {
      schemaReady = null;
      throw e;
    });
  return schemaReady;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      await ensureSchema(env.DB);

      // ---------- API ----------
      if (pathname.startsWith('/api/')) return await handleApi(request, env, url);

      // ---------- Public media from R2 ----------
      if (pathname.startsWith('/media/') && (method === 'GET' || method === 'HEAD')) {
        const key = decodeURIComponent(pathname.slice('/media/'.length));
        const obj = await env.MEDIA.get(key);
        if (!obj) return new Response('Not found', { status: 404 });
        const h = new Headers();
        obj.writeHttpMetadata(h);
        h.set('ETag', obj.httpEtag);
        h.set('Cache-Control', 'public, max-age=31536000, immutable');
        return new Response(obj.body, { headers: h });
      }

      // ---------- Public pages ----------
      if (method === 'GET' || method === 'HEAD') {
        if (pathname === '/' || pathname.startsWith('/folder/')) {
          // A personal blog is small, so group the published posts into folders in code.
          const { results } = await env.DB
            .prepare(
              "SELECT id, slug, title, category, excerpt, published, created_at, updated_at, '' AS content FROM posts WHERE published = 1 ORDER BY created_at DESC LIMIT 1000",
            )
            .all<PostRow>();
          await loadFolderColors(env.DB);
          if (pathname === '/') return html(renderHome(buildFolders(results), results.slice(0, 6)));

          const key = decodeURIComponent(pathname.slice('/folder/'.length).replace(/\/$/, ''));
          const posts = results.filter((p) => categoryKey(p.category) === key);
          const folder = buildFolders(posts)[0];
          return folder ? html(renderFolder(folder, posts)) : html(renderNotFound(), 404);
        }
        const m = pathname.match(/^\/post\/([^/]+)\/?$/);
        if (m) {
          const post = await env.DB
            .prepare('SELECT * FROM posts WHERE slug = ? AND published = 1')
            .bind(decodeURIComponent(m[1]))
            .first<PostRow>();
          if (post) await loadFolderColors(env.DB);
          return post ? html(renderPost(post)) : html(renderNotFound(), 404);
        }
      }

      // ---------- Static assets (admin app, site.css) ----------
      const res = await env.ASSETS.fetch(request);
      if (res.status === 404 && (method === 'GET' || method === 'HEAD')) return html(renderNotFound(), 404);
      return res;
    } catch (err) {
      console.error(err);
      return json({ error: 'Internal error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function loadFolderColors(db: D1Database): Promise<void> {
  const { results } = await db.prepare('SELECT key, color FROM folder_colors').all<{ key: string; color: string }>();
  setFolderColors(Object.fromEntries(results.map((r) => [r.key, r.color])));
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/api/templates' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT id, name, content FROM templates ORDER BY name COLLATE NOCASE').all();
    return json(results);
  }
  if (pathname === '/api/templates' && method === 'POST') {
    const b = await readJson<{ name?: string; content?: string }>(request);
    const name = (typeof b?.name === 'string' ? b.name : '').trim().slice(0, 80);
    const content = typeof b?.content === 'string' ? b.content : '';
    if (!name) return json({ error: 'Template name is required' }, 400);
    if (!content.trim()) return json({ error: 'Template is empty' }, 400);
    if (content.length > 500_000) return json({ error: 'Template is too large' }, 400);
    const r = await env.DB.prepare('INSERT INTO templates (name, content) VALUES (?, ?)').bind(name, content).run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  const tm = pathname.match(/^\/api\/templates\/(\d+)$/);
  if (tm && method === 'PUT') {
    const b = await readJson<{ name?: string; content?: string }>(request);
    const name = (typeof b?.name === 'string' ? b.name : '').trim().slice(0, 80);
    if (!name) return json({ error: 'Template name is required' }, 400);
    if (typeof b?.content === 'string' && b.content.trim()) {
      await env.DB.prepare('UPDATE templates SET name = ?, content = ? WHERE id = ?').bind(name, b.content, Number(tm[1])).run();
    } else {
      await env.DB.prepare('UPDATE templates SET name = ? WHERE id = ?').bind(name, Number(tm[1])).run();
    }
    return json({ ok: true });
  }
  if (tm && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(Number(tm[1])).run();
    return json({ ok: true });
  }

  const fc = pathname.match(/^\/api\/folder-colors\/(.+)$/);
  if (fc && method === 'PUT') {
    const key = decodeURIComponent(fc[1]);
    const body = await readJson<{ color?: string }>(request);
    const color = typeof body?.color === 'string' ? body.color.trim() : '';
    if (key.length > 100) return json({ error: 'Bad folder' }, 400);
    if (color === '') {
      await env.DB.prepare('DELETE FROM folder_colors WHERE key = ?').bind(key).run();
    } else if (/^#[0-9a-fA-F]{6}$/.test(color)) {
      await env.DB.prepare('INSERT INTO folder_colors (key, color) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET color = excluded.color').bind(key, color.toLowerCase()).run();
    } else {
      return json({ error: 'Color must look like #a1b2c3' }, 400);
    }
    return json({ ok: true });
  }

  if (pathname === '/api/posts' && method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT id, slug, title, category, published, created_at, updated_at FROM posts ORDER BY updated_at DESC')
      .all();
    return json(results);
  }

  if (pathname === '/api/posts' && method === 'POST') {
    const p = validatePost(await readJson(request));
    if (typeof p === 'string') return json({ error: p }, 400);
    try {
      const r = await env.DB
        .prepare('INSERT INTO posts (slug, title, category, excerpt, content, published) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(p.slug, p.title, p.category, p.excerpt, p.content, p.published)
        .run();
      return json({ id: r.meta.last_row_id }, 201);
    } catch (e) {
      return dupOr500(e);
    }
  }

  const m = pathname.match(/^\/api\/posts\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    if (method === 'GET') {
      const post = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first();
      return post ? json(post) : json({ error: 'Not found' }, 404);
    }
    if (method === 'PUT') {
      const p = validatePost(await readJson(request));
      if (typeof p === 'string') return json({ error: p }, 400);
      try {
        const r = await env.DB
          .prepare(
            "UPDATE posts SET slug=?, title=?, category=?, excerpt=?, content=?, published=?, updated_at=datetime('now') WHERE id=?",
          )
          .bind(p.slug, p.title, p.category, p.excerpt, p.content, p.published, id)
          .run();
        return r.meta.changes ? json({ ok: true }) : json({ error: 'Not found' }, 404);
      } catch (e) {
        return dupOr500(e);
      }
    }
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  if (pathname === '/api/upload' && method === 'POST') {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return json({ error: 'No file' }, 400);
    const ext = IMAGE_TYPES[file.type];
    if (!ext) return json({ error: 'Only PNG, JPEG, GIF, WebP or AVIF images are allowed' }, 400);
    if (file.size > MAX_IMAGE) return json({ error: 'Image is larger than 8 MB' }, 400);
    const key = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    return json({ url: `/media/${key}` }, 201);
  }

  return json({ error: 'Not found' }, 404);
}

async function readJson<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function validatePost(b: Record<string, unknown> | null) {
  if (!b) return 'Invalid JSON';
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const title = str(b.title).trim().slice(0, 200);
  const slug = str(b.slug).trim().toLowerCase();
  if (!title) return 'Title is required';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return 'Slug may only contain a-z, 0-9 and hyphens';
  const content = str(b.content);
  if (content.length > 2_000_000) return 'Content is too large';
  return {
    title,
    slug,
    category: str(b.category).trim().slice(0, 60),
    excerpt: str(b.excerpt).trim().slice(0, 400),
    content,
    published: b.published ? 1 : 0,
  };
}

function dupOr500(e: unknown): Response {
  if (String(e).includes('UNIQUE')) return json({ error: 'That slug is already used by another post' }, 409);
  throw e;
}
