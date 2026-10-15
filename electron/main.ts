import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CommandQueue, startControlServer } from './control';
import { readSelectedText } from './selection';

app.setName('QuickMap');
app.setPath('userData', join(app.getPath('appData'), 'QuickMap'));
const shortcut = process.env.QUICKMAP_SHORTCUT || 'CommandOrControl+Alt+M';
const controlFile = resolve(process.env.QUICKMAP_CONTROL_FILE || join(app.getPath('userData'), 'quickmap-control.json'));
const commands = new CommandQueue();
let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let control: Awaited<ReturnType<typeof startControlServer>> | undefined;
let quitting = false;
let capturingSelection = false;

function showMap() {
  if (!window || window.isDestroyed()) return;
  if (!window.isVisible()) {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    window.setBounds(display.bounds);
  }
  if (window.isMinimized()) window.restore();
  window.setFullScreen(true);
  window.show();
  window.focus();
}

async function summon() {
  if (capturingSelection) { showMap(); return; }
  capturingSelection = true;
  try {
    const selection = await readSelectedText();
    const text = (selection || await clipboard.readText()).trim();
    if (text && text.length <= 200) commands.enqueue({ type: 'search', query: text });
    showMap();
  } catch {
    showMap();
  } finally { capturingSelection = false; }
}

function trustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
}

async function cleanupControl() {
  if (!control) return;
  await control.close();
  try {
    const stored = JSON.parse(await readFile(controlFile, 'utf8')) as { token?: string };
    if (stored.token === control.token) await unlink(controlFile);
  } catch { /* The discovery file may have already been removed. */ }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { void summon(); });
  app.on('activate', showMap);
  app.on('window-all-closed', () => { /* Keep the shortcut and tray available. */ });
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    globalShortcut.unregisterAll();
    tray?.destroy();
    void cleanupControl().finally(() => app.quit());
  });

  void app.whenReady().then(async () => {
    app.setAppUserModelId('com.quickmap.desktop');
    window = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      fullscreen: true,
      autoHideMenuBar: true,
      title: 'QuickMap',
      backgroundColor: '#0a1828',
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    window.on('close', (event) => { if (!quitting) { event.preventDefault(); window?.hide(); } });
    window.once('ready-to-show', showMap);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) commands.pause();
    });
    window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'Escape' && input.type === 'keyDown') { event.preventDefault(); window?.hide(); }
    });
    ipcMain.on('quickmap:ready', (event) => {
      if (trustedSender(event)) commands.ready((command) => window?.webContents.send('quickmap:command', command));
    });
    ipcMain.handle('quickmap:hide', (event) => { if (trustedSender(event)) window?.hide(); });
    ipcMain.handle('quickmap:clipboard', async (event) => trustedSender(event) ? (await clipboard.readText()).slice(0, 200) : '');

    control = await startControlServer({
      onCommand(command) {
        const accepted = commands.enqueue(command);
        if (accepted) showMap();
        return accepted;
      },
      onQuit: () => app.quit(),
    });
    await mkdir(dirname(controlFile), { recursive: true, mode: 0o700 });
    const temporaryFile = `${controlFile}.${process.pid}.tmp`;
    await writeFile(temporaryFile, JSON.stringify({ protocol: 1, port: control.port, token: control.token, pid: process.pid }), { mode: 0o600 });
    await rename(temporaryFile, controlFile);

    const pixels = Buffer.alloc(16 * 16 * 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const inside = (x - 7.5) ** 2 + (y - 7.5) ** 2 <= 56;
      const grid = x === 7 || x === 8 || y === 7 || y === 8;
      const offset = (y * 16 + x) * 4;
      pixels[offset] = grid ? 245 : 180;
      pixels[offset + 1] = grid ? 245 : 140;
      pixels[offset + 2] = grid ? 245 : 50;
      pixels[offset + 3] = inside ? 255 : 0;
    }
    const icon = nativeImage.createFromBitmap(pixels, { width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip(`QuickMap — ${shortcut}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show QuickMap', click: showMap },
      { label: `Search selection / clipboard (${shortcut})`, click: () => { void summon(); } },
      { type: 'separator' },
      { label: 'Quit QuickMap', click: () => app.quit() },
    ]));
    tray.on('click', showMap);
    if (!globalShortcut.register(shortcut, () => { void summon(); })) {
      dialog.showErrorBox('QuickMap shortcut unavailable', `${shortcut} is already in use or invalid. Set QUICKMAP_SHORTCUT to another Electron accelerator and restart. You can still open QuickMap from its tray icon or CLI.`);
    }
    const devUrl = process.env.QUICKMAP_DEV_URL;
    if (devUrl) {
      const parsed = new URL(devUrl);
      if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('QUICKMAP_DEV_URL must use http://127.0.0.1.');
      await window.loadURL(devUrl);
    } else await window.loadFile(join(__dirname, '..', 'dist', 'index.html'));
  }).catch((error: unknown) => {
    dialog.showErrorBox('QuickMap could not start', error instanceof Error ? error.message : String(error));
    app.quit();
  });
}
