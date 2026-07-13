const { app, BrowserWindow, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const crypto = require('crypto');

const DASHBOARD_PORT = 3800;
const DEFAULT_BUNDLED_ROLES = ['user-cat', 'inspector-cat', 'engineer-cat', 'reviewer-cat', 'browser-cat', 'gui-cat', 'secretary-cat'];
const RETIRED_AGENT_BROWSER_SKILL_SHA256S = new Set([
  '59bb1b5a07351f7b1940632695f3042afeef3268a06d03e1fbc3d85b91115648',
  '26f30428a5cff69f396e821cb51060db1f13c7ec66473268b3731001ea63cd93',
]);
const LEGACY_ROLE_CONFIG_SHA256 = {
  'browser-cat': '011fd179328b55cc375d3ef62794786369a05213d64e735be92ec4c56c7b2c46',
  'gui-cat': '507bb834c6814ee30a5f7e883e6bd622c40fd97dfc8119804683d9b309656b75',
};
let mainWindow = null;
let tray = null;
let autoUpdater = null;
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  console.log('XiaoBa Dashboard 已在运行，退出重复启动实例。');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (app.isReady()) {
      openDashboardPage();
      return;
    }
    app.once('ready', () => openDashboardPage());
  });
}

// 尝试加载 electron-updater（可选）
try {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
} catch (err) {
  console.log('electron-updater not available, auto-update disabled');
}

function getAppRoot() {
  // asar 已关闭
  // 打包后: Resources/app/desktop/electron/main.js -> Resources/app/
  // 开发时: desktop/electron/main.js -> ./
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app');
  }
  return path.join(__dirname, '..', '..');
}

/**
 * 获取内嵌的 node.exe 路径（打包版）或系统 node（开发版）
 */
function getNodeExePath() {
  if (app.isPackaged) {
    // extraFiles 将 desktop/build-resources/node/ 复制到 Contents/node/
    const nodeFileName = process.platform === 'win32' ? 'node.exe' : 'node';
    // macOS: process.execPath = Contents/MacOS/XiaoBa, 需要 ../node/node
    // Windows: process.execPath = XiaoBa.exe, 需要 ./node/node.exe
    const contentsDir = process.platform === 'darwin'
      ? path.join(path.dirname(process.execPath), '..')
      : path.dirname(process.execPath);
    const embeddedNode = path.join(contentsDir, 'node', nodeFileName);
    const fs = require('fs');
    if (fs.existsSync(embeddedNode)) {
      return embeddedNode;
    }
    console.warn('Embedded node not found at', embeddedNode, ', falling back to system node');
  }
  return 'node';
}

/**
 * 获取 node_modules 路径（打包版在 extraResources 中）
 */
function getNodeModulesPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'node_modules');
  }
  return path.join(__dirname, '..', '..', 'node_modules');
}

