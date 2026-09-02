import type { ElementReference, ElementSnapshot, PageSnapshot } from '../../shared/types';

/**
 * Builds an ElementReference from snapshot data alone.
 *
 * Rules and the panel never touch the DOM, so everything needed to find an
 * element again has to be captured during collection. Ancestry is derived from
 * the snapshot's parent indices rather than stored twice.
 */
export function referenceFromSnapshot(snapshot: PageSnapshot, element: ElementSnapshot): ElementReference {
  const ancestry: string[] = [];
  let parent = element.parent;
  let hops = 0;
  while (parent !== null && hops < 8) {
    const ancestor = snapshot.elements[parent];
    if (!ancestor) break;
    ancestry.unshift(ancestor.id ? `${ancestor.tagName}#${ancestor.id}` : ancestor.tagName);
    parent = ancestor.parent;
    hops += 1;
  }

  const reference: ElementReference = {
    tagName: element.tagName,
    structuralPath: element.structuralPath,
    ancestry,
    rect: element.rect,
    centroid: {
      x: Math.round(element.rect.x + element.rect.width / 2),
      y: Math.round(element.rect.y + element.rect.height / 2),
    },
  };
  if (element.role) reference.role = element.role;
  if (element.accessibleName.name) reference.accessibleName = element.accessibleName.name;
  if (element.text) reference.textSnippet = element.text.slice(0, 80);
  if (element.stableAttribute) reference.stableAttribute = element.stableAttribute;
  return reference;
}
