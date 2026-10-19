/**
 * dsh-mobile-door — 让手机 / iPad 不用手抄登录链接就能进入 DSH 的 Web 界面。
 *
 * 背景：DSH 的进门流程是「带 token 的链接 → 换取长期通行证（cookie）」。
 * 那条带 token 的链接只在 `dsh web` 启动时打印在终端里，Desktop 形态下终端
 * 不可见，手机浏览器又无法手工装 cookie。本插件额外监听一个端口，提供一次性
 * 页面 `/door`：手机在局域网打开它，页面自动写入通行证并跳转到 GUI。
 *
 * 与连接插件（dsh-client-connection 的 browser-auth）写下的凭据格式对齐：
 *   - 签名密钥 = 凭据记录 `client-connection/browser-session` 的 `payload.secret`
 *     （32 字节的 base64url）；凭据服务不可用时退回读取 `$DSH_HOME/.credentials.yaml`。
 *   - cookie 名 = `dsh-auth-` + base64url(sha256(authority))，authority = `主机:端口`。
 *   - cookie 值 = `v1.<base64url(JSON 载荷)>.<base64url(HMAC-SHA256 签名)>`，
 *     载荷为 `{ version: 1, authority, issuedAt, expiresAt }`。
 * 三项中任何一项对不上，签出的 cookie 只会得到 401，因此这里逐项复刻而非近似。
 *
 * 安全边界：只提供这一个固定页面，不解析请求里的任何输入，也不提供写配置的接口；
 * DSH 的端口不对外暴露，暴露的只有这个一次性页面。默认关闭，由使用者在配置里打开。
 *
 * @module dsh-mobile-door
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
export const name = 'dsh-mobile-door';
/** 依赖：Web 服务器必选；凭据服务可选（缺失时退回凭据文件）。 */
export const inject = {
    required: ['webServer'],
    optional: ['credentials'],
};
const AUTH_RECORD_SCOPE = 'client-connection';
const AUTH_RECORD_ID = 'browser-session';
/**
 * 凭据记录键（`<scope>/<id>`，`dsh-credentials` 的 `credentialKey()` 产出同一字符串）。
 * 写成字面量而非运行时 `import` 该包：插件要能在没装它的宿主里加载，值完全一致。
 */
const AUTH_RECORD_KEY = `${AUTH_RECORD_SCOPE}/${AUTH_RECORD_ID}`;
const STORED_SECRET_VERSION = 1;
const SECRET_BYTES = 32;
const COOKIE_PREFIX = 'dsh-auth-';
const COOKIE_PAYLOAD_VERSION = 1;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
/**
 * 编码无填充 base64url。
 * @param value - 待编码字节。
 * @returns base64url 文本。
 */
function encodeBase64Url(value) {
    return Buffer.from(value).toString('base64')
        .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
/**
 * 解码无填充 base64url，拒绝非规范写法。
 * @param value - base64url 文本。
 * @returns 解码结果；形状非法时为 undefined。
 */
function decodeBase64Url(value) {
    if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1)
        return undefined;
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const decoded = Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/') + padding, 'base64');
    return encodeBase64Url(decoded) === value ? decoded : undefined;
}
/**
 * 把请求里的 Host 归一成验收侧使用的 authority。
 *
 * 验收侧（browser-auth）用 WHATWG URL 解析 Host 后取 `.host`：小写化、去掉零填充端口的
 * 前导零、缺省端口省略。凭据名与载荷都绑定这个归一形态，所以要按同一规则构造，
 * 否则手机用 `192.168.001.5:19387` 之类写法访问时会签出一张永远验不过的 cookie。
 * @param host - 原始 Host 头。
 * @returns 归一后的 authority；无法解析时为 undefined。
 */
