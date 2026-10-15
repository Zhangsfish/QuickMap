import { defaultControlFile, parseCommand, sendRequest } from './client';

const help = `QuickMap local control

  node dist-electron/quickmap.cjs search Tokyo
  node dist-electron/quickmap.cjs region "Hong Kong"
  node dist-electron/quickmap.cjs story-step hormuz-1
  node dist-electron/quickmap.cjs show "Tokyo" 139.6917 35.6895
  node dist-electron/quickmap.cjs overlay overlay.json
  node dist-electron/quickmap.cjs circle islands "Northern islands" 146.5 44.5 250
  node dist-electron/quickmap.cjs remove overlay-id
  node dist-electron/quickmap.cjs clear
  node dist-electron/quickmap.cjs command command.json
  node dist-electron/quickmap.cjs status
  node dist-electron/quickmap.cjs quit

Use - instead of a JSON filename to read stdin. Coordinates are longitude, latitude.
Aliases: upsert-overlay = overlay, send-json = command. Circle radius is kilometers.
Use --control-file PATH or QUICKMAP_CONTROL_FILE to override the discovery file.
Overlay JSON: {"id":"spot","label":"Tokyo","geometry":{"type":"Point","coordinates":[139.6917,35.6895]}}
`;

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(help); return; }
  let controlFile = defaultControlFile();
  const flag = args.indexOf('--control-file');
  if (flag !== -1) {
    if (!args[flag + 1]) throw new Error('--control-file requires a path.');
    controlFile = args[flag + 1];
    args.splice(flag, 2);
  }
  const action = args[0];
  if ((action === 'status' || action === 'quit') && args.length !== 1) throw new Error(`Usage: ${action}`);
  const result = action === 'status'
    ? await sendRequest(controlFile, '/health')
    : action === 'quit'
      ? await sendRequest(controlFile, '/quit')
      : await sendRequest(controlFile, '/command', await parseCommand(args));
  console.log(JSON.stringify(result));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'QuickMap command failed.');
  process.exitCode = 1;
});
