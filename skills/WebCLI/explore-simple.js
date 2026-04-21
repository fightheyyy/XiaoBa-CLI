/**
 * WebCLI Enhanced Explorer - 简化版
 *
 * 先实现基本的网络监听和分析，不使用 debugger
 */

const { BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');

// ============================================================================
// 工具函数
// ============================================================================

function detectSiteName(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const parts = host.split('.').filter(p => p && p !== 'www');
    if (parts.length >= 2) {
      return slugify(parts[parts.length - 2]);
    }
    return parts[0] ? slugify(parts[0]) : 'site';
  } catch {
    return 'site';
  }
}

function slugify(value) {
  return value.trim().toLowerCase()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'site';
}

function isNoiseUrl(url) {
  const noisePatterns = [
    /\.(jpg|jpeg|png|gif|webp|svg|ico|css|woff|woff2|ttf|eot)$/i,
    /\/(static|assets|cdn|img|images|fonts)\//i,
    /google-analytics|googletagmanager|facebook\.net|doubleclick/i,
  ];
  return noisePatterns.some(pattern => pattern.test(url));
}

function detectPaginationParams(url) {
  const paginationKeywords = ['page', 'pn', 'pageNum', 'pageNo', 'offset', 'start', 'cursor'];
  try {
    const urlObj = new URL(url);
    const params = Array.from(urlObj.searchParams.keys());
    return params.filter(p =>
      paginationKeywords.some(kw => p.toLowerCase().includes(kw.toLowerCase()))
    );
  } catch {
    return [];
  }
}

function detectLimitParams(url) {
  const limitKeywords = ['limit', 'size', 'pageSize', 'ps', 'count', 'num'];
  try {
    const urlObj = new URL(url);
    const params = Array.from(urlObj.searchParams.keys());
    return params.filter(p =>
      limitKeywords.some(kw => p.toLowerCase().includes(kw.toLowerCase()))
    );
  } catch {
    return [];
  }
}

function detectSearchParams(url) {
  const searchKeywords = ['q', 'query', 'keyword', 'search', 'kw', 's'];
  try {
    const urlObj = new URL(url);
    const params = Array.from(urlObj.searchParams.keys());
    return params.filter(p =>
      searchKeywords.some(kw => p.toLowerCase().includes(kw.toLowerCase()))
    );
  } catch {
    return [];
  }
}

function inferCapabilityName(url, hasSearch, hasPagination) {
  const urlLower = url.toLowerCase();

  if (urlLower.includes('search')) return 'search';
  if (urlLower.includes('hot') || urlLower.includes('trending')) return 'hot';
  if (urlLower.includes('recommend')) return 'recommend';
  if (urlLower.includes('list')) return 'list';
  if (urlLower.includes('feed')) return 'feed';
  if (urlLower.includes('todo') || urlLower.includes('task')) return 'todo';
  if (urlLower.includes('approval')) return 'approval';
  if (urlLower.includes('notice') || urlLower.includes('announcement')) return 'notice';

  if (hasSearch) return 'search';
  if (hasPagination) return 'list';

  return 'data';
}

// ============================================================================
// Cookie 管理
// ============================================================================

async function saveCookies(win, name) {
  const cookies = await win.webContents.session.cookies.get({});
  const cookiesPath = path.join(app.getPath('userData'), `web-cookies-${name}.json`);
  fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
  console.log(`✅ 已保存 ${cookies.length} 个 Cookies`);
  return cookiesPath;
}

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

// ============================================================================
// 核心探索逻辑
// ============================================================================

