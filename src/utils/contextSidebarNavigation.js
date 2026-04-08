export function getContextSidebarArrowNavigation({
  currentId,
  visibleIds = [],
  key,
}) {
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return null;

  const currentIndex = visibleIds.findIndex((id) => id === currentId);
  const delta = key === 'ArrowUp' ? -1 : 1;

  if (currentIndex >= 0) {
    return visibleIds[currentIndex + delta] ?? null;
  }

  return null;
}
