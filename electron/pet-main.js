const { app, BrowserWindow, Menu, ipcMain, screen, shell } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');

const petUrl = process.env.XIAOBA_PET_URL || 'http://127.0.0.1:3900';
const chatUrl = process.env.XIAOBA_PET_CHAT_URL || petUrl;

let windowRef = null;
let dragState = null;

function getCompanionUrl(url = chatUrl) {
  try {
    const target = new URL(url);
    target.searchParams.set('page', 'pet');
    return target;
  } catch {
    return null;
  }
}

function requestDashboardNavigation(url = chatUrl, onMiss) {
  const target = getCompanionUrl(url);
  if (!target) return;

  const nav = new URL('/api/navigation/open', target.origin);
  nav.searchParams.set('page', 'pet');
  nav.searchParams.set('t', String(Date.now()));

  let done = false;
  const miss = () => {
    if (done) return;
    done = true;
    if (onMiss) onMiss(target.href);
  };
  const hit = () => {
    done = true;
  };
  const transport = nav.protocol === 'https:' ? https : http;
  const req = transport.get(nav, res => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', chunk => {
      body += chunk;
      if (body.length > 2048) body = body.slice(-2048);
    });
    res.on('end', () => {
      if (res.statusCode && res.statusCode >= 400) {
        miss();
        return;
      }
      try {
        const data = JSON.parse(body);
        if (data && data.handled === false) {
          miss();
          return;
        }
      } catch {}
      hit();
    });
    res.on('error', miss);
  });
  req.setTimeout(1200, () => {
    req.destroy();
    miss();
  });
  req.on('error', miss);
}

function openChatWindow(url = chatUrl) {
  requestDashboardNavigation(url, href => {
    shell.openExternal(href);
  });
}

function createPetWindow() {
  windowRef = new BrowserWindow({
    width: 230,
    height: 280,
    minWidth: 180,
    minHeight: 220,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'pet-preload.js'),
    },
  });

  windowRef.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  windowRef.setAlwaysOnTop(true, 'floating');
  windowRef.loadURL(`${petUrl}/pet-widget.html?chat=${encodeURIComponent(chatUrl)}`);

  windowRef.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const contextMenu = Menu.buildFromTemplate([
    { label: '打开伙伴页', click: () => openChatWindow(chatUrl) },
    { type: 'separator' },
    { label: '退出 Pet', click: () => app.quit() },
  ]);

  windowRef.webContents.on('context-menu', () => {
    contextMenu.popup({ window: windowRef });
  });

  windowRef.on('closed', () => {
    windowRef = null;
  });
}

ipcMain.on('pet:drag-start', (event, point) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !point) return;
  dragState = {
    win,
    cursor: screen.getCursorScreenPoint(),
    windowBounds: win.getBounds(),
    point,
  };
});

ipcMain.on('pet:drag-move', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !dragState || dragState.win !== win) return;
  const cursor = screen.getCursorScreenPoint();
  const nextX = Math.round(dragState.windowBounds.x + cursor.x - dragState.cursor.x);
  const nextY = Math.round(dragState.windowBounds.y + cursor.y - dragState.cursor.y);
  win.setPosition(nextX, nextY, false);
});

ipcMain.on('pet:drag-end', () => {
  dragState = null;
});

ipcMain.on('pet:open-chat', (_event, url) => {
  openChatWindow(url || chatUrl);
});

app.whenReady().then(createPetWindow);

app.on('window-all-closed', () => {
  app.quit();
});
