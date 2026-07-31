/** Navigation légère vers une section du tiroir cercle (avant montage). */

export type CircleSection = 'cercle' | 'compte';

let pending: CircleSection | null = null;

export function requestCircleSection(section: CircleSection): void {
  pending = section;
  try {
    window.dispatchEvent(new CustomEvent('nocturne-circle-section', { detail: section }));
  } catch {
    /* ignore */
  }
}

export function consumeCircleSection(): CircleSection | null {
  const v = pending;
  pending = null;
  return v;
}
