const { EventEmitter } = require('events');

const mockOpenExternal = jest.fn(() => Promise.resolve());

jest.mock('electron', () => ({
  shell: {
    openExternal: mockOpenExternal
  }
}));

jest.mock('../../src/utils/oauth2-protocol-handler', () => ({
  registerOauth2AuthorizationRequest: jest.fn(),
  rejectOauth2AuthorizationRequest: jest.fn()
}));

const {
  getIncognitoBrowserCommands,
  openOAuthUrlInSystemBrowser
} = require('../../src/ipc/network/authorize-user-in-system-browser');

const createSpawnChild = ({ closeCode = 0, emitSpawn = false } = {}) => {
  const child = new EventEmitter();
  child.unref = jest.fn();

  process.nextTick(() => {
    if (emitSpawn) {
      child.emit('spawn');
      return;
    }
    child.emit('close', closeCode);
  });

  return child;
};

describe('openOAuthUrlInSystemBrowser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    console.warn.mockRestore();
  });

  test('opens the default system browser when incognito is disabled', async () => {
    const spawnFn = jest.fn();
    const url = 'https://auth.example.com/authorize?client_id=bruno';

    await openOAuthUrlInSystemBrowser(url, { useIncognito: false, spawnFn });

    expect(spawnFn).not.toHaveBeenCalled();
    expect(mockOpenExternal).toHaveBeenCalledWith(url);
  });

  test('opens a macOS incognito browser before falling back to shell.openExternal', async () => {
    const spawnFn = jest.fn(() => createSpawnChild({ closeCode: 0 }));
    const url = 'https://auth.example.com/authorize?client_id=bruno';

    await openOAuthUrlInSystemBrowser(url, {
      useIncognito: true,
      platform: 'darwin',
      spawnFn
    });

    expect(spawnFn).toHaveBeenCalledWith(
      'open',
      ['-na', 'Google Chrome', '--args', '--incognito', url],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    );
    expect(mockOpenExternal).not.toHaveBeenCalled();
  });

  test('falls back to the default system browser when no incognito browser launches', async () => {
    const spawnFn = jest.fn(() => createSpawnChild({ closeCode: 1 }));
    const url = 'https://auth.example.com/authorize?client_id=bruno';

    await openOAuthUrlInSystemBrowser(url, {
      useIncognito: true,
      platform: 'darwin',
      spawnFn
    });

    expect(spawnFn).toHaveBeenCalled();
    expect(mockOpenExternal).toHaveBeenCalledWith(url);
    expect(console.warn).toHaveBeenCalledWith(
      'Unable to open OAuth URL in an incognito browser. Falling back to the default system browser.'
    );
  });

  test('uses private browsing flags for Linux browser candidates', async () => {
    const spawnFn = jest.fn(() => createSpawnChild({ emitSpawn: true }));
    const url = 'https://auth.example.com/authorize?client_id=bruno';

    await openOAuthUrlInSystemBrowser(url, {
      useIncognito: true,
      platform: 'linux',
      spawnFn
    });

    expect(spawnFn).toHaveBeenCalledWith(
      'google-chrome',
      ['--incognito', url],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    );
    expect(mockOpenExternal).not.toHaveBeenCalled();
  });

  test('builds Windows private browser candidates from known install paths and PATH commands', () => {
    const commands = getIncognitoBrowserCommands({
      platform: 'win32',
      env: {
        'LOCALAPPDATA': 'C:\\Users\\Ali\\AppData\\Local',
        'ProgramFiles': 'C:\\Program Files',
        'ProgramFiles(x86)': 'C:\\Program Files (x86)'
      }
    });

    expect(commands).toEqual(
      expect.arrayContaining([
        { command: 'C:\\Users\\Ali\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', args: ['--incognito'] },
        { command: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', args: ['--inprivate'] },
        { command: 'firefox.exe', args: ['--private-window'] }
      ])
    );
  });
});
