import { useRegisterSW as pluginUseRegisterSW } from "virtual:pwa-register/react";

/** The part of the plugin's hook this component needs (so tests can inject a fake). */
export type UseRegisterSW = () => {
  needRefresh: readonly [boolean, ...unknown[]];
  updateServiceWorker: (reloadPage?: boolean) => Promise<void> | void;
};

/** Shown only when a newer build is waiting; Reload switches to it. */
export function UpdatePrompt({ useRegisterSW = pluginUseRegisterSW }: { useRegisterSW?: UseRegisterSW }) {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <p role="status" className="update-prompt">
      A new version is ready.{" "}
      <button type="button" className="btn-secondary" onClick={() => void updateServiceWorker(true)}>
        Reload
      </button>
    </p>
  );
}
