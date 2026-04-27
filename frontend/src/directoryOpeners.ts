import type { CustomOpener, DirectoryItem } from "./types";

const configuredOpenerIds = (directory: DirectoryItem, openers: CustomOpener[]) =>
  directory.openerIds ?? openers.slice(0, 1).map((opener) => opener.id);

const uniqueIds = (ids: string[]) => Array.from(new Set(ids));

export function visibleOpeners(directory: DirectoryItem, openers: CustomOpener[]) {
  const byId = new Map(openers.map((opener) => [opener.id, opener]));
  return uniqueIds(configuredOpenerIds(directory, openers))
    .map((id) => byId.get(id))
    .filter((opener): opener is CustomOpener => Boolean(opener));
}

export function availableOpeners(directory: DirectoryItem, openers: CustomOpener[]) {
  const pinned = new Set(visibleOpeners(directory, openers).map((opener) => opener.id));
  return openers.filter((opener) => !pinned.has(opener.id));
}

export function pinOpener(directory: DirectoryItem, openerId: string, openers: CustomOpener[] = []): DirectoryItem {
  const openerIds = configuredOpenerIds(directory, openers).filter(Boolean);
  if (openerIds.includes(openerId)) {
    return { ...directory, openerIds };
  }
  return { ...directory, openerIds: [...openerIds, openerId] };
}

export function unpinOpener(directory: DirectoryItem, openerId: string, openers: CustomOpener[] = []): DirectoryItem {
  return {
    ...directory,
    openerIds: configuredOpenerIds(directory, openers).filter((id) => id !== openerId),
  };
}

export function reorderPinnedOpener(
  directory: DirectoryItem,
  draggedId: string,
  targetId: string,
  openers: CustomOpener[] = [],
): DirectoryItem {
  if (draggedId === targetId) {
    return directory;
  }
  const withoutDragged = configuredOpenerIds(directory, openers).filter((id) => id !== draggedId);
  const targetIndex = withoutDragged.indexOf(targetId);
  if (targetIndex === -1) {
    return { ...directory, openerIds: [...withoutDragged, draggedId] };
  }
  return {
    ...directory,
    openerIds: [
      ...withoutDragged.slice(0, targetIndex),
      draggedId,
      ...withoutDragged.slice(targetIndex),
    ],
  };
}
