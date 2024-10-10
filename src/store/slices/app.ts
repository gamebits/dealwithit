import { posthog } from "posthog-js";
import type { PostHog } from "posthog-js/react";
import { StateCreator } from "zustand";

export interface AppSlice {
  mode: AppMode;
  posthog: PostHog;
  status: AppStatus;
  setMode: (newMode: AppMode) => void;
  setStatus: (newStatus: AppStatus) => void;
}

function initializePosthog() {
  const options = {
    api_host: "https://jez.emoji.build",
    ui_host: "https://eu.i.posthog.com",
    autocapture: false,
  };
  posthog.init("phc_7SZQ8Cl3ymxNbRF8K5OLMO3VOQ51MD8Gnh6UDLU17lG", options);
  if (import.meta.env.DEV) {
    posthog.debug();
  }
  return posthog;
}

export const createAppSlice: StateCreator<AppSlice> = (set) => ({
  mode: "NORMAL",
  status: "START",
  posthog: initializePosthog(),
  setMode: (newMode) => set(() => ({ mode: newMode })),
  setStatus: (newStatus) => set(() => ({ status: newStatus })),
});
