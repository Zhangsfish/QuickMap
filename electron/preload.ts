import { contextBridge, ipcRenderer } from 'electron';
import { mapCommandSchema, type QuickMapBridge } from '../src/shared/protocol';
import type { MapAskBridge, MapAskEvent } from '../src/bridge';

function isMapAskEvent(value: unknown): value is MapAskEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  if (typeof event.requestId !== 'string' || typeof event.type !== 'string') return false;
  if (event.type === 'started' || event.type === 'cancelled') return true;
  if (event.type === 'delta') return typeof event.text === 'string';
  if (event.type === 'completed') {
    return typeof event.answer === 'string' && Array.isArray(event.stepIds) &&
      event.stepIds.every((id) => typeof id === 'string') && Array.isArray(event.sourceIds) &&
      event.sourceIds.every((id) => typeof id === 'string');
  }
  if (event.type === 'conversation_reset') return typeof event.message === 'string';
  return event.type === 'error' && typeof event.code === 'string' && typeof event.message === 'string';
}

const bridge: QuickMapBridge & MapAskBridge = {
  onCommand(listener) {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const command = mapCommandSchema.safeParse(payload);
      if (command.success) listener(command.data);
    };
    ipcRenderer.on('quickmap:command', handler);
    return () => ipcRenderer.removeListener('quickmap:command', handler);
  },
  ready: () => ipcRenderer.send('quickmap:ready'),
  hide: () => ipcRenderer.invoke('quickmap:hide'),
  getClipboardText: () => ipcRenderer.invoke('quickmap:clipboard'),
  askMap: (prompt) => ipcRenderer.invoke('quickmap:ask-map', prompt),
  cancelMapAsk: (requestId) => ipcRenderer.invoke('quickmap:cancel-map-ask', requestId),
  resetMapConversation: () => ipcRenderer.invoke('quickmap:reset-map-conversation'),
  onMapEvent(listener) {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (isMapAskEvent(payload)) listener(payload);
    };
    ipcRenderer.on('quickmap:map-event', handler);
    return () => ipcRenderer.removeListener('quickmap:map-event', handler);
  },
  openStorySource: (sourceId) => ipcRenderer.invoke('quickmap:open-story-source', sourceId),
};

contextBridge.exposeInMainWorld('quickMap', bridge);
