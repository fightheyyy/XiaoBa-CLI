/**
 * WebCLI Enhanced Explorer
 *
 * 借鉴 OpenCLI 的智能分析能力：
 * 1. 自动滚动触发懒加载
 * 2. 分析 JSON 响应结构
 * 3. 推断 API 能力（搜索/分页/列表）
 * 4. 生成可执行的适配器代码
 */

const { BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 从 URL 提取站点名称
 */
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

/**
 * 判断是否是噪音 URL（静态资源等）
 */
function isNoiseUrl(url) {
  const noisePatterns = [
    /\.(jpg|jpeg|png|gif|webp|svg|ico|css|woff|woff2|ttf|eot)$/i,
    /\/(static|assets|cdn|img|images|fonts)\//i,
    /google-analytics|googletagmanager|facebook\.net|doubleclick/i,
  ];
  return noisePatterns.some(pattern => pattern.test(url));
}

/**
 * 检测分页参数
 */
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

/**
 * 检测限制参数
 */
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

/**
 * 检测搜索参数
 */
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

/**
 * 分析 JSON 响应，查找数组路径
 */
function findArrayPath(obj, maxDepth = 5) {
  function search(current, path, depth) {
    if (depth > maxDepth) return null;

    if (Array.isArray(current) && current.length > 0) {
      return { path, array: current };
    }

    if (typeof current === 'object' && current !== null) {
      for (const [key, value] of Object.entries(current)) {
        const result = search(value, path ? `${path}.${key}` : key, depth + 1);
        if (result) return result;
      }
    }

    return null;
  }

  return search(obj, '', 0);
}

/**
 * 提取数组中的字段
 */
function extractFields(array, maxSample = 3) {
  if (!Array.isArray(array) || array.length === 0) return [];

  const sample = array.slice(0, maxSample);
  const allFields = new Set();

  sample.forEach(item => {
    if (typeof item === 'object' && item !== null) {
      Object.keys(item).forEach(key => allFields.add(key));
    }
  });

  return Array.from(allFields);
}

/**
 * 推断字段角色（标题、作者、时间等）
 */
function detectFieldRoles(fields) {
  const roles = {};

  const titleKeywords = ['title', 'name', 'subject', 'headline'];
  const authorKeywords = ['author', 'user', 'creator', 'owner', 'username'];
  const timeKeywords = ['time', 'date', 'created', 'updated', 'published'];
  const idKeywords = ['id', 'uid', 'key'];
  const urlKeywords = ['url', 'link', 'href'];

  fields.forEach(field => {
    const lower = field.toLowerCase();

    if (titleKeywords.some(kw => lower.includes(kw))) {
      roles.title = field;
    } else if (authorKeywords.some(kw => lower.includes(kw))) {
      roles.author = field;
    } else if (timeKeywords.some(kw => lower.includes(kw))) {
      roles.time = field;
    } else if (idKeywords.some(kw => lower.includes(kw))) {
      roles.id = field;
    } else if (urlKeywords.some(kw => lower.includes(kw))) {
      roles.url = field;
    }
  });

  return roles;
}

/**
 * 推断 API 能力名称
 */
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

  win.webContents.session.webRequest.onCompleted((details) => {
    // 过滤噪音 URL
    if (isNoiseUrl(details.url)) return;

    // 只关注 API 请求
    if ((details.url.includes('/api/') ||
         details.url.includes('/v1/') ||
         details.url.includes('/v2/')) &&
        details.statusCode === 200) {

      const contentType = details.responseHeaders?.['content-type']?.[0] || '';

      if (contentType.includes('json')) {
        networkEntries.push({
          url: details.url,
          method: details.method,
          statusCode: details.statusCode,
          contentType: contentType
        });
      }
    }
  });

  // 拦截响应体
  const responses = new Map();

  win.webContents.debugger.attach('1.3');

  win.webContents.debugger.on('message', async (event, method, params) => {
    if (method === 'Network.responseReceived') {
      const { requestId, response } = params;

      if (response.mimeType === 'application/json') {
        try {
          const body = await win.webContents.debugger.sendCommand(
            'Network.getResponseBody',
            { requestId }
          );

          if (body.body) {
            try {
              const json = JSON.parse(body.body);
              responses.set(response.url, json);
            } catch (e) {
              // 忽略解析错误
            }
          }
        } catch (e) {
          // 忽略获取失败
        }
      }
    }
  });

  await win.webContents.debugger.sendCommand('Network.enable');

  // 尝试恢复登录状态
  await loadCookies(win, name);

  // 加载页面
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

    win.show();

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
  } else {
    console.log('✅ 已登录，无需重新登录');
    await saveCookies(win, name);
  }

  // 自动滚动触发懒加载
  console.log('📜 自动滚动页面以触发更多请求...');
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

  // 等待更多 API 请求
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 获取页面标题
  const title = await win.webContents.getTitle();

  // 关闭调试器和窗口
  win.webContents.debugger.detach();
  win.close();

  // 分析收集到的数据
  console.log(`\n📊 发现 ${networkEntries.length} 个 API 端点`);

  const analyzedEndpoints = analyzeEndpoints(networkEntries, responses);

  // 生成增强的 Skill
  generateEnhancedSkill(name, url, title, analyzedEndpoints);

  return analyzedEndpoints;
}

/**
 * 分析端点
 */
