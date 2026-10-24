// Change the name here and every page follows.
export const APP_NAME = 'Unfade';
export const TAGLINE = 'Shake a faded photo. Step back inside it.';

// Fills every [data-brand] and [data-tagline] element and the tab title.
export function applyBrand(page) {
  for (const el of document.querySelectorAll('[data-brand]')) el.textContent = APP_NAME;
  for (const el of document.querySelectorAll('[data-tagline]')) el.textContent = TAGLINE;
  document.title = page ? `${APP_NAME} · ${page}` : APP_NAME;
}
