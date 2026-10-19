/**
 * dsh-mobile-door — 让手机 / iPad 访问只监听本机回环地址的 DSH Web。
 *
 * DSH 的 Web 服务器只绑回环地址，且桌面外壳按 `127.0.0.1:<端口>` 连接，改成绑
 * 局域网地址会让桌面外壳连不上。所以本插件不依赖 DSH 对外监听，而是自己在局域网
 * 端口上做一个「认证 + 反向代理」：
 *
 *   1. 手机打开 `http://<本机IP>:8899` —— 插件检查浏览器有没有本插件签发的凭据，
 *      没有就回一个页面，让浏览器写入凭据再跳回来；
 *   2. 带上凭据后，插件的同一个端口把请求原样转发给 `127.0.0.1:<DSH端口>`，再把
 *      响应原样交回。手机地址栏始终停在 8899，凭据只对本插件有效。
 *
 * 转发必须处理三件 DSH 会校验的事：
 *   - `Host`：DSH 的源码地址栅栏只信回环，所以转发时把 Host 改写成回环地址；
 *   - `Origin`：DSH 的 Origin 校验只接受它自己，所以要改写成起点地址；
 *   - `Referer`：同理改写成起点地址。
 * 浏览器带来的凭据头不会转发给 DSH（DSH 那里没有这个凭据，带着只会 401），由
 * 插件自己校验。
 *
 * 凭据用 DSH 自己的签名密钥（`$DSH_HOME/.credentials.yaml` 里
 * `client-connection/browser-session` 的 secret）签发，格式与 DSH 的 browser-auth
 * 一致，因此换回直连 DSH 时同一张纸仍然有效。
 *
 * 安全边界：只在配置的端口上服务，校验自有凭据后才转发；默认关闭。凭据按主机名
 * 绑定，换主机名访问需要重新过一次页面。
 *
 * @module dsh-mobile-door
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { readFileSync } from 'node:fs'
import { homedir, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'dsh-mobile-door'

/** 依赖：Web 服务器必须存在，从中读取 DSH 实际监听的端口。 */
export const inject = ['webServer']

const AUTH_RECORD_SCOPE = 'client-connection'
const AUTH_RECORD_ID = 'browser-session'
const SECRET_BYTES = 32
const COOKIE_PREFIX = 'dsh-auth-'
const COOKIE_PAYLOAD_VERSION = 1
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/u
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
/** 转发时不搬给 DSH 的逐跳头。 */
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
])

/** 插件配置：由宿主 `cordis.yml` / `cordis.patch.yml` 的 `config` 提供。 */
export interface Config {
  /** 是否开启代理入口；关闭时不监听任何端口。 */
  door: boolean
  /** 代理入口监听的端口；0 表示由系统分配。 */
  doorPort: number
  /** 签出的凭据有效期（天），不得大于连接插件的 `cookieMaxAgeDays`。 */
  days: number
  /** 转发目标的 DSH 端口；0 表示用 Web 服务器实际监听的端口。 */
  targetPort: number
}

/** 运行期依赖：端口来源与日志出口。 */
export interface DoorContext {
  /** DSH Web 实际监听的端口，未启动时为 undefined。 */
  webPort: () => number | undefined
  /** 写一行日志。 */
  log: (message: string) => void
}

/**
 * 解析 base64url 文本。
 * @param value - 待解析文本。
 * @returns 解码后的字节。
 */
export function decodeBase64Url(value: string): Buffer {
  if (!BASE64URL_PATTERN.test(value)) throw new Error('不是合法的 base64url 文本')
  return Buffer.from(value, 'base64url')
}

/**
 * 读 DSH 的会话签名密钥。
 *
 * 从 `$DSH_HOME/.credentials.yaml` 定向取 `client-connection/browser-session` 的
 * `secret`，不引入 YAML 依赖；形状不符立即报错，绝不用错的密钥签发。
 * @returns 32 字节签名密钥。
 * @throws 当凭据文件不可读、条目缺失或密钥长度不对时。
 */
