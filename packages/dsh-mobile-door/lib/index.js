/**
 * dsh-mobile-door — 手机 / iPad 进 DSH Web 的签名认证页。
 *
 * 形态（两段式）：
 *   1. 手机打开 `http://<本机IP>:8899` —— 本插件在这里签发一张长期凭据写给浏览器，
 *      然后跳转；
 *   2. 跳转到 `http://<本机IP>:<DSH端口>` —— 由 DSH 自己提供服务，凭据已被接受，
 *      此后不再需要回到 8899。
 *
 * 为什么能跳过去：浏览器的 cookie 按**主机名**保存、不区分端口，所以 8899 页面上
 * 写入的凭据，浏览器访问同一主机的其它端口时会自动带上。
 *
 * 凭据格式必须与 DSH 连接插件（dsh-client-connection 的 browser-auth）逐项一致，
 * 否则签出来的是一张永远 401 的纸：
 *   - 签名密钥 = 凭据记录 `client-connection/browser-session` 的 `payload.secret`
 *     （32 字节 base64url）；
 *   - cookie 名 = `dsh-auth-` + base64url(sha256(authority))，authority = `主机:端口`；
 *   - cookie 值 = `v1.<base64url(JSON{version,authority,issuedAt,expiresAt})>.<HMAC-SHA256>`。
 *
 * 关键约束：凭据里的 authority 必须等于**浏览器实际访问 DSH 时用的那串地址**，
 * 也就是手机地址栏里的 `主机:DSH端口`。
 *
 * 安全边界：只提供这一个固定页面，不转发请求、不读写配置、不接受任何输入；
 * 默认关闭，由使用者在配置里打开；用完可改回 `door: false`。
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
/** 依赖：Web 服务器必须存在，从中读取 DSH 实际监听的端口。 */
export const inject = ['webServer'];
const AUTH_RECORD_SCOPE = 'client-connection';
const AUTH_RECORD_ID = 'browser-session';
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
 * 从凭据文件读出签名密钥。
 *
 * DSH 把密钥写在 `$DSH_HOME/.credentials.yaml`，形状固定；这里只做定向解析，
 * 不引入 YAML 依赖。找不到或形状不符一律抛错——用错密钥签出的凭据只会得到 401，
 * 比直接报错更难排查。
 * @returns 32 字节密钥。
 */
