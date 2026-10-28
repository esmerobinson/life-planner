// Vitest stand-in for the plugin's virtual module (which only exists inside a Vite build).
export function useRegisterSW() {
  return {
    needRefresh: [false, () => {}] as [boolean, () => void],
    offlineReady: [false, () => {}] as [boolean, () => void],
    updateServiceWorker: async () => {},
  };
}