async function exploreWeb(url, name) {
  console.log('🔍 开始智能探索 Web 系统...');

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // 收集网络请求
  const networkEntries = [];
  const allRequests = []; // 记录所有请求用于调试

  win.webContents.session.webRequest.onCompleted((details) => {
    // 记录所有请求（调试用）
    if (!isNoiseUrl(details.url)) {
      allRequests.push({
        url: details.url,
        method: details.method,
        status: details.statusCode,
        contentType: details.responseHeaders?.['content-type']?.[0] || ''
      });
    }

    if (isNoiseUrl(details.url)) return;

    // 扩展 API 检测规则
    const isAPI = (
      details.url.includes('/api/') ||
      details.url.includes('/v1/') ||
      details.url.includes('/v2/') ||
      details.url.includes('/graphql') ||
      details.url.includes('/rest/') ||
      details.url.includes('/data/') ||
      details.url.includes('.json') ||
      (details.method === 'POST' && details.statusCode === 200)
    );

    if (isAPI && details.statusCode === 200) {
      const contentType = details.responseHeaders?.['content-type']?.[0] || '';

      if (contentType.includes('json') || contentType.includes('application/json')) {
        console.log(`   🔍 发现 API: ${details.method} ${details.url}`);
        networkEntries.push({
          url: details.url,
          method: details.method,
          statusCode: details.statusCode,
          contentType: contentType
        });
      }
    }
  });

  // 尝试恢复登录状态
  await loadCookies(win, name);

  // 加载页面
  console.log(`📄 正在加载: ${url}`);

  try {
    await win.loadURL(url);
  } catch (error) {
    console.error(`❌ 加载失败: ${error.message}`);
    win.close();
    throw error;
  }

  // 等待页面加载
  console.log('⏳ 等待页面加载（React/Vue 应用需要更长时间）...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // 检查是否需要登录
  const currentUrl = win.webContents.getURL();
  const needsLogin = currentUrl.includes('/login') ||
                     currentUrl.includes('/signin') ||
                     currentUrl.includes('/auth');

  // 如果 URL 包含 /user 或 /dashboard，也可能需要登录
  const mightNeedLogin = currentUrl.includes('/user') ||
                         currentUrl.includes('/dashboard') ||
                         currentUrl.includes('/console');

  if (needsLogin || mightNeedLogin) {
    console.log('🔐 检测到可能需要登录的页面');
    console.log('📢 正在显示窗口，如需登录请手动操作...');
    console.log('   如果已登录，请等待 10 秒后窗口会自动关闭');

    win.show();

    // 等待 10 秒，让用户有时间登录
    await new Promise(resolve => setTimeout(resolve, 10000));

    // 检查是否已经跳转
    const finalUrl = win.webContents.getURL();
    if (finalUrl !== currentUrl) {
      console.log('✅ 检测到页面跳转，可能已登录');
    }

    await saveCookies(win, name);
    win.hide();
  } else {
    console.log('✅ 普通页面，无需登录');
    await saveCookies(win, name);
  }

  // 自动滚动触发懒加载
  console.log('📜 自动滚动页面以触发更多请求...');
  try {
    await win.webContents.executeJavaScript(`
      (async () => {
        const scrollStep = 500;
        const scrollDelay = 300;
        const maxScrolls = 5;

        for (let i = 0; i < maxScrolls; i++) {
          window.scrollBy(0, scrollStep);
          await new Promise(r => setTimeout(r, scrollDelay));
        }

        window.scrollTo(0, 0);
      })()
    `);
  } catch (error) {
    console.log('⚠️  滚动失败（可能是 API 页面）:', error.message);
  }

  // 等待更多 API 请求
  console.log('⏳ 等待更多 API 请求...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // 获取页面标题
  let title = 'Unknown';
  try {
    title = await win.webContents.getTitle();
  } catch (error) {
    console.log('⚠️  获取标题失败');
  }

  // 关闭窗口
  win.close();

  // 分析收集到的数据
  console.log(`\n📊 发现 ${networkEntries.length} 个 API 端点`);

  // 调试：显示所有非噪音请求
  if (allRequests.length > 0) {
    console.log(`\n🔍 调试信息：共捕获 ${allRequests.length} 个请求`);
    console.log('前 10 个请求：');
    allRequests.slice(0, 10).forEach((req, idx) => {
      console.log(`  ${idx + 1}. ${req.method} ${req.url.substring(0, 80)}`);
      console.log(`     状态: ${req.status}, 类型: ${req.contentType}`);
    });
  }

  const analyzedEndpoints = analyzeEndpoints(networkEntries);

  // 生成增强的 Skill
  generateEnhancedSkill(name, url, title, analyzedEndpoints);

  return analyzedEndpoints;
}

function analyzeEndpoints(entries) {
  const analyzed = [];

  for (const entry of entries) {
    const searchParams = detectSearchParams(entry.url);
    const paginationParams = detectPaginationParams(entry.url);
    const limitParams = detectLimitParams(entry.url);

    const analysis = {
      url: entry.url,
      method: entry.method,
      hasSearch: searchParams.length > 0,
      hasPagination: paginationParams.length > 0,
      hasLimit: limitParams.length > 0,
      searchParams,
      paginationParams,
      limitParams
    };

    analyzed.push(analysis);
  }

  return analyzed;
}

function generateEnhancedSkill(name, url, title, analyzedEndpoints) {
  const skillDir = path.join(process.cwd(), 'skills', name);

  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
  }

  // 推断能力
  const capabilities = [];

  for (const endpoint of analyzedEndpoints) {
    const capName = inferCapabilityName(
      endpoint.url,
      endpoint.hasSearch,
      endpoint.hasPagination
    );

    capabilities.push({
      name: capName,
      url: endpoint.url,
      method: endpoint.method,
      hasSearch: endpoint.hasSearch,
      hasPagination: endpoint.hasPagination,
      searchParams: endpoint.searchParams,
      paginationParams: endpoint.paginationParams,
      limitParams: endpoint.limitParams
    });
  }

  // 生成 SKILL.md
  const skillContent = generateSkillMarkdown(name, url, title, capabilities, analyzedEndpoints);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);

  console.log(`\n📝 Skill 已生成: ${skillDir}/SKILL.md`);
}

