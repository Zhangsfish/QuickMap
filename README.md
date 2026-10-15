# QuickMap

QuickMap is a Windows desktop world map that opens with a global shortcut. It works offline for country and major city browsing, and exposes local commands so Codex or another AI can mark places that are absent from the built-in map data.

## Windows 快速开始

1. 在 [Windows package 构建记录](https://github.com/Zhangsfish/QuickMap/actions/workflows/windows-package.yml)中打开最近一次成功运行，下载 `QuickMap-win32-x64`，解压后运行 `QuickMap.exe`。它是便携版，无需安装 Node.js。
2. 按 **Ctrl+Alt+M** 唤出地图，按 **Esc** 收起。搜索框可查国家和主要城市；遇到海峡、岛屿等未收录地点，可让本地 AI 临时标注。
3. 在运行 Codex 的 Windows 终端注册地图工具，路径换成你实际解压的位置：

   ```powershell
   codex mcp add quickmap --env ELECTRON_RUN_AS_NODE=1 -- "C:\Apps\QuickMap-win32-x64\QuickMap.exe" "C:\Apps\QuickMap-win32-x64\control\mcp.cjs"
   ```

   保持 `QuickMap.exe` 运行，并重新打开一个 Codex 会话。之后可以问“北方四岛在哪里？请在 QuickMap 圈出来”或“霍尔木兹海峡在哪里？请在地图上标注”。AI 可调用 `highlight_area` 画示意圈，或调用 `add_overlay` 画更精确的 GeoJSON 边界。圈的范围取决于 AI 提供的坐标，不能当作政治或法律边界。

   也可从 PowerShell 手动发命令，例如：

   ```powershell
   & "C:\Apps\QuickMap-win32-x64\control\quickmap.cmd" circle northern-islands "北方四岛" 146.5 44.5 250
   ```

## Run it

For source development, use Node.js 24 or newer. From this repository:

```sh
npm ci
npm run build
npm start
```

On Windows, `npm run dev:desktop` starts the Vite renderer and Electron together. `npm run dev:web` starts only the browser map for UI work. `npm test` checks the local control protocol and MCP tools. `npm run package:win` creates `release/QuickMap-win32-x64.zip`, including `QuickMap.exe` and the local AI control scripts in `control/`. Packaging can run on Windows or Linux; the archive is intended for Windows x64. Every push to `main` also builds and uploads a Windows package in GitHub Actions.

The default global shortcut is **Ctrl+Alt+M**. It opens the map and searches the current text selection where Windows UI Automation can read it; otherwise it searches clipboard text. Press **Esc** to hide the map. The tray icon can reopen or quit it. Change the shortcut by setting `QUICKMAP_SHORTCUT` to an [Electron accelerator](https://www.electronjs.org/docs/latest/api/accelerator) before starting the app.

On the map, hover a country to see Chinese and English names and its capital. Click it to show bordering countries and major cities. Drag to pan, scroll to zoom, use `/` to focus search, and use the clipboard button to search copied text.

## Let a local AI control the map

Start `QuickMap.exe` first. A command line interface ships beside it and communicates with the running app through an authenticated local loopback connection. The Windows `.cmd` launchers use the Node runtime inside QuickMap, so no separate Node installation is needed. Coordinates are **longitude, latitude** in decimal degrees. For example, from the unpacked Windows archive:

```powershell
& .\control\quickmap.cmd show "霍尔木兹海峡" 56.3 26.5
& .\control\quickmap.cmd circle northern-islands "北方四岛" 146.5 44.5 250
& .\control\quickmap.cmd remove northern-islands
```

The circle is an **illustrative search region**, not a political or legal boundary. For a more exact outline, send a GeoJSON `Polygon` or `MultiPolygon` with `& .\control\quickmap.cmd overlay file.json` in PowerShell. The API also accepts points, lines, multiple points or lines, and temporary overlays with an `expiresAt` timestamp. See [the command schema](src/shared/protocol.ts) for the accepted fields. Added overlays support hover, click, focus, update, and removal without changing the app's code.

For Codex or another MCP client, register the bundled stdio server using absolute paths to the unpacked archive. On Windows, run Electron as its bundled Node runtime:

```powershell
codex mcp add quickmap --env ELECTRON_RUN_AS_NODE=1 -- "C:\Apps\QuickMap-win32-x64\QuickMap.exe" "C:\Apps\QuickMap-win32-x64\control\mcp.cjs"
```

The MCP server offers `show_place`, `highlight_area`, `add_overlay`, `search_place`, `remove_overlay`, and `clear_overlays`. For a question like “北方四岛在哪里？”, the AI can call `highlight_area` with a center and radius, or `add_overlay` with more precise geometry. The AI must supply or look up coordinates; the built-in offline search covers countries and selected cities, not every geographic feature. No AI API key is needed for the map itself.

## Data and limits

The offline map includes 254 countries and territories, 639 selected city markers, and Chinese or English place names where supplied by the source data. Sources and regeneration steps are documented in [the data notes](src/data/README.md).

The browser map, production build, control API, and MCP tools can be checked on Linux. Global shortcut registration, selected text capture, tray behavior, and the packaged Windows application need a Windows smoke test. UI Automation selection access varies by application; copying a place name provides the clipboard fallback.