async function startServer() {
  const appRoot = getAppRoot();

  // 设置工作目录（打包后用userData存放用户数据）
  const userDataPath = app.getPath('userData');
  process.chdir(userDataPath);

  // 如果userData里没有.env，从app里复制.env.example
  const fs = require('fs');
  const envPath = path.join(userDataPath, '.env');
  if (!fs.existsSync(envPath)) {
    const examplePath = path.join(appRoot, '.env.example');
    if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, envPath);
    }
  }

  // 同步内置 skills 到 userData（保留用户安装的 skills）
  const skillsPath = path.join(userDataPath, 'skills');
  const bundledSkills = path.join(appRoot, 'skills');

  // BrowserCat now owns browser routing. Retire only exact XiaoBa-built copies of
  // the old Base agent-browser Skill; preserve any user-customized Skill.
  const retiredBrowserSkillDir = path.join(skillsPath, 'agent-browser');
  const retiredBrowserSkillPath = path.join(retiredBrowserSkillDir, 'SKILL.md');
  if (fs.existsSync(retiredBrowserSkillPath)) {
    const installedHash = crypto.createHash('sha256')
      .update(fs.readFileSync(retiredBrowserSkillPath))
      .digest('hex');
    if (RETIRED_AGENT_BROWSER_SKILL_SHA256S.has(installedHash)) {
      const backupRoot = path.join(userDataPath, 'migration-backups', 'agent-browser');
      const backupPath = path.join(backupRoot, `retired-${Date.now()}`);
      fs.mkdirSync(backupRoot, { recursive: true });
      fs.cpSync(retiredBrowserSkillDir, backupPath, { recursive: true });
      fs.rmSync(retiredBrowserSkillDir, { recursive: true, force: true });
    }
  }

  if (fs.existsSync(bundledSkills)) {
    fs.mkdirSync(skillsPath, { recursive: true });

    // 复制每个内置 skill（不覆盖已存在的）
    const bundledSkillDirs = fs.readdirSync(bundledSkills, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const dir of bundledSkillDirs) {
      const src = path.join(bundledSkills, dir.name);
      const dest = path.join(skillsPath, dir.name);

      if (!fs.existsSync(dest)) {
        fs.cpSync(src, dest, { recursive: true });
      }
    }

    // 复制 README
    const readmeSrc = path.join(bundledSkills, 'README.md');
    const readmeDest = path.join(skillsPath, 'README.md');
    if (fs.existsSync(readmeSrc)) {
      fs.copyFileSync(readmeSrc, readmeDest);
    }
  }

  // 同步内置 roles 到 userData（保留用户安装的 roles）
  const rolesPath = path.join(userDataPath, 'roles');
  const bundledRoles = path.join(appRoot, 'roles');

  if (fs.existsSync(bundledRoles)) {
    fs.mkdirSync(rolesPath, { recursive: true });

    for (const roleName of DEFAULT_BUNDLED_ROLES) {
      const src = path.join(bundledRoles, roleName);
      const dest = path.join(rolesPath, roleName);

      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        fs.cpSync(src, dest, { recursive: true });
        continue;
      }

      // Existing built-in role directories are normally user-owned. Migrate only
      // the exact pre-pet role.json shipped by XiaoBa, and add the bundled petId
      // without replacing prompts, skills, or any other role files.
      const bundledRoleConfigPath = path.join(src, 'role.json');
      const installedRoleConfigPath = path.join(dest, 'role.json');
      const legacyRoleConfigSha256 = LEGACY_ROLE_CONFIG_SHA256[roleName];
      if (legacyRoleConfigSha256
        && fs.existsSync(bundledRoleConfigPath)
        && fs.existsSync(installedRoleConfigPath)
        && crypto.createHash('sha256')
          .update(fs.readFileSync(installedRoleConfigPath))
          .digest('hex') === legacyRoleConfigSha256) {
        const bundledRoleConfig = JSON.parse(fs.readFileSync(bundledRoleConfigPath, 'utf8'));
        const installedRoleConfig = JSON.parse(fs.readFileSync(installedRoleConfigPath, 'utf8'));
        installedRoleConfig.metadata = {
          ...installedRoleConfig.metadata,
          petId: bundledRoleConfig.metadata.petId,
        };
        fs.writeFileSync(installedRoleConfigPath, `${JSON.stringify(installedRoleConfig, null, 2)}\n`);
      }
    }

    const readmeSrc = path.join(bundledRoles, 'README.md');
    const readmeDest = path.join(rolesPath, 'README.md');
    if (fs.existsSync(readmeSrc)) {
      fs.copyFileSync(readmeSrc, readmeDest);
    }
  }

  // 每次启动都更新 skill-registry.json（确保用户获得最新的本地索引）
  const registryDest = path.join(userDataPath, 'skill-registry.json');
  const registrySrc = path.join(appRoot, 'skill-registry.json');
  if (fs.existsSync(registrySrc)) {
    fs.copyFileSync(registrySrc, registryDest);
  }

  // 复制 prompts 目录
  const promptsDest = path.join(userDataPath, 'prompts');
  const promptsSrc = path.join(appRoot, 'prompts');
  if (!fs.existsSync(promptsDest) && fs.existsSync(promptsSrc)) {
    fs.cpSync(promptsSrc, promptsDest, { recursive: true });
  }

  // 加载dotenv；Dashboard 配置页写入的 userData/.env 应作为 Electron 运行时配置源。
  process.env.DOTENV_CONFIG_PATH = envPath;
  process.env.DOTENV_CONFIG_OVERRIDE = 'true';
  require('dotenv').config({ path: envPath, quiet: true, override: true });

  // 告诉 dashboard server app 的实际位置（asar 内）
  process.env.XIAOBA_APP_ROOT = appRoot;

  // 打包版：设置 NODE_PATH 让子进程能找到 node_modules
  const nodeModulesPath = getNodeModulesPath();
  process.env.XIAOBA_NODE_MODULES = nodeModulesPath;
  if (app.isPackaged) {
    process.env.NODE_PATH = nodeModulesPath;
    require('module').Module._initPaths();
  }

  // 设置内嵌 node.exe 路径供 service-manager 使用
  process.env.XIAOBA_NODE_EXE = getNodeExePath();

  // 直接在主进程启动dashboard server
  const { startDashboard } = require(path.join(appRoot, 'dist', 'dashboard', 'server'));
  await startDashboard(DASHBOARD_PORT, undefined, { onNavigate: openDashboardPage });
}

