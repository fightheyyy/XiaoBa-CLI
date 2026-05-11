const { app, BrowserWindow, Menu, ipcMain, screen, shell } = require('electron');
const path = require('path');

const petUrl = process.env.XIAOBA_PET_URL || 'http://127.0.0.1:3900';
const chatUrl = process.env.XIAOBA_PET_CHAT_URL || petUrl;

let windowRef = null;
let chatWindowRef = null;
let dragState = null;

function openChatWindow(url = chatUrl) {
  if (chatWindowRef && !chatWindowRef.isDestroyed()) {
    chatWindowRef.loadURL(url);
    chatWindowRef.show();
    chatWindowRef.focus();
    return;
  }

  chatWindowRef = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'XiaoBa Dashboard',
    backgroundColor: '#0f1117',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  chatWindowRef.loadURL(url);
  chatWindowRef.on('closed', () => {
    chatWindowRef = null;
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
    { label: '打开 Pet 对话', click: () => openChatWindow(chatUrl) },
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