function canonicalAuthority(host) {
    try {
        // http: 是 WHATWG 的 special scheme，解析成功必有非空主机名。
        return new URL(`http://${host}`).host;
    }
    catch {
        return undefined;
    }
}
/**
 * 从凭据记录的载荷里取出签名密钥。
 * @param payload - 记录的 payload。
 * @returns 32 字节密钥。
 */
function secretFromPayload(payload) {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw new Error('browser-session 凭据载荷不是对象');
    }
    const typed = payload;
    if (typed.version !== STORED_SECRET_VERSION) {
        throw new Error('browser-session 凭据版本不受支持');
    }
    const secret = typeof typed.secret === 'string' ? decodeBase64Url(typed.secret) : undefined;
    if (secret === undefined || secret.byteLength !== SECRET_BYTES) {
        throw new Error('browser-session 凭据里的密钥不是 32 字节');
    }
    return secret;
}
/**
 * 不经凭据服务时，从 `$DSH_HOME/.credentials.yaml` 定向读取签名密钥。
 *
 * 该文件是 DSH 自己写出的固定形状，这里只做定向解析、不引入 YAML 依赖。
 * 找不到或形状不符一律抛错——用错误密钥签出的 cookie 只会得到 401，比报错更难排查。
 * @returns 32 字节密钥。
 */
