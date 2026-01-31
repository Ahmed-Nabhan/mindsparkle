// Lightweight Canva integration helper
// This is a best-effort integration scaffold. You must provide CANVA_API_KEY in app config or env.

import Config from './config';

export const generateImagesForPresentation = async (text: string, count: number, style: string): Promise<string[]> => {
  // If no API key configured, return empty so callers can fallback
  const apiKey = (Config as any).CANVA_API_KEY || process.env.CANVA_API_KEY;
  if (!apiKey) {
    console.warn('Canva API key not configured; skipping image generation');
    return [];
  }

  try {
    // Minimal implementation: call Canva Images API (pseudo-endpoint). Replace with real Canva endpoints.
    const resp = await fetch('https://api.canva.com/v1/images/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        prompt: text.substring(0, 2000),
        count: count,
        style: style,
        size: '1024x768',
      }),
    });

    if (!resp.ok) {
      console.warn('Canva API returned non-OK:', resp.status);
      return [];
    }

    const data = await resp.json();
    // Expect data.images = [{ url: 'https://...' }, ...]
    const urls: string[] = (data.images || []).map((i: any) => i.url).filter(Boolean);
    return urls.slice(0, count);
  } catch (err) {
    console.error('Canva image generation failed:', err);
    return [];
  }
};

export default { generateImagesForPresentation };