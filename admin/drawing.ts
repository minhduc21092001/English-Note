import './assetPath';
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, exportToBlob, loadFromBlob } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

export interface DrawingResult { blob: Blob; width: number; height: number }

/**
 * Opens a full-screen Excalidraw canvas. Resolves with a PNG (scene embedded in the file, so it can be
 * re-opened and edited later) or null if cancelled. Pass an existing drawing PNG to edit it.
 */
export async function openDrawing(initial?: Blob): Promise<DrawingResult | null> {
  let data: { elements: any; appState: any; files: any } | null = null;
  if (initial) {
    try {
      data = (await loadFromBlob(initial, null, null)) as any;
    } catch {
      throw new Error('This image is not an editable drawing (only drawings made with the Draw tool can be edited).');
    }
  }

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dr-overlay';
    overlay.innerHTML = `
      <div class="dr-dialog" role="dialog" aria-label="Drawing">
        <div class="dr-bar">
          <strong>Drawing</strong>
          <span class="dr-hint">Draw like Excalidraw. Your drawing is saved inside the image, so you can edit it again later.</span>
          <span style="flex:1"></span>
          <button type="button" class="btn" data-act="cancel">Cancel</button>
          <button type="button" class="btn primary" data-act="ok">Insert into post</button>
        </div>
        <div class="dr-canvas"></div>
      </div>`;
    document.body.appendChild(overlay);

    let api: any = null;
    const root = createRoot(overlay.querySelector('.dr-canvas')!);
    root.render(
      h(Excalidraw as any, {
        excalidrawAPI: (a: any) => { api = a; },
        initialData: data
          ? { elements: data.elements, appState: { ...data.appState, collaborators: new Map() }, files: data.files }
          : { appState: { viewBackgroundColor: '#ffffff' } },
        langCode: 'en',
        theme: 'light',
      }),
    );

    const close = (res: DrawingResult | null) => {
      root.unmount();
      overlay.remove();
      resolve(res);
    };

    overlay.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
      if (!btn || !api) return;
      if (btn.dataset.act === 'cancel') {
        const hasContent = api.getSceneElements().some((el: any) => !el.isDeleted);
        if (!hasContent || confirm('Discard this drawing?')) close(null);
        return;
      }
      const elements = api.getSceneElements().filter((el: any) => !el.isDeleted);
      if (!elements.length) { alert('The canvas is empty. Draw something first.'); return; }
      btn.disabled = true;
      try {
        const blob = await exportToBlob({
          elements,
          files: api.getFiles(),
          mimeType: 'image/png',
          exportPadding: 16,
          getDimensions: (w: number, hh: number) => ({ width: w * 2, height: hh * 2, scale: 2 }),
          appState: { ...api.getAppState(), exportBackground: false, exportEmbedScene: true, exportWithDarkMode: false },
        } as any);
        const bmp = await createImageBitmap(blob);
        const res = { blob, width: Math.round(bmp.width / 2), height: Math.round(bmp.height / 2) };
        bmp.close();
        close(res);
      } catch (err) {
        btn.disabled = false;
        alert('Could not export the drawing: ' + (err as Error).message);
      }
    });
  });
}
