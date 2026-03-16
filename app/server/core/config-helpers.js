// ===========================================================================
// Config Helper Utilities
// Shared helper functions for config.js operations
// ===========================================================================

/**
 * Find a fallback primary model when the current primary is deleted
 * @param {Object} models - Models object from config
 * @param {string} excludeId - Model ID to exclude from candidates
 * @returns {string|null} - Fallback model key or null
 */
function findPrimaryModelFallback(models, excludeId) {
  const candidates = Object.entries(models)
    .filter(([id]) => id !== excludeId)
    .map(([id, model]) => ({ id, ...model }));

  return candidates.length > 0 ? candidates[0].id : null;
}

/**
 * Clean up provider if it has no associated models
 * @param {Object} config - Full config object
 * @param {string} providerId - Provider ID to check
 * @returns {boolean} - True if provider was deleted
 */
function cleanupEmptyProvider(config, providerId) {
  const provider = config.models?.providers?.[providerId];
  if (!provider) return false;

  const hasModels = Object.values(config.models?.models || {})
    .some(m => m.provider === providerId);

  if (!hasModels) {
    delete config.models.providers[providerId];
    return true;
  }
  return false;
}

module.exports = {
  findPrimaryModelFallback,
  cleanupEmptyProvider,
};
