import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * Bullets/numbers are coloured by the <li>, not by the coloured text inside it, so they stay black.
 * Like Word, make the marker follow the colour of the item's first text: store it on the list item
 * as a CSS variable (style="--marker: #c00000"); site.css applies it to li::marker.
 */
function firstTextColor(li: PMNode): string | null {
  let color: string | null = null;
  let found = false;
  li.descendants((node) => {
    if (found) return false;
    if (node.isText) {
      found = true;
      const ts = node.marks.find((m) => m.type.name === 'textStyle');
      color = (ts?.attrs.color as string | null) || null;
      return false;
    }
    return true;
  });
  return color;
}

export const ListMarkerColor = Extension.create({
  name: 'listMarkerColor',

  addGlobalAttributes() {
    return [
      {
        types: ['listItem'],
        attributes: {
          markerColor: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.getPropertyValue('--marker') || null,
            renderHTML: (attrs: Record<string, any>) => (attrs.markerColor ? { style: `--marker: ${attrs.markerColor}` } : {}),
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('listMarkerColor'),
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((t) => t.docChanged)) return null;
          const tr = state.tr;
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'listItem') return;
            const color = firstTextColor(node);
            if ((node.attrs.markerColor ?? null) !== color) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, markerColor: color });
              changed = true;
            }
          });
          return changed ? tr : null;
        },
      }),
    ];
  },
});