function readSecretFromFile() {
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    const file = join(home, '.credentials.yaml');
    let raw;
    try {
        raw = readFileSync(file, 'utf8');
    }
    catch (error) {
        throw new Error(`读不到凭据文件 ${file}：${error instanceof Error ? error.message : String(error)}`);
    }
    const lines = raw.split('\n');
    const anchor = lines.findIndex(line => new RegExp(`^\\s*${AUTH_RECORD_SCOPE}/${AUTH_RECORD_ID}:\\s*$`, 'u').test(line));
    if (anchor === -1)
        throw new Error('凭据文件里没有 client-connection/browser-session 条目');
    const anchorIndent = lines[anchor]?.search(/\S/u) ?? -1;
    for (const line of lines.slice(anchor + 1)) {
        if (line.trim() === '')
            continue;
        // 缩进回到条目层级即已离开该条目。
        if (line.search(/\S/u) <= anchorIndent)
            break;
        const match = /^\s*secret:\s*(\S+)\s*$/u.exec(line);
        const raw = match?.[1];
        if (raw === undefined)
            continue;
        const secret = decodeBase64Url(raw.replace(/^["']|["']$/gu, ''));
        if (secret !== undefined && secret.byteLength === SECRET_BYTES)
            return secret;
        throw new Error('凭据条目里的 secret 不是 32 字节的 base64url');
    }
    throw new Error('凭据条目里没有 secret 字段');
}
/**
 * 取签名密钥：优先走凭据服务（与连接插件的同一份记录），不可用时读凭据文件。
 *
 * 两条路读到的都是「连接插件实际用于签发」的那把密钥，因此换存储实现也不会
 * 签出对方不认的 cookie。
 * @param ctx - 插件上下文。
 * @returns 32 字节密钥。
 */
async function loadSecret(ctx) {
    const credentials = ctx.get('credentials');
    if (credentials !== undefined) {
        try {
            const record = await credentials.readRecord(AUTH_RECORD_KEY);
            if (record !== undefined && record.kind === 'grant')
                return secretFromPayload(record.payload);
        }
        catch (error) {
            // 凭据服务不可用或记录形状不符时退回文件读取；两条路径都失败才向上抛。
            ctx.logger.warn(new Error(`dsh-mobile-door: 凭据服务读取失败，改读凭据文件：${String(error)}`));
        }
    }
    return readSecretFromFile();
}
/**
 * 计算某个 authority 对应的 cookie 名。
 * @param authority - `主机:端口`。
 * @returns cookie 名。
 */
function cookieName(authority) {
    return COOKIE_PREFIX + encodeBase64Url(createHash('sha256').update(authority).digest());
}
/**
 * 签发一张浏览器通行证。
 * @param authority - `主机:端口`。
 * @param secret - 签名密钥。
 * @param days - 有效期天数。
 * @returns cookie 名与值。
 */
function mintCookie(authority, secret, days) {
    const issuedAt = Date.now();
    const expiresAt = issuedAt + days * DAY_MILLISECONDS;
    const payload = { version: COOKIE_PAYLOAD_VERSION, authority, issuedAt, expiresAt };
    const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
    const signature = createHmac('sha256', secret).update(body).digest();
    return { name: cookieName(authority), value: `v1.${body}.${encodeBase64Url(signature)}` };
}
/**
 * 取请求携带的同源通行证值（定向解析，不实现通用 Cookie 解码）。
 * @param request - 进来的 HTTP 请求。
 * @param target - cookie 名。
 * @returns cookie 值；未携带时为 undefined。
 */
function cookieValue(request, target) {
    const rawCookie = request.headers.cookie;
    if (rawCookie === undefined)
        return undefined;
    for (const segment of rawCookie.split(';')) {
        const at = segment.indexOf('=');
        if (at === -1 || segment.slice(0, at).trim() !== target)
            continue;
        return segment.slice(at + 1).trim();
    }
    return undefined;
}
/**
 * 校验请求自带的通行证是否由同一密钥签发、绑定同一 authority 且仍然有效。
 *
 * 已持有有效通行证的设备重复打开进门页时直接跳转，不再重新签发，避免旧 cookie
 * 被覆盖成另一份有效期。
 * @param request - 进来的 HTTP 请求。
 * @param authority - 目标 authority（`主机:端口`）。
 * @param secret - 签名密钥。
 * @param days - 允许的最长有效期（天）。
 * @returns 请求是否已持有有效通行证。
 */
function hasValidPass(request, authority, secret, days) {
    const value = cookieValue(request, cookieName(authority));
    if (value === undefined)
        return false;
    const parts = value.split('.');
    const [version, body, encodedSignature] = parts;
    if (parts.length !== 3 || version !== 'v1' || body === undefined || encodedSignature === undefined)
        return false;
    const actual = decodeBase64Url(encodedSignature);
    const expected = createHmac('sha256', secret).update(body).digest();
    if (actual === undefined || actual.byteLength !== expected.byteLength)
        return false;
    if (!timingSafeEqual(actual, expected))
        return false;
    const decoded = decodeBase64Url(body);
    if (decoded === undefined)
        return false;
    let payload;
    try {
        payload = JSON.parse(decoded.toString('utf8'));
    }
    catch {
        return false;
    }
    const now = Date.now();
    return payload.version === COOKIE_PAYLOAD_VERSION
        && payload.authority === authority
        && payload.issuedAt <= now
        && payload.expiresAt > now
        && payload.expiresAt - payload.issuedAt <= days * DAY_MILLISECONDS;
}
/**
 * 枚举当前非回环 IPv4 地址，供手机选择可达地址。
 * @returns IPv4 地址列表。
 */
function lanAddresses() {
    return Object.values(networkInterfaces()).flat()
        .flatMap(iface => (iface !== undefined && iface.family === 'IPv4' && !iface.internal ? [iface.address] : []));
}
/**
 * 渲染进门页面：先写 cookie（与目标同一主机，故 document.cookie 生效），再跳转。
 * @param authority - 目标 authority（`主机:端口`）。
 * @param cookie - 要写入的通行证。
 * @param days - 通行证有效期（天），用于 max-age。
 * @returns HTML 文本。
 */
function doorPage(authority, cookie, days) {
    const target = `http://${authority}/`;
    const assignment = `${cookie.name}=${cookie.value}; path=/; max-age=${String(days * 24 * 60 * 60)}`;
    return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>正在进入 DSH</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font: 16px/1.6 -apple-system, system-ui, "PingFang SC", sans-serif; padding:24px; }
  main { max-width: 26rem; text-align:center; }
  h1 { font-size:1.25rem; margin:0 0 .75rem; }
  p { margin:.5rem 0; opacity:.8; }
  a { display:inline-block; margin-top:1.25rem; padding:.85rem 1.6rem; border-radius:.75rem;
      background:#4c6ef5; color:#fff; text-decoration:none; font-weight:600; }
  code { font-size:.85em; opacity:.75; word-break:break-all; }
</style></head>
<body><main>
  <h1>正在进入 DSH</h1>
  <p id="status">正在写入登录凭据…</p>
  <p><code>${authority}</code></p>
  <p>凭据有效期 ${String(days)} 天，期间这台设备无需再次登录。</p>
  <p><a id="go" href="${target}">立即进入</a></p>
</main>
<script>
  // cookie 按主机生效、不区分端口，这正是本页能替 DSH 端口写凭据的原因。
  document.cookie = ${JSON.stringify(assignment)}
  document.getElementById('status').textContent = '凭据已写入，正在跳转…'
  location.replace(${JSON.stringify(target)})
</script>
</body></html>
`;
}
/**
 * 处理进门请求：GET `config.path` 回页面，其余一律 404。
 * @param request - 进来的 HTTP 请求。
 * @param response - 响应所有者。
 * @param config - 已解析的配置。
 * @param secret - 签名密钥。
 */
export function handleDoor(request, response, config, secret) {
    const path = (request.url ?? '/').split('?')[0];
    if (request.method !== 'GET' || path !== config.path) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('not found\n');
        return;
    }
    const hostname = (request.headers.host ?? '').split(':')[0];
    const authority = hostname === '' ? undefined : canonicalAuthority(`${hostname}:${String(config.targetPort)}`);
    if (authority === undefined) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('missing host\n');
        return;
    }
    if (hasValidPass(request, authority, secret, config.days)) {
        response.writeHead(303, { 'cache-control': 'no-store', location: `http://${authority}/` });
        response.end();
        return;
    }
    response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
    });
    response.end(doorPage(authority, mintCookie(authority, secret, config.days), config.days));
}
/**
 * 创建进门服务（尚未监听）。
 * @param config - 已解析的配置。
 * @param ctx - 插件上下文（取签名密钥与日志用）。
 * @returns 服务实例。
 */
