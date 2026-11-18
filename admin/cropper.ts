/** Small image cropper: shows a modal, resolves with the cropped image Blob (or null if cancelled). */
export interface CropResult { blob: Blob; type: string; ext: string }

const MIN = 24;

function typeFor(src: string): { type: string; ext: string } {
  const m = src.split('?')[0].toLowerCase().match(/\.(jpe?g|webp|png|gif|avif)$/);
  const e = m?.[1];
  if (e === 'jpg' || e === 'jpeg') return { type: 'image/jpeg', ext: 'jpg' };
  if (e === 'webp') return { type: 'image/webp', ext: 'webp' };
  return { type: 'image/png', ext: 'png' }; // png, gif (static), avif -> png
}

export function openCropper(src: string): Promise<CropResult | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'cr-overlay';
    overlay.innerHTML = `
      <div class="cr-dialog" role="dialog" aria-label="Crop image">
        <div class="cr-title">Crop image <span class="cr-hint">Drag the box or its handles. Everything outside the box is removed.</span></div>
        <div class="cr-stage"><img class="cr-img" alt=""><div class="cr-box">
          ${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => `<span class="cr-h cr-${d}" data-dir="${d}"></span>`).join('')}
        </div></div>
        <div class="cr-actions">
          <button type="button" class="btn" data-act="reset">Reset</button>
          <span class="cr-size" id="cr-size"></span>
          <span style="flex:1"></span>
          <button type="button" class="btn" data-act="cancel">Cancel</button>
          <button type="button" class="btn primary" data-act="ok">Apply crop</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const img = overlay.querySelector<HTMLImageElement>('.cr-img')!;
    const box = overlay.querySelector<HTMLElement>('.cr-box')!;
    const sizeEl = overlay.querySelector<HTMLElement>('#cr-size')!;
    let dw = 0, dh = 0, nw = 0, nh = 0;
    let r = { x: 0, y: 0, w: 0, h: 0 };

    const close = (res: CropResult | null) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(res);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
    };
    document.addEventListener('keydown', onKey, true);

    const draw = () => {
      box.style.left = r.x + 'px';
      box.style.top = r.y + 'px';
      box.style.width = r.w + 'px';
      box.style.height = r.h + 'px';
      const k = nw / dw;
      sizeEl.textContent = `${Math.round(r.w * k)} × ${Math.round(r.h * k)} px`;
    };
    const reset = () => { r = { x: 0, y: 0, w: dw, h: dh }; draw(); };

    img.onload = () => {
      nw = img.naturalWidth; nh = img.naturalHeight;
      dw = img.clientWidth; dh = img.clientHeight;
      reset();
    };
    img.onerror = () => { alert('Could not load this image for cropping.'); close(null); };
    img.src = src;

    // ---- dragging
    let drag: { dir: string; sx: number; sy: number; start: typeof r } | null = null;
    box.addEventListener('pointerdown', (e) => {
      const dir = (e.target as HTMLElement).dataset.dir || 'move';
      drag = { dir, sx: e.clientX, sy: e.clientY, start: { ...r } };
      box.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy, s = drag.start;
      const n = { ...s };
      if (drag.dir === 'move') {
        n.x = Math.min(Math.max(0, s.x + dx), dw - s.w);
        n.y = Math.min(Math.max(0, s.y + dy), dh - s.h);
      } else {
        if (drag.dir.includes('w')) { const x = Math.min(Math.max(0, s.x + dx), s.x + s.w - MIN); n.w = s.x + s.w - x; n.x = x; }
        if (drag.dir.includes('e')) n.w = Math.min(Math.max(MIN, s.w + dx), dw - s.x);
        if (drag.dir.includes('n')) { const y = Math.min(Math.max(0, s.y + dy), s.y + s.h - MIN); n.h = s.y + s.h - y; n.y = y; }
        if (drag.dir.includes('s')) n.h = Math.min(Math.max(MIN, s.h + dy), dh - s.y);
      }
      r = n;
      draw();
    });
    const end = () => { drag = null; };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);

    // ---- buttons
    overlay.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (e.target === overlay || act === 'cancel') return close(null);
      if (act === 'reset') return reset();
      if (act === 'ok') {
        const k = nw / dw;
        const sx = Math.round(r.x * k), sy = Math.round(r.y * k);
        const sw = Math.max(1, Math.min(nw - sx, Math.round(r.w * k)));
        const sh = Math.max(1, Math.min(nh - sy, Math.round(r.h * k)));
        const canvas = document.createElement('canvas');
        canvas.width = sw; canvas.height = sh;
        canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        const { type, ext } = typeFor(src);
        canvas.toBlob((blob) => (blob ? close({ blob, type, ext }) : close(null)), type, 0.92);
      }
    });
  });
}
