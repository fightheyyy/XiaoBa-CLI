/**
 * WebCLI Explorer - Node.js 脚本
 *
 * 使用 Electron API 探索 Web 系统（OA、CRM、ERP 等）
 * 注意：此脚本需要在 Electron 环境中运行
 */

const { BrowserWindow, app, session } = require('electron');
const fs = require('fs');
const path = require('path');

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace('--', '');
    const value = args[i + 1];
    params[key] = value;
  }

  return params;
}

// 保存 Cookies
async function saveCookies(win, name) {
  const cookies = await win.webContents.session.cookies.get({});
  const cookiesPath = path.join(app.getPath('userData'), `web-cookies-${name}.json`);
  fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
  console.log(`✅ 已保存 ${cookies.length} 个 Cookies`);
  return cookiesPath;
}

// 加载 Cookies
async function loadCookies(win, name) {
  const cookiesPath = path.join(app.getPath('userData'), `web-cookies-${name}.json`);

  if (!fs.existsSync(cookiesPath)) {
    return false;
  }

  try {
    const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));

    for (const cookie of cookies) {
      await win.webContents.session.cookies.set({
        url: `https://${cookie.domain.replace(/^\./, '')}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expirationDate: cookie.expirationDate
      });
    }

    console.log(`✅ 已恢复 ${cookies.length} 个 Cookies`);
    return true;
  } catch (error) {
    console.error('❌ 恢复 Cookies 失败:', error.message);
    return false;
  }
}

// 探索 Web 系统
async function exploreWeb(url, name) {
  console.log('🔍 开始探索 Web 系统...');

  // 创建浏览器窗口
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // 收集 API 请求
  const apis = [];

  win.webContents.session.webRequest.onCompleted((details) => {
    if ((details.url.includes('/api/') ||
         details.url.includes('/v1/') ||
         details.url.includes('/v2/')) &&
        details.statusCode === 200) {

      const contentType = details.responseHeaders?.['content-type']?.[0] || '';

      if (contentType.includes('json')) {
        apis.push({
          url: details.url,
          method: details.method,
          statusCode: details.statusCode
        });
      }
    }
  });

  // 尝试恢复登录状态
  await loadCookies(win, name);

  // 加载 OA 页面
  console.log(`📄 正在加载: ${url}`);
  await win.loadURL(url);

  // 等待页面加载
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 检查是否需要登录
  const currentUrl = win.webContents.getURL();
  if (currentUrl.includes('/login') ||
      currentUrl.includes('/signin') ||
      currentUrl.includes('/auth')) {

    console.log('🔐 检测到需要登录');
    console.log('📢 请在弹出的窗口中登录系统');

    // 显示窗口让用户登录
    win.show();

    // 等待用户登录
    await new Promise((resolve) => {
      win.webContents.on('did-navigate', async (event, navUrl) => {
        if (!navUrl.includes('/login') &&
            !navUrl.includes('/signin') &&
            !navUrl.includes('/auth')) {

          console.log('✅ 登录成功！');
          await saveCookies(win, name);
          win.hide();
          resolve();
        }
      });
    });

    // 等待 API 请求
    await new Promise(resolve => setTimeout(resolve, 5000));
  } else {
    console.log('✅ 已登录，无需重新登录');
    await saveCookies(win, name);

    // 等待 API 请求
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // 关闭窗口
  win.close();

  // 去重 API
  const uniqueAPIs = Array.from(
    new Map(apis.map(api => [api.url, api])).values()
  );

  console.log(`\n📊 发现 ${uniqueAPIs.length} 个 API 端点`);

  // 生成 Skill
  generateSkill(name, url, uniqueAPIs);

  return uniqueAPIs;
}

// 生成 Skill 文件
function generateSkill(name, url, apis) {
  const skillDir = path.join(process.cwd(), 'skills', name);

  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
  }

  // 分析 API 类型
  const todoAPI = apis.find(api =>
    api.url.includes('todo') ||
    api.url.includes('task') ||
    api.url.includes('work')
  );

  const approvalAPI = apis.find(api =>
    api.url.includes('approval') ||
    api.url.includes('审批')
  );

  const noticeAPI = apis.find(api =>
    api.url.includes('notice') ||
    api.url.includes('announcement') ||
    api.url.includes('公告')
  );

  const skillContent = `---
name: ${name}
description: ${url} 系统（自动生成，已保存登录状态）
---

# ${name.toUpperCase()} 系统

> 此 Skill 由 XiaoBa 自动探索生成
> 登录状态已保存，下次使用无需重新登录

## 发现的 API

${apis.map(api => `- ${api.method} ${api.url}`).join('\n')}

## 使用方式

### 查看待办事项

**用户：** "查看我的待办"

**实现：**
${todoAPI ? `
调用 API: ${todoAPI.method} ${todoAPI.url}
` : '未发现待办 API'}

### 查看审批流程

**用户：** "有哪些待审批的"

**实现：**
${approvalAPI ? `
调用 API: ${approvalAPI.method} ${approvalAPI.url}
` : '未发现审批 API'}

### 查看公告

**用户：** "最新的公告"

**实现：**
${noticeAPI ? `
调用 API: ${noticeAPI.method} ${noticeAPI.url}
` : '未发现公告 API'}

## 配置

- 系统地址：${url}
- 登录状态：已保存

## 注意事项

1. 登录状态已自动保存，下次使用无需重新登录
2. 如果登录过期，请删除 cookies 文件后重新探索
3. 生成的 API 列表仅供参考，实际使用时可能需要调整
`;

  const skillPath = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(skillPath, skillContent);

  console.log(`\n📝 Skill 已生成: ${skillPath}`);
}

// 主函数
async function main() {
  const params = parseArgs();

  if (!params.url || !params.name) {
    console.error('❌ 缺少必需参数: --url 和 --name');
    process.exit(1);
  }

  try {
    await app.whenReady();
    await exploreWeb(params.url, params.name);
    console.log('\n✅ 探索完成！');
    app.quit();
  } catch (error) {
    console.error('❌ 探索失败:', error.message);
    app.quit();
    process.exit(1);
  }
}

// 运行
if (require.main === module) {
  main();
}

module.exports = { exploreWeb };