export function createDoor(config, ctx) {
    let server;
    let closing = false;
    return {
        async listen() {
            const secret = await loadSecret(ctx);
            if (closing)
                return;
            const created = createServer((request, response) => { handleDoor(request, response, config, secret); });
            server = created;
            await new Promise((resolve, reject) => {
                created.once('error', reject);
                created.listen(config.doorPort, '0.0.0.0', () => {
                    created.off('error', reject);
                    resolve();
                });
            });
        },
        close() {
            closing = true;
            server?.close();
            server = undefined;
        },
        port() {
            const address = server?.address();
            return typeof address === 'object' && address !== null ? address.port : undefined;
        },
    };
}
/**
 * 插件入口：按配置起进门服务；默认关门。
 *
 * 组件卸载时关闭服务，避免端口被遗留进程占住。
 * @param ctx - 插件上下文。
 * @param config - 宿主传入的配置。
 */
export function apply(ctx, config) {
    if (!config.door)
        return;
    const door = createDoor(config, ctx);
    void door.listen().then(() => {
        const port = door.port();
        const urls = lanAddresses().map(ip => `http://${ip}:${String(port)}${config.path}`);
        ctx.logger.info(urls.length === 0
            ? '[dsh-mobile-door] 进门服务已启动，但没有非回环地址'
            : `[dsh-mobile-door] 进门服务已启动：${urls.join('  ')}`);
    }).catch((error) => {
        ctx.logger.warn(new Error(`[dsh-mobile-door] 进门服务未启动：${error instanceof Error ? error.message : String(error)}`));
    });
    ctx.effect(() => () => { door.close(); }, 'dsh-mobile-door: server lifetime');
}
