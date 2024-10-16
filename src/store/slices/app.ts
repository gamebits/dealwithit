import { MessageInstance } from "antd/es/message/interface";
import { posthog, PostHogConfig } from "posthog-js";
import type { PostHog } from "posthog-js/react";
import { StateCreator } from "zustand";

export interface AppSlice {
  isDrawerOpen: boolean;
  messageApi: MessageInstance | undefined;
  mode: AppMode;
  posthog: PostHog;
  status: AppStatus;
  successCount: number;
  goBackToStart: () => void;
  setDrawerOpen: (isOpen: boolean) => void;
  setMessageApi: (messageApi: MessageInstance) => void;
  setMode: (newMode: AppMode) => void;
  setStatus: (newStatus: AppStatus) => void;
}

function initializePosthog() {
  const options: Partial<PostHogConfig> = {
    api_host: "https://jez.emoji.build",
    ui_host: "https://eu.i.posthog.com",
    autocapture: false,
    opt_out_capturing_by_default: true,
    disable_surveys: true,
    disable_session_recording: true,
    persistence: "localStorage",
  };
  posthog.init("phc_7SZQ8Cl3ymxNbRF8K5OLMO3VOQ51MD8Gnh6UDLU17lG", options);
  if (import.meta.env.DEV) {
    posthog.debug();
  }
  if (!posthog.has_opted_in_capturing()) {
    posthog.opt_out_capturing();
  }
  return posthog;
}

export const createAppSlice: StateCreator<AppSlice> = (set) => ({
  isDrawerOpen: false,
  messageApi: undefined,
  mode: "NORMAL",
  status: "START",
  successCount: 0,
  posthog: initializePosthog(),
  goBackToStart: () =>
    set(() => ({
      status: "INPUT",
      inputFile: undefined,
      inputImageDataUrl: "",
      glassesList: [],
      imageOptions: {
        flipVertically: false,
        flipHorizontally: false,
      },
    })),
  setDrawerOpen: (isOpen) => set(() => ({ isDrawerOpen: isOpen })),
  setMessageApi: (messageApi) => set(() => ({ messageApi })),
  setMode: (newMode) => set(() => ({ mode: newMode })),
  setStatus: (newStatus) => set(() => ({ status: newStatus })),
});