export function readSigningSecret(): Buffer {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const file = join(home, '.credentials.yaml')
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    throw new Error(`读不到凭据文件 ${file}：${(error as Error).message}`)
  }
  let inRecord = false
  let inPayload = false
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    const indent = line.length - line.trimStart().length
    if (indent <= 2 && trimmed.endsWith(':')) {
      inRecord = trimmed === `${AUTH_RECORD_SCOPE}/${AUTH_RECORD_ID}:`
      inPayload = false
      continue
    }
    if (!inRecord) continue
    if (indent <= 4 && trimmed.endsWith(':')) {
      inPayload = trimmed === 'payload:'
      continue
    }
    if (inPayload && trimmed.startsWith('secret:')) {
      const secret = decodeBase64Url(trimmed.slice('secret:'.length).trim())
      if (secret.length !== SECRET_BYTES) {
        throw new Error(`凭据里的签名密钥不是 ${String(SECRET_BYTES)} 字节（实为 ${String(secret.length)}）`)
      }
      return secret
    }
  }
  throw new Error(`凭据文件 ${file} 里没有 ${AUTH_RECORD_SCOPE}/${AUTH_RECORD_ID} 条目`)
}

/**
 * 归一化 authority：与 DSH 校验侧一致地小写、去端口前导零。
 * @param host - 请求头里的 Host。
 * @returns 归一后的 `主机:端口`。
 * @throws 当 Host 不是合法 authority 时。
 */
export function canonicalAuthority(host: string): string {
  // 自己拆端口，不交给 URL：URL 会把默认端口 80 直接丢掉，导致 http 场景判断不出来。
  const at = host.lastIndexOf(':')
  if (at <= 0) throw new Error(`不是合法的 authority：${host}`)
  const portText = host.slice(at + 1)
  if (!/^\d+$/u.test(portText)) throw new Error(`不是合法的 authority：${host}`)
  const port = Number(portText)
  if (port < 1 || port > 65535) throw new Error(`不是合法的 authority：${host}`)
  const hostname = new URL(`http://${host.slice(0, at)}`).hostname
  if (hostname === '') throw new Error(`不是合法的 authority：${host}`)
  return `${hostname}:${String(port)}`
}

/**
 * 计算某 authority 对应的 cookie 名。
 * @param authority - `主机:端口`。
 * @returns cookie 名。
 */
export function cookieName(authority: string): string {
  return COOKIE_PREFIX + createHash('sha256').update(authority).digest('base64url')
}

/**
 * 为某 authority 签发一张凭据。
 * @param authority - `主机:端口`。
 * @param secret - 32 字节签名密钥。
 * @param days - 有效期天数。
 * @returns cookie 名与值。
 */
export function mintCookie(
  authority: string,
  secret: Buffer,
  days: number,
): { name: string, value: string } {
  const issuedAt = Date.now()
  const body = Buffer.from(JSON.stringify({
    version: COOKIE_PAYLOAD_VERSION,
    authority,
    issuedAt,
    expiresAt: issuedAt + days * DAY_MILLISECONDS,
  }), 'utf8')
  const encodedBody = body.toString('base64url')
  const signature = createHmac('sha256', secret).update(encodedBody).digest()
  return {
    name: cookieName(authority),
    value: `v${String(COOKIE_PAYLOAD_VERSION)}.${encodedBody}.${signature.toString('base64url')}`,
  }
}

/**
 * 从请求头里取某个 cookie 的值。
 * @param request - 进来的请求。
 * @param name - cookie 名。
 * @returns cookie 值，没有则为 undefined。
 */
function cookieValue(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at < 0) continue
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim()
  }
  return undefined
}

/**
 * 校验凭据确实是本密钥为该 authority 签发的且未过期。
 * @param value - cookie 值。
 * @param authority - `主机:端口`。
 * @param secret - 32 字节签名密钥。
 * @returns 是否有效。
 */
