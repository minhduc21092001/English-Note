import { Editor } from '@tiptap/core';
import { AllSelection, TextSelection } from '@tiptap/pm/state';
import { DOMSerializer } from '@tiptap/pm/model';
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
try { localStorage.setItem('owner', '1'); } catch { /* storage blocked */ } // lets the public site show the folder colour menu
app.spellcheck = false; // no red squiggly underlines

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
  document.getElementById('ctx-menu')?.remove();
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
const DEFAULT_SIZE = '20px'; // = .prose font-size in site.css

/** First entry (empty value) = the default font of posts, set in site.css (.prose). Other fonts are applied only when chosen. */
const FONT_FAMILIES: [string, string][] = [
  ['Handwriting (Tiếng Việt)', ''],
  ['Handwriting (Excalidraw)', 'Excalifont, "Segoe Print", "Comic Sans MS", cursive'],
  ['Segoe UI', '"Segoe UI", Roboto, Arial, sans-serif'],
  ['Arial', 'Arial, Helvetica, sans-serif'],
  ['Verdana', 'Verdana, Geneva, sans-serif'],
  ['Georgia', 'Georgia, serif'],
  ['Times New Roman', '"Times New Roman", Times, serif'],
  ['Courier New', '"Courier New", Courier, monospace'],
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
  template: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>'),
  draw: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
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
          ${FONT_FAMILIES.map(([n, v]) => `<option value="${esc(v)}">${n}</option>`).join('')}
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
      <span class="tg">${tb('link', ICON.link, 'Insert / edit link')}${tb('image', ICON.image, 'Insert image')}${tb('table', ICON.table, 'Insert table')}${tb('hr', ICON.hr, 'Horizontal line')}${tb('draw', ICON.draw, 'Draw a diagram or sketch (Excalidraw)')}${tb('templates', ICON.template, 'Templates: insert a saved layout, or save your selection as a template')}</span>
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
      ${tb('imgCrop', '✂ Crop…', 'Crop this image')}${tb('imgEdit', '✎ Edit drawing', 'Re-open this drawing in the drawing tool')}
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
  let autoOn = true; // auto-save on/off (remembered)
  try { autoOn = localStorage.getItem('autosave') !== 'off'; } catch { /* storage blocked */ }

  app.innerHTML = `
    <div class="a-bar">
      <a class="btn" href="#/">← Posts</a>
      <span class="grow"></span>
      <span class="status" id="status"></span>
      <label class="auto-toggle" title="Saves your changes a few seconds after you stop typing"><input type="checkbox" id="autosave" ${autoOn ? 'checked' : ''}> Auto-save</label>
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
  // ---- auto-save state (functions below are hoisted declarations)
  let version = 0;                 // bumped on every edit
  let busy = false;                // a save request is in flight
  let savedPublished = !!p.published; // status as stored on the server: auto-save never changes it
  let autoTimer: number | undefined;
  let backupTimer: number | undefined;
  const AUTOSAVE_MS = 2500;
  const markDirty = () => {
    version++;
    dirty = true;
    setStatus(autoOn ? 'Unsaved changes – auto-saving soon…' : 'Unsaved changes');
    scheduleBackup();
    scheduleAutosave();
  };

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
      // spellcheck/autocorrect off; data-* attributes also switch off Grammarly / LanguageTool-style extensions.
      attributes: { class: 'prose', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', 'data-gramm': 'false', 'data-gramm_editor': 'false', 'data-enable-grammarly': 'false', 'data-lt-active': 'false' },
      // Text pasted from OTHER sites/apps must not drag in their fonts/sizes (copies from this editor are kept intact).
      transformPastedHTML: (html: string) => {
        if (html.includes('data-pm-slice')) return html; // copied from this editor: keep fonts and sizes as they are
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.body.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
          el.style.removeProperty('font');
          el.style.removeProperty('font-family');
          el.style.removeProperty('font-size');
        });
        doc.body.querySelectorAll('font').forEach((f) => { f.removeAttribute('face'); f.removeAttribute('size'); });
        return doc.body.innerHTML;
      },
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

  // ---- right-click menu: the same controls as the toolbar, shown at the pointer
  document.getElementById('ctx-menu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'ctx-menu';
  menu.className = 'ctx-menu';
  toolbar.querySelectorAll(':scope > .tr').forEach((row) => menu.appendChild(row.cloneNode(true)));
  menu.querySelector('[data-cmd=undo]')?.closest('.tg')?.remove(); // keep undo/redo on the toolbar only
  menu.insertAdjacentHTML('beforeend', `
    <div class="ctx-sep"></div>
    <div class="ctx-list">
      <button type="button" class="ctx-item" data-ctx="cut">Cut<kbd>Ctrl+X</kbd></button>
      <button type="button" class="ctx-item" data-ctx="copy">Copy<kbd>Ctrl+C</kbd></button>
      <button type="button" class="ctx-item" data-ctx="paste">Paste text<kbd>Ctrl+V</kbd></button>
      <button type="button" class="ctx-item" data-ctx="selectAll">Select all<kbd>Ctrl+A</kbd></button>
    </div>`);
  document.body.appendChild(menu);
  const roots: HTMLElement[] = [toolbar, menu];
  const listen = (type: string, fn: (e: any) => void) => roots.forEach((r) => r.addEventListener(type, fn));
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
  const drawingTool = async (initial?: Blob) => {
    setStatus('Loading drawing tool…');
    try {
      return await (await import('./drawing')).openDrawing(initial);
    } finally {
      setStatus(dirty ? 'Unsaved changes' : '');
    }
  };
  const uploadDrawing = async (blob: Blob) => {
    setStatus('Uploading drawing…');
    return uploadImage(new File([blob], 'drawing.png', { type: 'image/png' }));
  };
  const insertDrawing = async () => {
    try {
      const res = await drawingTool();
      if (!res) return;
      const src = await uploadDrawing(res.blob);
      editor.chain().focus().setImage({ src, alt: 'Drawing', width: res.width, height: res.height }).run();
      markDirty();
    } catch (e) {
      setStatus((e as Error).message, true);
    }
  };
  const editDrawing = async () => {
    const current = editor.getAttributes('image').src as string | undefined;
    if (!current) return;
    try {
      const res = await drawingTool(await (await fetch(current)).blob());
      if (!res) return;
      const src = await uploadDrawing(res.blob);
      editor.chain().focus().updateAttributes('image', { src, width: res.width, height: res.height }).run();
      const live = selectedImg();
      if (live) { live.style.width = res.width + 'px'; live.style.height = res.height + 'px'; }
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
      case 'imgEdit': return editDrawing();
      case 'draw': return insertDrawing();
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
    // TextSelection = mouse/shift selection, AllSelection = Ctrl+A. (Image/table-cell selections are left alone.)
    if ((sel instanceof TextSelection || sel instanceof AllSelection) && !sel.empty) editor.chain().focus().setTextSelection(sel.to).run();
  };
  const KEEP_SELECTION = new Set(['draw', 'imgEdit', 'imgW25', 'imgW50', 'imgW75', 'imgW100', 'imgOrig', 'imgCrop', 'undo', 'redo', 'image', 'table', 'addColAfter', 'addRowAfter', 'deleteColumn', 'deleteRow', 'toggleHeaderRow', 'mergeOrSplit', 'deleteTable']);
  const run = (cmd: string) => {
    const r = runRaw(cmd);
    if (!KEEP_SELECTION.has(cmd)) deselect();
    return r;
  };

  // Keep the editor selection when clicking toolbar buttons.
  listen('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('button')) e.preventDefault();
  });
  type Kind = 'text' | 'highlight';
  const lastColor: Record<Kind, string> = { text: '#c00000', highlight: '#ffff00' };
  const closePalettes = () => document.querySelectorAll('.palette.open').forEach((el) => el.classList.remove('open'));
  const applyColor = (kind: Kind, color: string) => {
    lastColor[kind] = color;
    document.querySelectorAll<HTMLElement>(`[data-split=${kind}] .bar`).forEach((b) => { b.style.background = color; });
    const c = editor.chain().focus();
    if (kind === 'text') c.setColor(color).run(); else c.setHighlight({ color }).run();
    deselect();
  };
  const clearColor = (kind: Kind) => {
    const c = editor.chain().focus();
    if (kind === 'text') c.unsetColor().run(); else c.unsetHighlight().run();
    deselect();
  };

  listen('click', (e) => {
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
    if (btn && btn.dataset.cmd === 'templates') { openTemplates(btn); return; }
    if (btn) run(btn.dataset.cmd!);
  });
  const onDocClick = (e: MouseEvent) => {
    if (!document.getElementById('toolbar')) { document.removeEventListener('click', onDocClick); return; }
    if (!(e.target as HTMLElement).closest('.split')) closePalettes();
  };
  document.addEventListener('click', onDocClick);
  listen('change', (e) => {
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
    roots.forEach((root) =>
      root.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach((b) => {
        const f = toggles[b.dataset.cmd!];
        if (f) b.classList.toggle('on', f());
      }),
    );
    const ts = editor.getAttributes('textStyle');
    const setSel = (name: string, value: string) => {
      roots.forEach((root) => {
        const sel = root.querySelector<HTMLSelectElement>(`select[data-sel="${name}"]`);
        if (!sel) return;
        sel.querySelector('option[data-temp]')?.remove();
        let v = value;
        if (![...sel.options].some((o) => o.value === v)) {
          if (name === 'block' || !v) v = name === 'block' ? 'p' : '';
          else { // an uncommon size/font: show exactly what is used
            const o = document.createElement('option');
            o.value = v; o.dataset.temp = '1';
            o.textContent = name === 'size' ? parseFloat(v) + '' : v.split(',')[0].replace(/["']/g, '');
            sel.appendChild(o);
          }
        }
        sel.value = v;
      });
    };
    let block = 'p';
    for (let l = 1; l <= 4; l++) if (editor.isActive('heading', { level: l })) block = String(l);
    setSel('block', block);
    const fam = (ts.fontFamily as string | undefined) ?? '';
    setSel('family', /^"?Patrick Hand/.test(fam) ? '' : fam); // Patrick Hand is the default font
    setSel('size', (ts.fontSize as string) || DEFAULT_SIZE);
    $('table-tools').classList.toggle('show', editor.isActive('table'));
    $('image-tools').classList.toggle('show', editor.isActive('image'));
    toolbar.querySelector<HTMLButtonElement>('[data-cmd=undo]')!.disabled = !editor.can().undo();
    toolbar.querySelector<HTMLButtonElement>('[data-cmd=redo]')!.disabled = !editor.can().redo();
  };
  editor.on('transaction', syncToolbar);
  syncToolbar();

  const hideMenu = () => {
    if (!menu.classList.contains('open')) return; // must not touch the toolbar's own colour palettes
    menu.classList.remove('open');
    menu.querySelectorAll('.palette.open').forEach((el) => el.classList.remove('open'));
  };
  const showMenu = (x: number, y: number) => {
    syncToolbar();
    menu.classList.add('open');
    menu.style.left = '0px'; menu.style.top = '0px';
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
  };
  editor.view.dom.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    // right-clicking outside the current selection moves the caret there (like Word)
    const hit = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
    const { from, to } = editor.state.selection;
    if (hit && editor.state.selection instanceof TextSelection && (hit.pos < from || hit.pos > to)) editor.commands.setTextSelection(hit.pos);
    showMenu(e.clientX, e.clientY);
  });
  menu.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>('[data-ctx]')?.dataset.ctx;
    if (act) {
      hideMenu();
      editor.view.focus();
      if (act === 'cut' || act === 'copy') document.execCommand(act);
      else if (act === 'selectAll') editor.commands.selectAll();
      else if (act === 'paste') {
        try {
          const text = await navigator.clipboard.readText();
          const paras = text.split(/\r?\n/).map((l) => ({ type: 'paragraph', content: l ? [{ type: 'text', text: l }] : [] }));
          editor.chain().focus().insertContent(paras.length > 1 ? paras : text).run();
        } catch {
          setStatus('Your browser blocked clipboard access – press Ctrl+V to paste instead.', true);
        }
      }
      return;
    }
    if (t.closest('[data-open], [data-more]')) return; // opening a colour palette keeps the menu open
    if (t.closest('button')) hideMenu();
  });
  menu.addEventListener('change', hideMenu);
  const onMenuOutside = (e: MouseEvent) => {
    if (!document.getElementById('ctx-menu')) { document.removeEventListener('mousedown', onMenuOutside); return; }
    if (!menu.contains(e.target as Node)) hideMenu();
  };
  document.addEventListener('mousedown', onMenuOutside);
  window.addEventListener('blur', hideMenu);
  window.addEventListener('resize', hideMenu);

  // ---- templates: saved layouts (headings, colours, tables…) you can insert in any post
  interface Tpl { id: number; name: string; content: string }
  let tplPanel: HTMLElement | null = null;
  const closeTemplates = () => { tplPanel?.remove(); tplPanel = null; };
  const peek = (html: string) => {
    const d = document.createElement('div');
    d.innerHTML = html.replace(/<\/(p|h[1-6]|li|div|td|th|blockquote)>/g, ' </$1>'); // keep words of separate blocks apart
    return (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 64);
  };
  const selectionHtml = (): string => {
    const sel = editor.state.selection;
    if (sel.empty) return '';
    const frag = DOMSerializer.fromSchema(editor.schema).serializeFragment(sel.content().content);
    const box = document.createElement('div');
    box.appendChild(frag);
    return box.innerHTML;
  };

  async function openTemplates(anchor: HTMLElement) {
    if (tplPanel) { closeTemplates(); return; }
    const rect = anchor.getBoundingClientRect(); // read now: the right-click menu closes right after this click
    let list: Tpl[] = [];
    try {
      list = await api<Tpl[]>('/api/templates');
    } catch (e) {
      setStatus((e as Error).message, true);
      return;
    }
    const panel = document.createElement('div');
    panel.id = 'tpl-panel';
    panel.className = 'tpl-panel';
    const draw = () => {
      panel.innerHTML = `
        <div class="tpl-head">Templates</div>
        <div class="tpl-list">${
          list.length
            ? list.map((t) => `<div class="tpl-row" data-id="${t.id}"><button type="button" class="tpl-use" title="Insert into the post"><b>${esc(t.name)}</b><small>${esc(peek(t.content))}</small></button><button type="button" class="tpl-act" data-a="rename" title="Rename">✎</button><button type="button" class="tpl-act" data-a="update" title="Replace this template with the current selection">↻</button><button type="button" class="tpl-act" data-a="delete" title="Delete">✕</button></div>`).join('')
            : '<p class="tpl-empty">No templates yet.<br>Format some text the way you like (headings, colours, tables…), select it, then click “Save selection as template”.</p>'
        }</div>
        <button type="button" class="tpl-save">＋ Save selection as template</button>`;
    };
    draw();
    document.body.appendChild(panel);
    tplPanel = panel;
    const w = panel.offsetWidth, h = panel.offsetHeight;
    panel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - h - 8)) + 'px';

    panel.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); }); // keep the editor selection
    panel.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      const row = t.closest<HTMLElement>('.tpl-row');
      const tpl = row ? list.find((x) => x.id === Number(row.dataset.id)) : undefined;
      try {
        if (t.closest('.tpl-save')) {
          let html = selectionHtml();
          if (!html) {
            if (!confirm('Nothing is selected. Save the whole post as a template?')) return;
            html = editor.getHTML();
          }
          const first = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
          const name = window.prompt('Template name:', first || 'My template');
          if (!name || !name.trim()) return;
          await api('/api/templates', { method: 'POST', body: JSON.stringify({ name: name.trim(), content: html }) });
          list = await api<Tpl[]>('/api/templates');
          draw();
          setStatus('Template saved');
        } else if (tpl && t.closest('.tpl-use')) {
          const sel = editor.state.selection;
          closeTemplates();
          editor.chain().focus().insertContentAt(sel.empty ? sel.from : sel.to, tpl.content).run();
        } else if (tpl && t.closest('[data-a=rename]')) {
          const name = window.prompt('Rename template:', tpl.name);
          if (!name || !name.trim()) return;
          await api(`/api/templates/${tpl.id}`, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) });
          tpl.name = name.trim();
          draw();
        } else if (tpl && t.closest('[data-a=update]')) {
          const html = selectionHtml();
          if (!html) { setStatus('Select the text you want the template to become first.', true); return; }
          if (!confirm(`Replace the content of “${tpl.name}” with your current selection?`)) return;
          await api(`/api/templates/${tpl.id}`, { method: 'PUT', body: JSON.stringify({ name: tpl.name, content: html }) });
          tpl.content = html;
          draw();
          setStatus('Template updated');
        } else if (tpl && t.closest('[data-a=delete]')) {
          if (!confirm(`Delete template “${tpl.name}”?`)) return;
          await api(`/api/templates/${tpl.id}`, { method: 'DELETE' });
          list = list.filter((x) => x.id !== tpl.id);
          draw();
        }
      } catch (err) {
        setStatus((err as Error).message, true);
      }
    });
  }
  const onTplOutside = (e: MouseEvent) => {
    if (!document.getElementById('editor')) { document.removeEventListener('mousedown', onTplOutside); closeTemplates(); return; }
    const t = e.target as HTMLElement;
    if (tplPanel && !tplPanel.contains(t) && !t.closest('[data-cmd=templates]')) closeTemplates();
  };
  document.addEventListener('mousedown', onTplOutside);

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

  // ---- save / auto-save / recovery
  const saveBtn = $<HTMLButtonElement>('save');
  const inEditor = () => !!document.getElementById('editor');
  const draftKey = () => `draft:${p.id || 'new'}`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  function collect() {
    return {
      title: titleEl.value.trim(),
      slug: slugify(slugEl.value) || slugify(titleEl.value),
      category: $<HTMLInputElement>('category').value,
      excerpt: $<HTMLTextAreaElement>('excerpt').value,
      content: editor.getHTML(),
      published: $<HTMLSelectElement>('published').value === '1',
    };
  }

  // Local safety copy (this browser only): survives a crash/closed tab even if the server can't be reached.
  function scheduleBackup() {
    clearTimeout(backupTimer);
    backupTimer = window.setTimeout(writeBackup, 700);
  }
  function writeBackup() {
    if (!inEditor() || !dirty) return;
    try { localStorage.setItem(draftKey(), JSON.stringify({ ...collect(), at: Date.now() })); } catch { /* storage full/blocked */ }
  }
  function clearBackup(key = draftKey()) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }

  function scheduleAutosave() {
    clearTimeout(autoTimer);
    if (autoOn) autoTimer = window.setTimeout(() => autoSave(), AUTOSAVE_MS);
  }
  async function autoSave(keepalive = false) {
    clearTimeout(autoTimer);
    if (!autoOn || !dirty || !inEditor()) return;
    if (busy) { scheduleAutosave(); return; }
    const body = collect();
    if (!body.title) { setStatus('Unsaved – add a title to turn on auto-save'); return; }
    await persist(body, true, keepalive);
  }

  async function persist(body: ReturnType<typeof collect>, auto: boolean, keepalive = false) {
    busy = true;
    const v = version;
    if (!auto) saveBtn.disabled = true;
    setStatus(auto ? 'Auto-saving…' : 'Saving…');
    // Auto-save keeps the published/draft state that is already stored, so it can never publish by accident.
    const payload = auto ? { ...body, published: savedPublished } : body;
    const json = JSON.stringify(payload);
    try {
      if (!auto) slugEl.value = body.slug;
      const opts = keepalive && json.length < 60000 ? { keepalive: true } : {};
      if (p.id) {
        await api(`/api/posts/${p.id}`, { method: 'PUT', body: json, ...opts });
      } else {
        const r = await api<{ id: number }>('/api/posts', { method: 'POST', body: json, ...opts });
        clearBackup('draft:new');
        p.id = r.id;
        history.replaceState(null, '', `#/edit/${p.id}`); // no hashchange event fired
      }
      savedPublished = payload.published;
      const edited = version !== v; // typed more while this request was running
      if (!edited) { dirty = false; clearBackup(); } else { scheduleAutosave(); writeBackup(); }
      const t = new Date().toLocaleTimeString();
      const pending = auto && $<HTMLSelectElement>('published').value === '1' !== savedPublished;
      setStatus(edited ? 'Unsaved changes – auto-saving soon…' : (auto ? `Auto-saved ${t}` : `Saved ${t}`) + (pending ? ' (click Save to apply the status change)' : ''));
    } catch (e) {
      const offline = e instanceof TypeError; // network failure
      setStatus(auto ? `Auto-save failed${offline ? ' (offline?)' : ': ' + (e as Error).message} – your text is kept on this device` : (e as Error).message, true);
      if (auto && offline) autoTimer = window.setTimeout(() => autoSave(), 8000);
    } finally {
      busy = false;
      saveBtn.disabled = false;
    }
  }

  async function save() {
    const body = collect();
    if (!body.title) { setStatus('Please enter a title', true); titleEl.focus(); return; }
    clearTimeout(autoTimer);
    while (busy) await sleep(100);
    await persist(collect(), false);
  }

  // Last chance when the tab is hidden/closed: save now (keepalive lets the request finish) + local copy.
  const flush = () => {
    if (!inEditor()) { document.removeEventListener('visibilitychange', flush); window.removeEventListener('pagehide', flush); return; }
    writeBackup();
    if (dirty && autoOn && !busy) autoSave(true);
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);

  $<HTMLInputElement>('autosave').addEventListener('change', (e) => {
    autoOn = (e.target as HTMLInputElement).checked;
    try { localStorage.setItem('autosave', autoOn ? 'on' : 'off'); } catch { /* ignore */ }
    if (autoOn) { if (dirty) scheduleAutosave(); } else clearTimeout(autoTimer);
    setStatus(dirty ? (autoOn ? 'Unsaved changes – auto-saving soon…' : 'Unsaved changes') : '');
  });

  // Offer to restore a local copy that never reached the server (crash, closed tab, offline).
  (function checkRecovery() {
    let d: any = null;
    try { d = JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch { d = null; }
    if (!d || typeof d.content !== 'string') return;
    const serverTime = p.updated_at ? Date.parse(p.updated_at.replace(' ', 'T') + 'Z') : 0;
    const differs = d.title !== p.title || d.content !== p.content || d.category !== p.category || d.excerpt !== p.excerpt || d.slug !== p.slug;
    if (!differs || (p.id && d.at <= serverTime) || (!p.id && !d.title && !d.content.replace(/<[^>]*>/g, '').trim())) { clearBackup(); return; }
    const bar = document.createElement('div');
    bar.className = 'recover';
    bar.innerHTML = `<span>Unsaved changes from <b>${new Date(d.at).toLocaleString()}</b> were found on this device.</span><button type="button" class="btn primary" data-r="restore">Restore</button><button type="button" class="btn" data-r="discard">Discard</button>`;
    document.querySelector('.a-main')!.prepend(bar);
    bar.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-r]')?.dataset.r;
      if (!act) return;
      if (act === 'restore') {
        titleEl.value = d.title ?? '';
        slugEl.value = d.slug ?? '';
        slugTouched = true;
        $<HTMLInputElement>('category').value = d.category ?? '';
        $<HTMLTextAreaElement>('excerpt').value = d.excerpt ?? '';
        editor.commands.setContent(d.content);
        markDirty();
      } else {
        clearBackup();
      }
      bar.remove();
    });
  })();

  saveBtn.addEventListener('click', save);
  document.addEventListener('keydown', onKey);
  function onKey(e: KeyboardEvent) {
    if (!document.getElementById('editor')) { document.removeEventListener('keydown', onKey); return; }
    if (document.querySelector('.dr-overlay')) return; // the drawing tool handles its own keys
    if (e.key === 'Escape') {
      closePalettes();
      hideMenu();
      closeTemplates();
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
