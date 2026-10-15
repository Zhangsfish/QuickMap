import type { QuickMapBridge } from './shared/protocol';

declare global {
  interface Window {
    quickMap?: QuickMapBridge;
  }
}

export {};