export function isSignedHere(value: string | undefined, authority: string, secret: Buffer): boolean {
  if (value === undefined) return false
  const parts = value.split('.')
  if (parts.length !== 3) return false
  const version = parts[0]
  const encodedBody = parts[1] ?? ''
  const encodedSignature = parts[2] ?? ''
  if (version !== `v${String(COOKIE_PAYLOAD_VERSION)}`) return false
  let expected: Buffer
  let actual: Buffer
  try {
    expected = createHmac('sha256', secret).update(encodedBody).digest()
    actual = decodeBase64Url(encodedSignature)
  } catch {
    // 形状不合法就是无效凭据，按未登录处理，不放大成 500。
    return false
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false
  let payload: unknown
  try {
    payload = JSON.parse(decodeBase64Url(encodedBody).toString('utf8'))
  } catch {
    // 签名对但载荷读不出，说明不是本插件的产物。
    return false
  }
  if (typeof payload !== 'object' || payload === null) return false
  const fields = payload as Record<string, unknown>
  return fields['version'] === COOKIE_PAYLOAD_VERSION
    && fields['authority'] === authority
    && typeof fields['expiresAt'] === 'number'
    && fields['expiresAt'] > Date.now()
}

/**
 * 枚举本机的非回环 IPv4 地址。
 * @returns 可用的局域网地址。
 */
export function lanAddresses(): string[] {
  const found: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address)
    }
  }
  return found
}

/**
 * 渲染让浏览器写入凭据并跳回来的页面。
 * @param authority - 浏览器此刻访问的 `主机:端口`。
 * @param cookie - 要写入的凭据。
 * @param days - 有效期天数，用于设置 max-age。
 * @returns HTML 文本。
 */
export function doorPage(authority: string, cookie: { name: string, value: string }, days: number): string {
  const target = `http://${authority}/`
  // cookie 按主机保存、不区分端口，所以这里写下的凭据在同一个端口上就能用。
  const assignment = `${cookie.name}=${cookie.value}; path=/; max-age=${String(days * 86400)}; samesite=lax`
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>正在进入 DSH</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font:16px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;
       background:#0f1115;color:#e6e8eb}
  main{text-align:center;padding:24px}
  p{color:#9aa4b2;font-size:14px;margin:8px 0 0}
</style></head>
<body><main>
  <div id="status">正在写入凭据…</div>
  <p>成功后会自动跳转，本页可以关掉</p>
</main>
<script>
  document.cookie = ${JSON.stringify(assignment)}
  document.getElementById('status').textContent = '凭据已写入，正在跳转…'
  location.replace(${JSON.stringify(target)})
</script>
</body></html>
`
}

/**
 * 把浏览器的 Cookie 头改写成 DSH 认的样子。
 *
 * 浏览器带来的是本插件针对它自己地址签的凭据，DSH 不认，必须摘掉；DSH 把凭据
 * 绑在 Host 上，所以还要补一张回环 authority 的凭据。
 * @param header - 浏览器带来的原始 Cookie 头。
 * @param authority - 转发目标 authority。
 * @param secret - 签名密钥。
 * @param days - 有效期天数。
 * @returns 要发给 DSH 的 Cookie 头；没有内容时为 undefined。
 */
function relayCookies(
  header: string | string[] | undefined,
  authority: string,
  secret: Buffer,
  days: number,
): string | undefined {
  const relayed = mintCookie(authority, secret, days)
  const relayedPair = `${relayed.name}=${relayed.value}`
  if (header === undefined) return relayedPair
  const joined = Array.isArray(header) ? header.join('; ') : header
  const kept = joined.split(';')
    .map(part => part.trim())
    .filter(part => part !== '' && !part.startsWith(COOKIE_PREFIX))
  return [...kept, relayedPair].join('; ')
}

/**
 * 把请求转发给本机回环上的 DSH，并把响应原样交回。
 *
 * DSH 的源码栅栏只信回环地址、Origin 校验只接受它自己，所以转发前把
 * `Host`/`Origin`/`Referer` 改写成回环起点；浏览器带来的插件凭据不转发。
 * @param request - 进来的请求。
 * @param response - 要写的响应。
 * @param targetPort - DSH 监听的回环端口。
 */
function forward(
  request: IncomingMessage,
  response: ServerResponse,
  targetPort: number,
  secret: Buffer,
  days: number,
): void {
  const headers: IncomingHttpHeaders = {}
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined || HOP_BY_HOP.has(key)) continue
    if (key === 'cookie') continue
    headers[key] = value
  }
  const authority = `127.0.0.1:${String(targetPort)}`
  const origin = `http://${authority}`
  headers.host = authority
  if (headers.origin !== undefined) headers.origin = origin
  if (headers.referer !== undefined) {
    const path = request.url ?? '/'
    headers.referer = `${origin}${path}`
  }
  const cookies = relayCookies(request.headers.cookie, authority, secret, days)
  if (cookies !== undefined) headers.cookie = cookies

  const upstream = httpRequest({
    host: '127.0.0.1',
    port: targetPort,
    method: request.method,
    path: request.url,
    headers,
  }, (upstreamResponse) => {
    const responseHeaders: IncomingHttpHeaders = {}
    for (const [key, value] of Object.entries(upstreamResponse.headers)) {
      if (value !== undefined && !HOP_BY_HOP.has(key)) responseHeaders[key] = value
    }
    response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders)
    upstreamResponse.pipe(response)
  })
  upstream.on('error', (error) => {
    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(`dsh-mobile-door: 转发到 DSH 失败：${error.message}\n`)
    } else {
      response.destroy()
    }
  })
  request.pipe(upstream)
}

