export function findExistingH3Promotion(history, sourceId) {
  const normalizedSourceId = String(sourceId || '');
  if (!normalizedSourceId || !Array.isArray(history)) return null;
  return history.find((entry) => (
    entry?.modelId === 'minimax-h3'
    && entry?.resolution === '2K'
    && entry?.h3RegeneratedFrom === normalizedSourceId
  )) || null;
}

export function createH3PromotionCoordinator() {
  const inFlight = new Map();

  return {
    run(sourceId, work) {
      const normalizedSourceId = String(sourceId || '');
      if (!normalizedSourceId) throw new Error('Falta la generación MiniMax H3 original.');

      const active = inFlight.get(normalizedSourceId);
      if (active) return active;

      const task = Promise.resolve().then(work);
      inFlight.set(normalizedSourceId, task);
      return task.finally(() => {
        if (inFlight.get(normalizedSourceId) === task) inFlight.delete(normalizedSourceId);
      });
    }
  };
}
