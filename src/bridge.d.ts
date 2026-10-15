import type { QuickMapBridge } from './shared/protocol';

export type MapAskEvent =
  | { requestId: string; type: 'started' }
  | { requestId: string; type: 'delta'; text: string }
  | { requestId: string; type: 'completed'; answer: string; stepIds: string[]; sourceIds: string[] }
  | { requestId: string; type: 'cancelled' }
  | { requestId: string; type: 'conversation_reset'; message: string }
  | { requestId: string; type: 'error'; code: string; message: string };

export type MapAskBridge = {
  askMap: (prompt: string) => Promise<{ requestId: string }>;
  cancelMapAsk: (requestId?: string) => Promise<void>;
  resetMapConversation: () => Promise<void>;
  onMapEvent: (listener: (event: MapAskEvent) => void) => () => void;
  openStorySource: (sourceId: string) => Promise<void>;
};

declare global {
  interface Window {
    quickMap?: QuickMapBridge & MapAskBridge;
  }
}

export {};
