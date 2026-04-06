import { create } from "zustand";
import type { Break, Session } from "@/types";

interface BreakState {
  active: boolean;
  breakId: string | null;
  type: Break["type"] | null;
  startTime: number | null;
}

export interface IdleInfo {
  awayDurationSecs: number;
  awaySince: number; // Unix timestamp (UTC) when idle started
  returnedAt: number; // Unix timestamp (UTC) when user returned
}

interface SessionState {
  session: Session | null;
  paused: boolean;
  breakState: BreakState;
  idleModalVisible: boolean;
  idleInfo: IdleInfo | null;
}

interface SessionActions {
  setSession: (session: Session) => void;
  clearSession: () => void;
  setPaused: (paused: boolean) => void;
  setBreakState: (breakState: BreakState) => void;
  setIdleModalVisible: (visible: boolean) => void;
  setIdleInfo: (info: IdleInfo | null) => void;
}

const initialBreakState: BreakState = {
  active: false,
  breakId: null,
  type: null,
  startTime: null,
};

export const useSessionStore = create<SessionState & SessionActions>(
  (set) => ({
    session: null,
    paused: false,
    breakState: initialBreakState,
    idleModalVisible: false,
    idleInfo: null,

    setSession: (session) => set({ session }),
    clearSession: () =>
      set({
        session: null,
        paused: false,
        breakState: initialBreakState,
        idleModalVisible: false,
        idleInfo: null,
      }),
    setPaused: (paused) => set({ paused }),
    setBreakState: (breakState) => set({ breakState }),
    setIdleModalVisible: (visible) => set({ idleModalVisible: visible }),
    setIdleInfo: (info) => set({ idleInfo: info }),
  })
);