export function readSigningSecret() {
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
    const anchorIndent = (lines[anchor] ?? '').search(/\S/u);
    for (const line of lines.slice(anchor + 1)) {
        if (line.trim() === '')
            continue;
        if (line.search(/\S/u) <= anchorIndent)
            break;
        const match = /^\s*secret:\s*(\S+)\s*$/u.exec(line);
        if (match === null || match[1] === undefined)
            continue;
        const secret = decodeBase64Url(match[1].replace(/^["']|["']$/gu, ''));
        if (secret !== undefined && secret.byteLength === SECRET_BYTES)
            return secret;
        throw new Error('凭据条目里的 secret 不是 32 字节的 base64url');
    }
    throw new Error('凭据条目里没有 secret 字段');
}
/**
 * 计算某个 authority 对应的 cookie 名。
 * @param authority - `主机:端口`。
 * @returns cookie 名。
 */
export function cookieName(authority) {
    return COOKIE_PREFIX + encodeBase64Url(createHash('sha256').update(authority).digest());
}
/**
 * 签发一张凭据。
 * @param authority - `主机:端口`。
 * @param secret - 签名密钥。
 * @param days - 有效期天数。
 * @returns cookie 名与值。
 */
export function mintCookie(authority, secret, days) {
    const issuedAt = Date.now();
    const payload = {
        version: COOKIE_PAYLOAD_VERSION,
        authority,
        issuedAt,
        expiresAt: issuedAt + days * DAY_MILLISECONDS,
    };
    const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
    const signature = createHmac('sha256', secret).update(body).digest();
    return {
        name: cookieName(authority),
        value: `v${String(COOKIE_PAYLOAD_VERSION)}.${body}.${encodeBase64Url(signature)}`,
    };
}
/**
 * 取请求携带的某个 cookie 值。
 * @param request - 进来的请求。
 * @param target - cookie 名。
 * @returns cookie 值；未携带时为 undefined。
 */
function cookieValue(request, target) {
    const raw = request.headers.cookie;
    if (raw === undefined)
        return undefined;
    for (const segment of raw.split(';')) {
        const at = segment.indexOf('=');
        if (at === -1 || segment.slice(0, at).trim() !== target)
            continue;
        return segment.slice(at + 1).trim();
    }
    return undefined;
}
/**
 * 校验一枚凭据确是本插件用同一把密钥、为同一地址签发的。
 *
 * 只判断「有没有带 cookie」不够：任何伪造值都会让页面提前跳转，把用户送进一个
 * 401 的页面里，反而看不出问题。
 * @param value - 请求携带的 cookie 值。
 * @param authority - 期望的 `主机:端口`。
 * @param secret - 签名密钥。
 * @returns 是否为本插件为该地址签发的有效凭据。
 */
function isSignedHere(value, authority, secret) {
    if (value === undefined)
        return false;
    const parts = value.split('.');
    if (parts.length !== 3 || parts[0] !== `v${String(COOKIE_PAYLOAD_VERSION)}`)
        return false;
    const [, body, signature] = parts;
    const expected = createHmac('sha256', secret).update(body).digest();
    const actual = decodeBase64Url(signature);
    if (actual === undefined || actual.byteLength !== expected.byteLength)
        return false;
    if (!timingSafeEqual(actual, expected))
        return false;
    try {
        const payload = JSON.parse(Buffer.from(decodeBase64Url(body) ?? Buffer.alloc(0)).toString('utf8'));
        if (typeof payload !== 'object' || payload === null)
            return false;
        const record = payload;
        return record['authority'] === authority && typeof record['expiresAt'] === 'number' && record['expiresAt'] > Date.now();
    }
    catch {
        // 载荷不是合法 JSON，说明这枚凭据不是本插件写下的样子。
        return false;
    }
}
/**
 * 枚举当前可用的非回环 IPv4 地址。
 * @returns 地址列表。
 */
export function lanAddresses() {
    return Object.values(networkInterfaces()).flat()
        .filter((iface) => iface !== undefined)
        .filter(iface => iface.family === 'IPv4' && !iface.internal)
        .map(iface => iface.address);
}
/**
 * 渲染认证页：先写入凭据，再跳到 DSH 端口。
 * @param authority - 目标 authority（`主机:DSH端口`）。
 * @param cookie - 要写入的凭据。
 * @param days - 有效期（天），用于 max-age。
 * @returns HTML 文本。
 */
export function doorPage(authority, cookie, days) {
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
         font:16px/1.6 -apple-system,system-ui,"PingFang SC",sans-serif; padding:24px; }
  main { max-width:26rem; text-align:center; }
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
  <p>凭据有效期 ${String(days)} 天，这台设备期间无需再来本页。</p>
  <p><a id="go" href="${target}">立即进入</a></p>
</main>
<script>
  // cookie 按主机生效、不区分端口，这是本页能替 DSH 端口写凭据的原因。
  document.cookie = ${JSON.stringify(assignment)}
  document.getElementById('status').textContent = '凭据已写入，正在跳转…'
  location.replace(${JSON.stringify(target)})
</script>
</body></html>
`;
}
/**
 * 处理一次进门请求：已持有有效凭据就跳转，否则签发后跳转，其余明确拒绝。
 *
 * 单独导出而不是闭在 `createDoor` 里，是因为「DSH 端口未知」这类情形无法用真实
 * 监听的服务器构造出来，只能直接驱动这一步。
 * @param request - 进来的请求。
 * @param response - 要写的响应。
 * @param config - 插件配置。
 * @param door - 运行期依赖。
 * @param secret - 签名密钥。
 */
export function respondToDoor(request, response, config, door, secret) {
    if (request.method !== 'GET') {
        response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('method not allowed\n');
        return;
    }
    const targetPort = config.targetPort !== 0 ? config.targetPort : door.webPort();
    if (targetPort === undefined) {
        response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('dsh-mobile-door: 找不到 DSH 的端口\n');
        return;
    }
    const rawHost = request.headers.host;
    if (rawHost === undefined || rawHost === '') {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('missing host\n');
        return;
    }
    // 凭据绑定「浏览器访问 DSH 时用的地址」：同一主机名 + DSH 的端口。
    const authority = `${rawHost.split(':')[0]}:${String(targetPort)}`;
    if (isSignedHere(cookieValue(request, cookieName(authority)), authority, secret)) {
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
 * 启动认证页服务。
 * @param config - 插件配置。
 * @param door - 运行期依赖。
 * @returns 关闭函数与监听端口。
 */
export function createDoor(config, door) {
    const secret = readSigningSecret();
    let server;
    const handle = (request, response) => {
        respondToDoor(request, response, config, door, secret);
    };
    const created = createServer(handle);
    created.on('error', (error) => { door.log(`监听失败：${error.message}`); });
    created.listen(config.doorPort, '0.0.0.0', () => {
        const address = created.address();
        const actual = typeof address === 'object' && address !== null ? address.port : config.doorPort;
        const urls = lanAddresses().map(ip => `http://${ip}:${String(actual)}`);
        door.log(urls.length === 0 ? '认证页已启动，但没有非回环地址' : `认证页：${urls.join('  ')}`);
    });
    server = created;
    return {
        close: () => { server?.close(); server = undefined; },
        port: () => {
            const address = server?.address();
            return typeof address === 'object' && address !== null ? address.port : undefined;
        },
    };
}
/**
 * 插件入口。
 * @param ctx - 插件上下文。
 * @param config - 宿主传入的配置。
 */
export function apply(ctx, config) {
    if (!config.door)
        return;
    const door = createDoor(config, {
        webPort: () => ctx.webServer.port,
        log: (message) => { console.log(`[dsh-mobile-door] ${message}`); },
    });
    ctx.effect(() => () => { door.close(); }, 'dsh-mobile-door: 认证页');
}
