import type { DirectoryItem } from "./types";

export function reorderDirectories(items: DirectoryItem[], draggedId: string, targetId: string) {
  if (draggedId === targetId) {
    return items;
  }
  const sourceIndex = items.findIndex((item) => item.id === draggedId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return items;
  }

  const next = items.slice();
  const [dragged] = next.splice(sourceIndex, 1);
  const targetCurrentIndex = next.findIndex((item) => item.id === targetId);
  const insertIndex = sourceIndex < targetIndex ? targetCurrentIndex + 1 : targetCurrentIndex;
  next.splice(insertIndex, 0, dragged);
  return next;
}
