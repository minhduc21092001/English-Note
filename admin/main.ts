import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import Placeholder from '@tiptap/extension-placeholder';

import { openCropper } from './cropper';
import { ListMarkerColor } from './listMarker';

import '../public/site.css';
import './admin.css';

// ---------------------------------------------------------------- helpers
interface PostSummary { id: number; slug: string; title: string; category: string; published: number; created_at: string; updated_at: string }
interface Post extends PostSummary { excerpt: string; content: string }

const app = document.getElementById('app')!;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: isForm ? init.headers : { 'Content-Type': 'application/json', ...init.headers },
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data as T;
}

let currentEditor: Editor | null = null;
let dirty = false;

function destroyEditor() {
  currentEditor?.destroy();
  currentEditor = null;
  dirty = false;
}

window.addEventListener('beforeunload', (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ---------------------------------------------------------------- router
async function route() {
  const h = location.hash || '#/';
  try {
    if (h === '#/new') return showEditor(null);
    const m = h.match(/^#\/edit\/(\d+)$/);
    if (m) return showEditor(await api<Post>(`/api/posts/${m[1]}`));
    return await showList();
  } catch (e) {
    app.innerHTML = `<div class="a-main"><p class="error">${esc((e as Error).message)}</p><a class="btn" href="#/">Back</a></div>`;
  }
}

function go(hash: string) {
  if (location.hash === hash) route(); else location.hash = hash;
}

window.addEventListener('hashchange', () => {
  if (dirty && !confirm('You have unsaved changes. Leave this page?')) return;
  destroyEditor();
  route();
});

// ---------------------------------------------------------------- post list
async function showList() {
  destroyEditor();
  const posts = await api<PostSummary[]>('/api/posts');
  const rows = posts.length
    ? posts.map((p) => `
      <div class="row">
        <div style="flex:1">
          <a class="title" href="#/edit/${p.id}">${esc(p.title)}</a>
          <div class="sub">${p.category ? esc(p.category) + ' · ' : ''}updated ${esc(p.updated_at)} UTC</div>
        </div>
        <span class="badge ${p.published ? 'pub' : ''}">${p.published ? 'Published' : 'Draft'}</span>
        ${p.published ? `<a class="btn" href="/post/${encodeURIComponent(p.slug)}" target="_blank">View</a>` : ''}
        <a class="btn" href="#/edit/${p.id}">Edit</a>
      </div>`).join('')
    : '<div class="empty-box">No posts yet. Click “New post” to write your first one.</div>';

  app.innerHTML = `
    <div class="a-bar">
      <h1>English Notes</h1><span class="grow"></span>
      <a class="btn" href="/" target="_blank">View site</a>
      <a class="btn primary" href="#/new">New post</a>
    </div>
    <div class="a-main"><div class="list">${rows}</div></div>`;
}

// ---------------------------------------------------------------- editor
const DEFAULT_CATEGORIES = ['Grammar', 'Vocabulary', 'Phrasal Verbs', 'Writing'];

const FONT_SIZES = ['12', '14', '16', '18', '20', '24', '28', '32', '36', '48'];
/** Name of the font the page really uses by default (first installed font of the CSS stack in site.css). */
function detectDefaultFont(): string {
  const ctx = document.createElement('canvas').getContext('2d')!;
  const probe = 'mmmmmmmmmmlli1WwOo0';
  const width = (f: string) => { ctx.font = `72px ${f}`; return ctx.measureText(probe).width; };
  const bases = ['monospace', 'serif', 'sans-serif'];
  const baseW = bases.map(width);
  const installed = (name: string) => bases.some((b, i) => width(`"${name}", ${b}`) !== baseW[i]);
  for (const n of ['Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial']) if (installed(n)) return n;
  return 'System UI';
}
const DEFAULT_SIZE = '18px'; // = .prose font-size in site.css

const FONT_FAMILIES: [string, string][] = [
  ['', ''], // label filled in with detectDefaultFont()
  ['Arial', 'Arial, Helvetica, sans-serif'],
  ['Verdana', 'Verdana, Geneva, sans-serif'],
  ['Georgia', 'Georgia, serif'],
  ['Times New Roman', '"Times New Roman", Times, serif'],
  ['Courier New', '"Courier New", Courier, monospace'],
  ['Handwriting (Excalidraw)', 'Excalifont, "Segoe Print", "Comic Sans MS", cursive'],
  ['Handwriting (Tiếng Việt)', '"Patrick Hand", "Segoe Print", "Comic Sans MS", cursive'],
];

const PALETTE: string[][] = [
  ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff'],
  ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'],
  ['#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#cfe2f3', '#d9d2e9', '#ead1dc', '#e6b8af', '#ffe599'],
];
const MARKER_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15.2 3.3l5.5 5.5-9.4 9.4-2.5.3-2.8 2.8H3v-3.1l2.8-2.8.3-2.5zM6 18.2l-1 1V20h.8l1-1z"/></svg>';

/** Word-style split button: main part applies the last colour, arrow opens the palette. */
function splitHtml(kind: 'text' | 'highlight', icon: string, title: string, color: string) {
  const swatches = PALETTE.map(
    (row) => `<div class="sw-row">${row.map((c) => `<button type="button" class="sw" data-swatch="${c}" title="${c}" style="background:${c}"></button>`).join('')}</div>`,
  ).join('');
  const clearLabel = kind === 'text' ? 'Automatic (remove color)' : 'No color (remove highlight)';
  return `<div class="split" data-split="${kind}">
    <button type="button" class="tb split-main" data-apply="${kind}" title="${title}">${icon}<span class="bar" style="background:${color}"></span></button>
    <button type="button" class="tb split-arrow" data-open="${kind}" title="${title} – more colors">▾</button>
    <div class="palette">
      ${swatches}
      <button type="button" class="pal-btn" data-clear="${kind}">⊘ ${clearLabel}</button>
      <button type="button" class="pal-btn" data-more="${kind}">🎨 More colors…</button>
      <input type="color" class="more-input" data-color="${kind}" value="${color}" tabindex="-1">
    </div>
  </div>`;
}

const svg = (inner: string) =>
  `<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON = {
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
  bullet: svg('<circle cx="4.5" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.4" fill="currentColor" stroke="none"/><path d="M10 6h11M10 12h11M10 18h11"/>'),
  ordered: svg('<text x="1.5" y="8" font-size="7" font-weight="700" fill="currentColor" stroke="none">1</text><text x="1.5" y="14" font-size="7" font-weight="700" fill="currentColor" stroke="none">2</text><text x="1.5" y="20" font-size="7" font-weight="700" fill="currentColor" stroke="none">3</text><path d="M10 6h11M10 12h11M10 18h11"/>'),
  quote: svg('<path d="M4 18v-5a5 5 0 0 1 5-5"/><path d="M4 13h5v5H4z" fill="currentColor"/><path d="M14 18v-5a5 5 0 0 1 5-5"/><path d="M14 13h5v5h-5z" fill="currentColor"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5L8 19"/>'),
  table: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>'),
  hr: svg('<path d="M3 12h18" stroke-width="2.4"/><path d="M8 6h8M8 18h8" opacity=".45"/>'),
  clear: svg('<path d="M5 5h11M10.5 5v11"/><path d="m14 14 6 6M20 14l-6 6"/>'),
};

function alignIcon(kind: 'left' | 'center' | 'right' | 'justify') {
  const w = [14, 9, 14, 9];
  const lines = w.map((len, i) => {
    const full = kind === 'justify' ? 14 : len;
    const x = kind === 'left' || kind === 'justify' ? 1 : kind === 'right' ? 15 - full : (16 - full) / 2;
    return `<rect x="${x}" y="${2 + i * 3.6}" width="${full}" height="1.6" rx=".6" fill="currentColor"/>`;
  });
  return `<svg class="ic" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">${lines.join('')}</svg>`;
}

const tb = (cmd: string, label: string, title: string) =>
  `<button type="button" class="tb" data-cmd="${cmd}" title="${title}">${label}</button>`;

function toolbarHtml() {
  return `
    <div class="tr">
      <span class="tg">${tb('undo', ICON.undo, 'Undo (Ctrl+Z)')}${tb('redo', ICON.redo, 'Redo (Ctrl+Y)')}</span>
      <span class="tg">
        <select data-sel="block" title="Paragraph style" class="sel-block">
          <option value="p">Paragraph</option>
          <option value="1">Heading 1</option>
          <option value="2">Heading 2</option>
          <option value="3">Heading 3</option>
          <option value="4">Heading 4</option>
        </select>
        <select data-sel="family" title="Font" class="sel-family">
          ${FONT_FAMILIES.map(([n, v], i) => `<option value="${esc(v)}">${i === 0 ? esc(detectDefaultFont()) : n}</option>`).join('')}
        </select>
        <select data-sel="size" title="Font size" class="sel-size">
          ${FONT_SIZES.map((s) => `<option value="${s}px">${s}</option>`).join('')}
        </select>
      </span>
      <span class="tg">
        ${tb('bold', '<b>B</b>', 'Bold (Ctrl+B)')}${tb('italic', '<i>I</i>', 'Italic (Ctrl+I)')}${tb('underline', '<u>U</u>', 'Underline (Ctrl+U)')}${tb('strike', '<s>S</s>', 'Strikethrough')}
      </span>
      <span class="tg">
        ${splitHtml('highlight', MARKER_ICON, 'Text highlight color', '#ffff00')}${splitHtml('text', '<span class="glyph">A</span>', 'Font color', '#c00000')}
      </span>
    </div>
    <div class="tr">
      <span class="tg">${tb('alignLeft', alignIcon('left'), 'Align left (Ctrl+Shift+L)')}${tb('alignCenter', alignIcon('center'), 'Center (Ctrl+Shift+E)')}${tb('alignRight', alignIcon('right'), 'Align right (Ctrl+Shift+R)')}${tb('alignJustify', alignIcon('justify'), 'Justify (Ctrl+Shift+J) – click again to turn off')}</span>
      <span class="tg">${tb('bulletList', ICON.bullet, 'Bulleted list')}${tb('orderedList', ICON.ordered, 'Numbered list')}${tb('blockquote', ICON.quote, 'Quote')}</span>
      <span class="tg">${tb('link', ICON.link, 'Insert / edit link')}${tb('image', ICON.image, 'Insert image')}${tb('table', ICON.table, 'Insert table')}${tb('hr', ICON.hr, 'Horizontal line')}</span>
      <span class="tg">${tb('clear', ICON.clear, 'Clear formatting')}</span>
    </div>
    <div class="table-tools" id="table-tools">
      <span class="lbl">Table:</span>
      ${tb('addColAfter', '+ Column', 'Add column after')}${tb('addRowAfter', '+ Row', 'Add row after')}
      ${tb('deleteColumn', '− Column', 'Delete column')}${tb('deleteRow', '− Row', 'Delete row')}
      ${tb('toggleHeaderRow', 'Header row', 'Toggle header row')}${tb('mergeOrSplit', 'Merge/Split', 'Merge or split selected cells')}
      ${tb('deleteTable', 'Delete table', 'Delete table')}
    </div>
    <div class="table-tools" id="image-tools">
      <span class="lbl">Image:</span>
      ${tb('imgW25', '25%', 'Resize to 25% of the page width')}${tb('imgW50', '50%', 'Resize to 50% of the page width')}${tb('imgW75', '75%', 'Resize to 75% of the page width')}${tb('imgW100', '100%', 'Full page width')}${tb('imgOrig', 'Original size', 'Original pixel size')}
      <span class="sep"></span>
      ${tb('imgCrop', '✂ Crop…', 'Crop this image')}
      <span class="lbl">Tip: drag the handles on the image corners to resize freely.</span>
    </div>`;
}

async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await api<{ url: string }>('/api/upload', { method: 'POST', body: fd });
  return r.url;
}

function showEditor(post: Post | null) {
  destroyEditor();
  const p: Post = post ?? { id: 0, slug: '', title: '', category: '', excerpt: '', content: '', published: 0, created_at: '', updated_at: '' };
  let slugTouched = !!post;

  app.innerHTML = `
    <div class="a-bar">
      <a class="btn" href="#/">← Posts</a>
      <span class="grow"></span>
      <span class="status" id="status"></span>
      ${post && p.published ? `<a class="btn" id="view" href="/post/${encodeURIComponent(p.slug)}" target="_blank">View</a>` : ''}
      ${post ? '<button class="btn danger" id="del">Delete</button>' : ''}
      <select id="published" title="Status">
        <option value="0" ${p.published ? '' : 'selected'}>Draft</option>
        <option value="1" ${p.published ? 'selected' : ''}>Published</option>
      </select>
      <button class="btn primary" id="save">Save</button>
    </div>
    <div class="a-main">
      <div class="meta-grid">
        <div class="full"><input type="text" id="title" class="title-input" placeholder="Post title" value="${esc(p.title)}" style="width:100%"></div>
        <div><label class="field-label" for="category">Category</label><div class="combo"><input type="text" id="category" value="${esc(p.category)}" placeholder="Type or pick a category" autocomplete="off"><button type="button" class="combo-arrow" id="cat-arrow" title="Show categories" tabindex="-1">▾</button><div class="combo-list" id="cat-list"></div></div></div>
        <div><label class="field-label" for="slug">URL slug</label><input type="text" id="slug" value="${esc(p.slug)}"></div>
        <div class="full"><label class="field-label" for="excerpt">Short summary (shown on the home page)</label><textarea id="excerpt" rows="2">${esc(p.excerpt)}</textarea></div>
      </div>
      <div class="editor-shell">
        <div class="toolbar" id="toolbar">${toolbarHtml()}</div>
        <div class="editor-area" id="editor"></div>
      </div>
      <input type="file" id="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" hidden>
    </div>`;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const status = $('status');
  const setStatus = (msg: string, err = false) => { status.textContent = msg; status.className = 'status' + (err ? ' err' : ''); };
  const markDirty = () => { if (!dirty) { dirty = true; setStatus('Unsaved changes'); } };

  async function insertImages(files: File[]) {
    for (const f of files) {
      try {
        setStatus('Uploading image…');
        const url = await uploadImage(f);
        editor.chain().focus().setImage({ src: url, alt: f.name.replace(/\.[^.]+$/, '') }).run();
        setStatus(dirty ? 'Unsaved changes' : '');
      } catch (e) {
        setStatus((e as Error).message, true);
      }
    }
  }

  const editor = new Editor({
    element: $('editor'),
    content: p.content,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow' } } }),
      TextStyleKit,
      ListMarkerColor,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight.configure({ multicolor: true }),
      Image.configure({ resize: { enabled: true, minWidth: 80, minHeight: 40, alwaysPreserveAspectRatio: true } }),
      Table.configure({ resizable: true }),
      TableRow, TableHeader, TableCell,
      Placeholder.configure({ placeholder: 'Start writing your post…' }),
    ],
    editorProps: {
      attributes: { class: 'prose' },
      handlePaste: (_v, e) => {
        const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        insertImages(files);
        return true;
      },
      handleDrop: (_v, e) => {
        const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        e.preventDefault();
        insertImages(files);
        return true;
      },
    },
    onUpdate: markDirty,
  });
  currentEditor = editor;

  // ---- toolbar wiring
  const toolbar = $('toolbar');
  const curAlign = (): string =>
    (editor.getAttributes('paragraph').textAlign || editor.getAttributes('heading').textAlign || 'left') as string;
  const toggleAlign = (a: string) => {
    const c = editor.chain().focus();
    // Clicking the active alignment again switches it off (back to default = left).
    return (curAlign() === a && a !== 'left' ? c.unsetTextAlign() : c.setTextAlign(a)).run();
  };
  const selectedImg = (): HTMLImageElement | null => {
    const dom = editor.view.nodeDOM(editor.state.selection.from) as HTMLElement | null;
    if (!dom) return null;
    return dom instanceof HTMLImageElement ? dom : dom.querySelector('img');
  };
  const contentWidth = () => {
    const d = editor.view.dom as HTMLElement;
    const cs = getComputedStyle(d);
    return d.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  };
  const resizeImage = (fraction: number | null) => {
    const img = selectedImg();
    if (!img || !img.naturalWidth) return;
    const width = Math.round(fraction === null ? img.naturalWidth : contentWidth() * fraction);
    const height = Math.round((width * img.naturalHeight) / img.naturalWidth);
    editor.chain().focus().updateAttributes('image', { width, height }).run();
    // The resizable node view only reads the size on first render, so also apply it to the live <img>.
    const live = selectedImg();
    if (live) { live.style.width = width + 'px'; live.style.height = height + 'px'; }
  };
  const cropImage = async () => {
    const src = editor.getAttributes('image').src as string | undefined;
    if (!src) return;
    const res = await openCropper(src);
    if (!res) return;
    try {
      setStatus('Uploading cropped image…');
      const url = await uploadImage(new File([res.blob], `crop.${res.ext}`, { type: res.type }));
      editor.chain().focus().updateAttributes('image', { src: url, width: null, height: null }).run();
      markDirty();
    } catch (e) {
      setStatus((e as Error).message, true);
    }
  };
  const runRaw = (cmd: string) => {
    const c = editor.chain().focus();
    switch (cmd) {
      case 'undo': return c.undo().run();
      case 'redo': return c.redo().run();
      case 'bold': return c.toggleBold().run();
      case 'italic': return c.toggleItalic().run();
      case 'underline': return c.toggleUnderline().run();
      case 'strike': return c.toggleStrike().run();
      case 'unsetColor': return c.unsetColor().run();
      case 'unsetHighlight': return c.unsetHighlight().run();
      case 'alignLeft': return toggleAlign('left');
      case 'alignCenter': return toggleAlign('center');
      case 'alignRight': return toggleAlign('right');
      case 'alignJustify': return toggleAlign('justify');
      case 'bulletList': return c.toggleBulletList().run();
      case 'orderedList': return c.toggleOrderedList().run();
      case 'blockquote': return c.toggleBlockquote().run();
      case 'hr': return c.setHorizontalRule().run();
      case 'clear': return c.unsetAllMarks().clearNodes().unsetTextAlign().run();
      case 'imgW25': return resizeImage(0.25);
      case 'imgW50': return resizeImage(0.5);
      case 'imgW75': return resizeImage(0.75);
      case 'imgW100': return resizeImage(1);
      case 'imgOrig': return resizeImage(null);
      case 'imgCrop': return cropImage();
      case 'table': return c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      case 'addColAfter': return c.addColumnAfter().run();
      case 'addRowAfter': return c.addRowAfter().run();
      case 'deleteColumn': return c.deleteColumn().run();
      case 'deleteRow': return c.deleteRow().run();
      case 'toggleHeaderRow': return c.toggleHeaderRow().run();
      case 'mergeOrSplit': return c.mergeOrSplit().run();
      case 'deleteTable': return c.deleteTable().run();
      case 'image': return $<HTMLInputElement>('file').click();
      case 'link': {
        const prev = editor.getAttributes('link').href as string | undefined;
        const url = window.prompt('Link URL (leave empty to remove the link):', prev ?? 'https://');
        if (url === null) return;
        if (url.trim() === '' || url.trim() === 'https://') return c.extendMarkRange('link').unsetLink().run();
        return c.extendMarkRange('link').setLink({ href: url.trim() }).run();
      }
    }
  };

  // After a formatting action, drop the highlight (collapse the selection to its end), like closing a Word menu.
  const deselect = () => {
    const sel = editor.state.selection;
    if (sel instanceof TextSelection && !sel.empty) editor.chain().focus().setTextSelection(sel.to).run();
  };
  const KEEP_SELECTION = new Set(['imgW25', 'imgW50', 'imgW75', 'imgW100', 'imgOrig', 'imgCrop', 'undo', 'redo', 'image', 'table', 'addColAfter', 'addRowAfter', 'deleteColumn', 'deleteRow', 'toggleHeaderRow', 'mergeOrSplit', 'deleteTable']);
  const run = (cmd: string) => {
    const r = runRaw(cmd);
    if (!KEEP_SELECTION.has(cmd)) deselect();
    return r;
  };

  // Keep the editor selection when clicking toolbar buttons.
  toolbar.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('button')) e.preventDefault();
  });
  type Kind = 'text' | 'highlight';
  const lastColor: Record<Kind, string> = { text: '#c00000', highlight: '#ffff00' };
  const closePalettes = () => toolbar.querySelectorAll('.palette.open').forEach((el) => el.classList.remove('open'));
  const applyColor = (kind: Kind, color: string) => {
    lastColor[kind] = color;
    toolbar.querySelector<HTMLElement>(`[data-split=${kind}] .bar`)!.style.background = color;
    const c = editor.chain().focus();
    if (kind === 'text') c.setColor(color).run(); else c.setHighlight({ color }).run();
    deselect();
  };
  const clearColor = (kind: Kind) => {
    const c = editor.chain().focus();
    if (kind === 'text') c.unsetColor().run(); else c.unsetHighlight().run();
    deselect();
  };

  toolbar.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const apply = t.closest<HTMLElement>('[data-apply]');
    if (apply) { closePalettes(); return applyColor(apply.dataset.apply as Kind, lastColor[apply.dataset.apply as Kind]); }
    const open = t.closest<HTMLElement>('[data-open]');
    if (open) {
      const pal = open.parentElement!.querySelector('.palette')!;
      const wasOpen = pal.classList.contains('open');
      closePalettes();
      if (!wasOpen) pal.classList.add('open');
      return;
    }
    const sw = t.closest<HTMLElement>('[data-swatch]');
    if (sw) { const kind = sw.closest<HTMLElement>('[data-split]')!.dataset.split as Kind; closePalettes(); return applyColor(kind, sw.dataset.swatch!); }
    const clr = t.closest<HTMLElement>('[data-clear]');
    if (clr) { closePalettes(); return clearColor(clr.dataset.clear as Kind); }
    const more = t.closest<HTMLElement>('[data-more]');
    if (more) { more.parentElement!.querySelector<HTMLInputElement>('.more-input')!.click(); return; }
    const btn = t.closest('button[data-cmd]') as HTMLButtonElement | null;
    if (btn) run(btn.dataset.cmd!);
  });
  const onDocClick = (e: MouseEvent) => {
    if (!document.getElementById('toolbar')) { document.removeEventListener('click', onDocClick); return; }
    if (!(e.target as HTMLElement).closest('.split')) closePalettes();
  };
  document.addEventListener('click', onDocClick);
  toolbar.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement | HTMLInputElement;
    const c = editor.chain().focus();
    if (t instanceof HTMLSelectElement) {
      const v = t.value;
      switch (t.dataset.sel) {
        case 'block':
          if (v === 'p') c.setParagraph().run();
          else c.setHeading({ level: Number(v) as 1 | 2 | 3 | 4 }).run();
          break;
        case 'family': v ? c.setFontFamily(v).run() : c.unsetFontFamily().run(); break;
        case 'size': v === DEFAULT_SIZE ? c.unsetFontSize().run() : c.setFontSize(v).run(); break;
      }
      t.blur(); // otherwise Chrome gives focus back to the <select> and the highlight stays
      deselect();
    } else if (t.dataset.color === 'text' || t.dataset.color === 'highlight') {
      closePalettes();
      applyColor(t.dataset.color as Kind, t.value);
    }
  });
  $<HTMLInputElement>('file').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.files?.length) insertImages(Array.from(input.files));
    input.value = '';
  });

  // Reflect the current selection in the toolbar.
  const toggles: Record<string, () => boolean> = {
    bold: () => editor.isActive('bold'),
    italic: () => editor.isActive('italic'),
    underline: () => editor.isActive('underline'),
    strike: () => editor.isActive('strike'),
    alignLeft: () => curAlign() === 'left',
    alignCenter: () => curAlign() === 'center',
    alignRight: () => curAlign() === 'right',
    alignJustify: () => curAlign() === 'justify',
    bulletList: () => editor.isActive('bulletList'),
    orderedList: () => editor.isActive('orderedList'),
    blockquote: () => editor.isActive('blockquote'),
    link: () => editor.isActive('link'),
  };
  const syncToolbar = () => {
    toolbar.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach((b) => {
      const f = toggles[b.dataset.cmd!];
      if (f) b.classList.toggle('on', f());
    });
    const ts = editor.getAttributes('textStyle');
    const setSel = (name: string, value: string) => {
      const sel = toolbar.querySelector<HTMLSelectElement>(`select[data-sel="${name}"]`)!;
      sel.querySelector('option[data-temp]')?.remove();
      if (![...sel.options].some((o) => o.value === value)) {
        if (name === 'block' || !value) value = name === 'block' ? 'p' : '';
        else { // an uncommon size/font: show exactly what is used
          const o = document.createElement('option');
          o.value = value; o.dataset.temp = '1';
          o.textContent = name === 'size' ? parseFloat(value) + '' : value.split(',')[0].replace(/["']/g, '');
          sel.appendChild(o);
        }
      }
      sel.value = value;
    };
    let block = 'p';
    for (let l = 1; l <= 4; l++) if (editor.isActive('heading', { level: l })) block = String(l);
    setSel('block', block);
    setSel('family', (ts.fontFamily as string) ?? '');
    setSel('size', (ts.fontSize as string) ?? DEFAULT_SIZE);
    $('table-tools').classList.toggle('show', editor.isActive('table'));
    $('image-tools').classList.toggle('show', editor.isActive('image'));
    toolbar.querySelector<HTMLButtonElement>('[data-cmd=undo]')!.disabled = !editor.can().undo();
    toolbar.querySelector<HTMLButtonElement>('[data-cmd=redo]')!.disabled = !editor.can().redo();
  };
  editor.on('transaction', syncToolbar);
  syncToolbar();

  // ---- category: type freely, or open the arrow to pick one of DEFAULT_CATEGORIES
  const catEl = $<HTMLInputElement>('category');
  const catList = $('cat-list');
  const categories = DEFAULT_CATEGORIES;
  const renderCategories = () => {
    const cur = catEl.value.trim().toLowerCase();
    catList.innerHTML = categories
      .map((c) => `<button type="button" class="combo-item${c.toLowerCase() === cur ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`)
      .join('');
  };
  const closeCats = () => catList.classList.remove('open');
  $('cat-arrow').addEventListener('mousedown', (e) => e.preventDefault());
  $('cat-arrow').addEventListener('click', () => {
    renderCategories();
    catList.classList.toggle('open');
  });
  catList.addEventListener('click', (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('[data-cat]')?.dataset.cat;
    if (c === undefined) return;
    catEl.value = c;
    closeCats();
    markDirty();
  });
  const onCatOutside = (e: MouseEvent) => {
    if (!document.getElementById('cat-list')) { document.removeEventListener('click', onCatOutside); return; }
    if (!(e.target as HTMLElement).closest('.combo')) closeCats();
  };
  document.addEventListener('click', onCatOutside);
  catEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCats(); });

  // ---- meta fields
  const titleEl = $<HTMLInputElement>('title');
  const slugEl = $<HTMLInputElement>('slug');
  titleEl.addEventListener('input', () => {
    if (!slugTouched) slugEl.value = slugify(titleEl.value);
    markDirty();
  });
  slugEl.addEventListener('input', () => { slugTouched = true; markDirty(); });
  for (const id of ['category', 'excerpt', 'published']) $(id).addEventListener('input', markDirty);

  // ---- save / delete
  const saveBtn = $<HTMLButtonElement>('save');
  async function save() {
    const body = {
      title: titleEl.value.trim(),
      slug: slugify(slugEl.value) || slugify(titleEl.value),
      category: $<HTMLInputElement>('category').value,
      excerpt: $<HTMLTextAreaElement>('excerpt').value,
      content: editor.getHTML(),
      published: $<HTMLSelectElement>('published').value === '1',
    };
    if (!body.title) { setStatus('Please enter a title', true); titleEl.focus(); return; }
    saveBtn.disabled = true;
    setStatus('Saving…');
    try {
      slugEl.value = body.slug;
      if (p.id) {
        await api(`/api/posts/${p.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        const r = await api<{ id: number }>('/api/posts', { method: 'POST', body: JSON.stringify(body) });
        p.id = r.id;
        history.replaceState(null, '', `#/edit/${p.id}`); // no hashchange event fired
      }
      dirty = false;
      setStatus('Saved ' + new Date().toLocaleTimeString());
    } catch (e) {
      setStatus((e as Error).message, true);
    } finally {
      saveBtn.disabled = false;
    }
  }
  saveBtn.addEventListener('click', save);
  document.addEventListener('keydown', onKey);
  function onKey(e: KeyboardEvent) {
    if (!document.getElementById('editor')) { document.removeEventListener('keydown', onKey); return; }
    if (e.key === 'Escape') {
      closePalettes();
      const a = document.activeElement;
      const typing = a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement; // title, slug, category…
      if (!typing) deselect();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  }

  document.getElementById('del')?.addEventListener('click', async () => {
    if (!confirm('Delete this post permanently?')) return;
    try {
      await api(`/api/posts/${p.id}`, { method: 'DELETE' });
      dirty = false;
      go('#/');
    } catch (e) {
      setStatus((e as Error).message, true);
    }
  });
}

route();
