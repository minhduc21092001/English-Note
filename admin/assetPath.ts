// Must be imported BEFORE @excalidraw/excalidraw: tells it to load its fonts from our own server
// (public/excalidraw/fonts) instead of a public CDN.
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw/';
export {};
