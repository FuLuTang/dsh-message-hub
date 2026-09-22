// External DSH Web client bundle.  The Host API and panel are added by the
// Message Hub build; keeping the standard ModuleLoader shape lets profiles
// load this bundle safely even in a minimal/headless development setup.
window.__ModuleLoader__.load({
  id: 'dsh-message-hub',
  factory: (_require) => {
    const exports = {}
    exports.apply = (ctx) => {
      // The runtime uses a host-provided API; client effects are registered
      // only when the Web composition supplies the relevant UI services.
      ctx.logger?.debug?.('message-hub client loaded')
    }
    return exports
  },
})
