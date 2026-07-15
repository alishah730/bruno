const { shell } = require('electron');
const { spawn } = require('child_process');
const { registerOauth2AuthorizationRequest, rejectOauth2AuthorizationRequest } = require('../../utils/oauth2-protocol-handler');

const launchOptions = {
  detached: true,
  stdio: 'ignore',
  windowsHide: true
};

const getIncognitoBrowserCommands = ({ platform = process.platform, env = process.env } = {}) => {
  if (platform === 'darwin') {
    return [
      { command: 'open', args: ['-na', 'Google Chrome', '--args', '--incognito'], waitForExit: true },
      { command: 'open', args: ['-na', 'Microsoft Edge', '--args', '--inprivate'], waitForExit: true },
      { command: 'open', args: ['-na', 'Brave Browser', '--args', '--incognito'], waitForExit: true },
      { command: 'open', args: ['-na', 'Chromium', '--args', '--incognito'], waitForExit: true },
      { command: 'open', args: ['-na', 'Firefox', '--args', '--private-window'], waitForExit: true },
      { command: 'open', args: ['-na', 'Firefox Developer Edition', '--args', '--private-window'], waitForExit: true }
    ];
  }

  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || env.LocalAppData;
    const programFiles = env.PROGRAMFILES || env.ProgramFiles;
    const programFilesX86 = env['PROGRAMFILES(X86)'] || env['ProgramFiles(x86)'];
    return [
      localAppData && { command: `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`, args: ['--incognito'] },
      programFiles && { command: `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`, args: ['--incognito'] },
      programFilesX86 && { command: `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`, args: ['--incognito'] },
      programFiles && { command: `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`, args: ['--inprivate'] },
      programFilesX86 && { command: `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`, args: ['--inprivate'] },
      localAppData && { command: `${localAppData}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`, args: ['--incognito'] },
      programFiles && { command: `${programFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`, args: ['--incognito'] },
      programFiles && { command: `${programFiles}\\Mozilla Firefox\\firefox.exe`, args: ['--private-window'] },
      programFilesX86 && { command: `${programFilesX86}\\Mozilla Firefox\\firefox.exe`, args: ['--private-window'] },
      { command: 'chrome.exe', args: ['--incognito'] },
      { command: 'msedge.exe', args: ['--inprivate'] },
      { command: 'brave.exe', args: ['--incognito'] },
      { command: 'firefox.exe', args: ['--private-window'] }
    ].filter(Boolean);
  }

  return [
    { command: 'google-chrome', args: ['--incognito'] },
    { command: 'google-chrome-stable', args: ['--incognito'] },
    { command: 'chromium', args: ['--incognito'] },
    { command: 'chromium-browser', args: ['--incognito'] },
    { command: 'microsoft-edge', args: ['--inprivate'] },
    { command: 'brave-browser', args: ['--incognito'] },
    { command: 'firefox', args: ['--private-window'] }
  ];
};

const tryLaunchCommand = ({ command, args, waitForExit = false, url, spawnFn = spawn }) => {
  return new Promise((resolve) => {
    let settled = false;
    let child;

    const settle = (launched) => {
      if (settled) {
        return;
      }
      settled = true;
      if (launched && child?.unref) {
        child.unref();
      }
      resolve(launched);
    };

    try {
      child = spawnFn(command, [...args, url], launchOptions);
    } catch (error) {
      settle(false);
      return;
    }

    child.once('error', () => settle(false));
    if (waitForExit) {
      child.once('close', (code) => settle(code === 0));
    } else {
      child.once('spawn', () => settle(true));
    }
  });
};

const openOAuthUrlInSystemBrowser = async (url, { useIncognito = false, platform = process.platform, env = process.env, spawnFn = spawn } = {}) => {
  if (useIncognito) {
    const commands = getIncognitoBrowserCommands({ platform, env });
    for (const browserCommand of commands) {
      const launched = await tryLaunchCommand({ ...browserCommand, url, spawnFn });
      if (launched) {
        return;
      }
    }
    console.warn('Unable to open OAuth URL in an incognito browser. Falling back to the default system browser.');
  }

  return shell.openExternal(url);
};

const authorizeUserInSystemBrowser = ({ authorizeUrl, callbackUrl, grantType = 'authorization_code', expectedState = null, useIncognito = false }) => {
  return new Promise((resolve, reject) => {
    // Replace callback URL in authorization URL
    const authorizationUrlObj = new URL(authorizeUrl);
    authorizationUrlObj.searchParams.set('redirect_uri', callbackUrl);
    const modifiedAuthorizeUrl = authorizationUrlObj.toString();

    // Set timeout for the request (5 minutes)
    const timeout = setTimeout(() => {
      rejectOauth2AuthorizationRequest(new Error('Authorization timeout'));
    }, 5 * 60 * 1000);

    // Wrap resolve/reject to clear timeout and add debugInfo
    const debugInfo = {
      data: []
    };

    const authorizationRequest = {
      request: {
        url: modifiedAuthorizeUrl,
        method: 'GET',
        headers: {},
        error: null
      },
      response: {
        headers: {},
        status: null,
        statusText: null,
        error: null
      },
      fromCache: false,
      completed: false
    };

    debugInfo.data.push(authorizationRequest);

    const wrappedResolve = (value) => {
      clearTimeout(timeout);
      if (grantType === 'implicit') {
        resolve({ implicitTokens: value, debugInfo });
      } else {
        resolve({ authorizationCode: value, debugInfo });
      }
    };

    const wrappedReject = (error) => {
      clearTimeout(timeout);
      reject(error);
    };

    registerOauth2AuthorizationRequest(wrappedResolve, wrappedReject, debugInfo, expectedState);

    openOAuthUrlInSystemBrowser(modifiedAuthorizeUrl, { useIncognito }).catch((error) => {
      rejectOauth2AuthorizationRequest(error);
    });
  });
};

module.exports = {
  authorizeUserInSystemBrowser,
  getIncognitoBrowserCommands,
  openOAuthUrlInSystemBrowser
};