function getDashboardUrl(page) {
  const url = new URL(process.env.XIAOBA_DASHBOARD_URL || `http://127.0.0.1:${DASHBOARD_PORT}`);
  if (page) url.searchParams.set('page', page);
  return url.toString();
}

function createWindow(page) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'XiaoBa Dashboard',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#f8f7f3',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(getDashboardUrl(page));

  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function openDashboardPage(page) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow(page);
    return;
  }

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();

  if (!page) return;

  const script = `if (window.switchPage) { window.switchPage(${JSON.stringify(page)}); true } else false;`;
  mainWindow.webContents.executeJavaScript(script)
    .then(ok => {
      if (!ok) mainWindow.loadURL(getDashboardUrl(page));
    })
    .catch(() => {
      mainWindow.loadURL(getDashboardUrl(page));
    });
}

function createTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABhSURBVFhH7c6xDQAgDASwkP2XZgEqCgrZwJ+u8Ov1vt+RM0EHHXTQQQcddNBBBx100EEHHXTQQQcddNBBBx100EEHHXTQQQcddNBBBx100EEHHXTQQQcddNBBBx3834kDK+kAIRUXPjcAAAAASUVORK5CYII='
  );
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    { label: '打开 Dashboard', click: () => {
      openDashboardPage();
    }},
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); }},
  ]);

  tray.setToolTip('XiaoBa Dashboard');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    openDashboardPage();
  });
}

// 更新事件监听
if (autoUpdater) {
  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: `发现新版本 ${info.version}，是否下载？`,
      buttons: ['下载', '稍后'],
    }).then((result) => {
      if (result.response === 0) autoUpdater.downloadUpdate();
    });
  });

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: 'info',
      title: '更新已下载',
      message: '更新已下载完成，重启应用后生效',
      buttons: ['立即重启', '稍后'],
    }).then((result) => {
      if (result.response === 0) autoUpdater.quitAndInstall();
    });
  });
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;

  try {
    await startServer();
    createWindow();
    createTray();
    
    // 启动后检查更新
    if (app.isPackaged && autoUpdater) {
      setTimeout(() => autoUpdater.checkForUpdates(), 3000);
    }
  } catch (err) {
    console.error('启动失败:', err);
    app.quit();
  }

  app.on('activate', () => {
    openDashboardPage();
  });
});

app.on('window-all-closed', () => {
  if (!gotSingleInstanceLock) return;
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
