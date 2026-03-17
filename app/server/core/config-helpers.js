// ===========================================================================
// Config Helper Utilities
// Shared helper functions for config.js operations
// ===========================================================================

/**
 * Find a fallback primary model when the current primary is deleted
 * @param {Object} providers - providers object from config.models.providers
 * @param {string} excludeModelKey - model key to exclude (provider/modelId)
 * @returns {string|null} - fallback model key or null
 */
function findPrimaryModelFallback(providers, excludeModelKey) {
  if (!providers || typeof providers !== "object") {
    return null;
  }

  for (const [providerName, provider] of Object.entries(providers)) {
    const models = Array.isArray(provider?.models) ? provider.models : [];
    for (const model of models) {
      const modelId = model?.id || model?.name || model?.model;
      if (!modelId) continue;
      const modelKey = `${providerName}/${modelId}`;
      if (modelKey === excludeModelKey) continue;
      return modelKey;
    }
  }

  return null;
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

  const hasModels = Array.isArray(provider.models) && provider.models.length > 0;

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