function analyzeEndpoints(entries, responses) {
  const analyzed = [];

  for (const entry of entries) {
    const responseData = responses.get(entry.url);

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
      limitParams,
      responseAnalysis: null
    };

    // 分析响应数据
    if (responseData) {
      const arrayResult = findArrayPath(responseData);

      if (arrayResult) {
        const fields = extractFields(arrayResult.array);
        const roles = detectFieldRoles(fields);

        analysis.responseAnalysis = {
          itemPath: arrayResult.path,
          itemCount: arrayResult.array.length,
          fields: fields,
          roles: roles,
          sample: arrayResult.array[0]
        };
      }
    }

    analyzed.push(analysis);
  }

  return analyzed;
}

/**
 * 生成增强的 Skill 文件
 */
function generateEnhancedSkill(name, url, title, analyzedEndpoints) {
  const skillDir = path.join(process.cwd(), 'skills', name);

  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
  }

  // 推断能力
  const capabilities = [];

  for (const endpoint of analyzedEndpoints) {
    if (!endpoint.responseAnalysis) continue;

    const capName = inferCapabilityName(
      endpoint.url,
      endpoint.hasSearch,
      endpoint.hasPagination
    );

    const { roles, fields, itemPath } = endpoint.responseAnalysis;

    capabilities.push({
      name: capName,
      url: endpoint.url,
      method: endpoint.method,
      itemPath: itemPath,
      fields: fields,
      roles: roles,
      hasSearch: endpoint.hasSearch,
      hasPagination: endpoint.hasPagination,
      searchParams: endpoint.searchParams,
      paginationParams: endpoint.paginationParams,
      limitParams: endpoint.limitParams
    });
  }

  // 生成 SKILL.md
  const skillContent = generateSkillMarkdown(name, url, title, capabilities);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);

  // 生成 YAML 适配器
  if (capabilities.length > 0) {
    for (const cap of capabilities) {
      const yamlContent = generateYamlAdapter(name, cap);
      fs.writeFileSync(path.join(skillDir, `${cap.name}.yaml`), yamlContent);
    }
  }

  console.log(`\n📝 Skill 已生成: ${skillDir}`);
  console.log(`   - SKILL.md (文档)`);
  capabilities.forEach(cap => {
    console.log(`   - ${cap.name}.yaml (适配器)`);
  });
}

/**
 * 生成 Skill Markdown 文档
 */
function generateSkillMarkdown(name, url, title, capabilities) {
  const capabilitiesSection = capabilities.map(cap => {
    const columns = [];
    if (cap.roles.title) columns.push(cap.roles.title);
    if (cap.roles.author) columns.push(cap.roles.author);
    if (cap.roles.time) columns.push(cap.roles.time);

    const args = [];
    if (cap.hasSearch) {
      args.push(`--query <关键词>`);
    }
    if (cap.hasPagination) {
      args.push(`--page <页码>`);
    }
    if (cap.hasLimit) {
      args.push(`--limit <数量>`);
    }

    return `### ${cap.name}

**API:** \`${cap.method} ${cap.url}\`

**数据路径:** \`${cap.itemPath}\`

**字段:** ${cap.fields.join(', ')}

**使用:**
\`\`\`bash
xiaoba ${name} ${cap.name} ${args.join(' ')}
\`\`\`

**示例输出:**
\`\`\`
${columns.join(' | ')}
\`\`\`
`;
  }).join('\n\n');

  return `---
name: ${name}
description: ${title || url} 系统（智能探索生成）
---

# ${name.toUpperCase()} 系统

> 此 Skill 由 WebCLI 智能探索生成
> 登录状态已保存，下次使用无需重新登录

## 系统信息

- **地址:** ${url}
- **标题:** ${title}
- **发现能力:** ${capabilities.length} 个

## 可用功能

${capabilitiesSection || '未发现可用功能'}

## 配置

- 系统地址：${url}
- 登录状态：已保存

## 注意事项

1. 登录状态已自动保存，下次使用无需重新登录
2. 如果登录过期，请删除 cookies 文件后重新探索
3. 生成的 API 列表和适配器仅供参考，实际使用时可能需要调整
4. YAML 适配器文件可以直接被 XiaoBa 加载使用
`;
}

/**
 * 生成 YAML 适配器
 */
function generateYamlAdapter(siteName, capability) {
  const { name, url, method, itemPath, roles, fields } = capability;

  // 构建参数
  const args = [];
  if (capability.hasSearch && capability.searchParams.length > 0) {
    args.push(`  ${capability.searchParams[0]}:
    type: string
    required: true
    description: 搜索关键词`);
  }
  if (capability.hasPagination && capability.paginationParams.length > 0) {
    args.push(`  ${capability.paginationParams[0]}:
    type: int
    default: 1
    description: 页码`);
  }
  if (capability.hasLimit && capability.limitParams.length > 0) {
    args.push(`  ${capability.limitParams[0]}:
    type: int
    default: 20
    description: 返回数量`);
  }

  // 构建列
  const columns = [];
  if (roles.title) columns.push(roles.title);
  if (roles.author) columns.push(roles.author);
  if (roles.time) columns.push(roles.time);
  if (roles.url) columns.push(roles.url);

  // 如果没有识别出角色，使用前几个字段
  if (columns.length === 0) {
    columns.push(...fields.slice(0, 4));
  }

  // 构建映射
  const mapping = columns.map(col => `      ${col}: \${{ item.${col} }}`).join('\n');

  return `site: ${siteName}
name: ${name}
description: ${capability.url}
domain: ${new URL(url).hostname}

${args.length > 0 ? `args:\n${args.join('\n\n')}` : '# 无参数'}

pipeline:
  - navigate: ${url}

  - evaluate: |
      (async () => {
        const res = await fetch('${url}', {
          credentials: 'include'
        });
        const data = await res.json();
        return data${itemPath ? `.${itemPath}` : ''};
      })()

  - map:
${mapping}

columns: [${columns.join(', ')}]
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