/**
 * 把 WebSocket 升级转发给 DSH。
 *
 * DSH 的实时通道走 `upgrade` 事件，不走普通请求处理；不转发的话界面能打开但连不
 * 上后端，所以这里独立处理。握手成功后两端直接对接，不再经过 HTTP 层。
 * @param request - 进来的升级请求。
 * @param socket - 浏览器侧连接。
 * @param head - 已读出的首段数据。
 * @param targetPort - DSH 监听的回环端口。
 * @param secret - 签名密钥。
 * @param days - 有效期天数。
 */
function forwardUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  targetPort: number,
  secret: Buffer,
  days: number,
): void {
  const authority = `127.0.0.1:${String(targetPort)}`
  const headers: IncomingHttpHeaders = {}
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    if (key === 'cookie' || key === 'host' || key === 'origin' || key === 'referer') continue
    headers[key] = value
  }
  headers.host = authority
  if (request.headers.origin !== undefined) headers.origin = `http://${authority}`
  const cookies = relayCookies(request.headers.cookie, authority, secret, days)
  if (cookies !== undefined) headers.cookie = cookies

  const upstream = httpRequest({
    host: '127.0.0.1',
    port: targetPort,
    method: request.method,
    path: request.url,
    headers,
  })
  upstream.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
    const lines = [`HTTP/1.1 ${String(upstreamResponse.statusCode ?? 101)} ${upstreamResponse.statusMessage ?? 'Switching Protocols'}`]
    for (const [key, value] of Object.entries(upstreamResponse.headers)) {
      if (value === undefined) continue
      for (const one of Array.isArray(value) ? value : [value]) lines.push(`${key}: ${one}`)
    }
    socket.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (upstreamHead.length > 0) socket.write(upstreamHead)
    if (head.length > 0) upstreamSocket.write(head)
    upstreamSocket.pipe(socket).pipe(upstreamSocket)
    upstreamSocket.on('error', () => { socket.destroy() })
    socket.on('error', () => { upstreamSocket.destroy() })
  })
  upstream.on('response', (upstreamResponse) => {
    // DSH 没同意升级（凭据缺失等）：把它的状态原样交回。
    socket.write(`HTTP/1.1 ${String(upstreamResponse.statusCode ?? 502)} ${upstreamResponse.statusMessage ?? 'Error'}\r\n\r\n`)
    upstreamResponse.pipe(socket)
  })
  upstream.on('error', () => { socket.destroy() })
  upstream.end()
}

