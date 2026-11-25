// Where the Mockups tab runs: the Mac app (files, curl, the user's own OpenAI
// key) or the admin website (same-origin API, server-side AI, downloads).
/* eslint-disable @typescript-eslint/no-explicit-any */
export type DrawRequest = { key: string; photo: HTMLImageElement; garment: string; view: "front" | "back"; notes: string; quality: "medium" | "high" };
export type SuggestRequest = { logo: Blob; palette: string[]; garments: { name: string; hex?: string }[]; instructions: string };
export type SaveFile = { name: string; data: Uint8Array };

export type MockupPlatform = {
  kind: "desktop" | "web";
  getJson(path: string): Promise<any>;                 // e.g. "/api/mockup-studio/search?q=8000"
  loadPhoto(url: string): Promise<HTMLImageElement>;    // supplier photo (proxied path or absolute URL)
  cachedDrawing(key: string): Promise<HTMLImageElement | null>;
  drawGarment(r: DrawRequest): Promise<HTMLImageElement>;
  suggest(r: SuggestRequest): Promise<{ swaps: { from: string; to: string; target: string }[]; note: string }>;
  save(files: SaveFile[], folder: string): Promise<string>; // returns a short "saved" message
  /** Desktop only: the user's own OpenAI key kept on the Mac. */
  key?: { hint(): Promise<string | null>; save(k: string): Promise<void>; forget(): Promise<void> };
  aiCostNote: string;
  /** Web/partner: a line like "15 of 20 AI uses left this week". */
  aiStatus?(): Promise<string>;
  /** false hides the AI quality and style-notes fields (partner: fixed settings). */
  showAiOptions?: boolean;
};
