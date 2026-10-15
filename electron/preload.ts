import { contextBridge, ipcRenderer } from 'electron';
import { mapCommandSchema, type QuickMapBridge } from '../src/shared/protocol';

const bridge: QuickMapBridge = {
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
};

contextBridge.exposeInMainWorld('quickMap', bridge);