/**
 * 处理一次请求：没有有效凭据就给页面，有就转发给 DSH。
 *
 * 单独导出而不是闭在 `createDoor` 里，是因为「DSH 端口未知」这类情形无法用真实
 * 监听的服务器构造出来，只能直接驱动这一步。
 * @param request - 进来的请求。
 * @param response - 要写的响应。
 * @param config - 插件配置。
 * @param door - 运行期依赖。
 * @param secret - 签名密钥。
 */
export function respondToDoor(
  request: IncomingMessage,
  response: ServerResponse,
  config: Config,
  door: DoorContext,
  secret: Buffer,
): void {
  const targetPort = config.targetPort !== 0 ? config.targetPort : door.webPort()
  if (targetPort === undefined) {
    response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('dsh-mobile-door: 找不到 DSH 的端口\n')
    return
  }
  const rawHost = request.headers.host
  if (rawHost === undefined || rawHost === '') {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('missing host\n')
    return
  }
  let authority: string
  try {
    authority = canonicalAuthority(rawHost)
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('bad host\n')
    return
  }
  if (!isSignedHere(cookieValue(request, cookieName(authority)), authority, secret)) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('dsh-mobile-door: 请先用浏览器打开本页完成一次进门\n')
      return
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    })
    response.end(doorPage(authority, mintCookie(authority, secret, config.days), config.days))
    return
  }
  forward(request, response, targetPort, secret, config.days)
}

/**
 * 启动代理入口。
 * @param config - 插件配置。
 * @param door - 运行期依赖。
 * @returns 关闭函数与监听端口。
 */
export function createDoor(
  config: Config,
  door: DoorContext,
): { close: () => void, port: () => number | undefined } {
  const secret = readSigningSecret()
  let server: Server | undefined

  const handle = (request: IncomingMessage, response: ServerResponse): void => {
    respondToDoor(request, response, config, door, secret)
  }

  const created = createServer(handle)
  created.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const targetPort = config.targetPort !== 0 ? config.targetPort : door.webPort()
    if (targetPort === undefined) { socket.destroy(); return }
    const rawHost = request.headers.host
    if (rawHost === undefined) { socket.destroy(); return }
    let authority: string
    try {
      authority = canonicalAuthority(rawHost)
    } catch {
      socket.destroy()
      return
    }
    if (!isSignedHere(cookieValue(request, cookieName(authority)), authority, secret)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
      return
    }
    forwardUpgrade(request, socket, head, targetPort, secret, config.days)
  })
  created.on('error', (error) => { door.log(`监听失败：${error.message}`) })
  created.listen(config.doorPort, '0.0.0.0', () => {
    const address = created.address()
    const actual = typeof address === 'object' && address !== null ? address.port : config.doorPort
    const urls = lanAddresses().map(ip => `http://${ip}:${String(actual)}`)
    door.log(urls.length === 0 ? '代理入口已启动，但没有非回环地址' : `代理入口：${urls.join('  ')}`)
  })
  server = created
  return {
    close: () => { server?.close(); server = undefined },
    port: () => {
      const address = server?.address()
      return typeof address === 'object' && address !== null ? address.port : undefined
    },
  }
}

/**
 * 插件入口。
 * @param ctx - 插件上下文。
 * @param config - 宿主传入的配置。
 */
export function apply(ctx: Context, config: Config): void {
  if (!config.door) return
  const door = createDoor(config, {
    webPort: () => ctx.webServer.port,
    log: (message) => { console.log(`[dsh-mobile-door] ${message}`) },
  })
  ctx.effect(() => () => { door.close() }, 'dsh-mobile-door: 代理入口')
}