function generateSkillMarkdown(name, url, title, capabilities, allEndpoints) {
  const capabilitiesSection = capabilities.map((cap, idx) => {
    const args = [];
    if (cap.hasSearch) {
      args.push(`--${cap.searchParams[0] || 'query'} <关键词>`);
    }
    if (cap.hasPagination) {
      args.push(`--${cap.paginationParams[0] || 'page'} <页码>`);
    }
    if (cap.hasLimit) {
      args.push(`--${cap.limitParams[0] || 'limit'} <数量>`);
    }

    return `### ${idx + 1}. ${cap.name}

**API:** \`${cap.method} ${cap.url}\`

**特性:**
- 搜索: ${cap.hasSearch ? '✅' : '❌'} ${cap.searchParams.length > 0 ? `(参数: ${cap.searchParams.join(', ')})` : ''}
- 分页: ${cap.hasPagination ? '✅' : '❌'} ${cap.paginationParams.length > 0 ? `(参数: ${cap.paginationParams.join(', ')})` : ''}
- 限制: ${cap.hasLimit ? '✅' : '❌'} ${cap.limitParams.length > 0 ? `(参数: ${cap.limitParams.join(', ')})` : ''}

**使用示例:**
\`\`\`bash
xiaoba ${name} ${cap.name} ${args.join(' ')}
\`\`\`
`;
  }).join('\n\n');

  const allAPIsSection = allEndpoints.map((ep, idx) =>
    `${idx + 1}. \`${ep.method} ${ep.url}\``
  ).join('\n');

  return `---
name: ${name}
description: ${title} - 智能探索生成
---

# ${name.toUpperCase()} 系统

> 此 Skill 由 WebCLI 智能探索生成
> 登录状态已保存，下次使用无需重新登录

## 系统信息

- **地址:** ${url}
- **标题:** ${title}
- **发现 API:** ${allEndpoints.length} 个
- **推断能力:** ${capabilities.length} 个

## 发现的所有 API

${allAPIsSection || '未发现 API'}

## 推断的功能

${capabilitiesSection || '未推断出具体功能'}

## 配置

- 系统地址：${url}
- 登录状态：已保存

## 注意事项

1. 登录状态已自动保存，下次使用无需重新登录
2. 如果登录过期，请删除 cookies 文件后重新探索
3. 生成的 API 列表仅供参考，实际使用时可能需要调整
4. 推断的功能基于 URL 模式和参数分析，可能不完全准确

## 下一步

1. 查看生成的 API 列表
2. 手动测试 API 端点
3. 根据实际响应编写适配器代码
4. 参考 OpenCLI 的 YAML 格式创建适配器
`;
}

// ============================================================================
// 主函数
// ============================================================================

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
    console.error(error.stack);
    app.quit();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { exploreWeb };
