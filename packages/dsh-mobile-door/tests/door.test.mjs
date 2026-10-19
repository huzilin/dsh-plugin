/**
 * dsh-mobile-door 的行为测例。
 *
 * 被测对象是「认证 + 反向代理」：没有有效凭据给页面，有就把请求转发给回环上的
 * DSH。这里用一个真实的回环上游来观察转发出去的样子，而不是断言实现细节。
 */
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import http from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import {
  canonicalAuthority, cookieName, createDoor, doorPage, isSignedHere, mintCookie, readSigningSecret,
} from '../lib/index.js'

const SECRET = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8')
const DAYS = 400

/** 写一份最小的 .credentials.yaml，形状与 DSH 自己写出的一致。 */
function writeCredentials(home, secret, records = ['client-connection/browser-session']) {
  const lines = ['records:']
  for (const record of records) {
    lines.push(`  ${record}:`, '    kind: grant', '    payload:', '      version: 1',
      `      secret: ${secret.toString('base64url')}`)
  }
  writeFileSync(join(home, '.credentials.yaml'), `${lines.join('\n')}\n`)
  return home
}

/** 起一个假 DSH，记录每次收到的请求。 */
async function startUpstream() {
  const seen = []
  const server = http.createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, headers: request.headers })
    response.writeHead(200, { 'content-type': 'text/plain', 'x-upstream': 'yes' })
    response.end('from dsh')
  })
  await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  return {
    port: typeof address === 'object' && address !== null ? address.port : 0,
    seen,
    close: () => { server.close() },
  }
}

/** 发一个请求到代理入口。 */
async function call(port, path = '/', options = {}) {
  return await new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: options.method ?? 'GET',
      headers: {
        host: options.host ?? `127.0.0.1:${String(port)}`,
        ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
        ...options.headers,
      },
    }, (response) => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: { get: name => response.headers[name.toLowerCase()] ?? null },
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    request.on('error', reject)
    request.end()
  })
}

/** 从页面里取出要写入的 cookie 名值对。 */
function pageCookie(body) {
  const assignment = /document\.cookie = "([^"]+)"/u.exec(body)?.[1]
  assert.ok(assignment, '页面里应有 cookie 赋值')
  return assignment.split('; ')[0]
}

describe('凭据签发与 DSH 的规则一致', () => {
  it('cookie 名是 authority 的 sha256', () => {
    const authority = '192.168.3.197:8899'
    assert.equal(cookieName(authority),
      'dsh-auth-' + createHash('sha256').update(authority).digest('base64url'))
  })

  it('签名、载荷与有效期都对得上', () => {
    const authority = '192.168.3.197:8899'
    const { name, value } = mintCookie(authority, SECRET, DAYS)
    const [version, body, signature] = value.split('.')
    assert.equal(name, cookieName(authority))
    assert.equal(version, 'v1')
    assert.deepEqual(Buffer.from(signature, 'base64url'),
      createHmac('sha256', SECRET).update(body).digest())
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    assert.equal(payload.authority, authority)
    assert.equal(payload.expiresAt - payload.issuedAt, DAYS * 24 * 60 * 60 * 1000)
  })

  it('换了 authority、密钥或改过签名都不认', () => {
    const { value } = mintCookie('a:1', SECRET, DAYS)
    assert.equal(isSignedHere(value, 'a:1', SECRET), true)
    assert.equal(isSignedHere(value, 'b:1', SECRET), false)
    assert.equal(isSignedHere(value, 'a:1', Buffer.alloc(32, 9)), false)
    assert.equal(isSignedHere(`${value}x`, 'a:1', SECRET), false)
    assert.equal(isSignedHere(undefined, 'a:1', SECRET), false)
    assert.equal(isSignedHere('garbage', 'a:1', SECRET), false)
  })

  it('过期的凭据不认', () => {
    const signed = mintCookie('a:1', SECRET, 0)
    assert.equal(isSignedHere(signed.value, 'a:1', SECRET), false)
  })

  it('authority 归一化与 DSH 一致', () => {
    assert.equal(canonicalAuthority('Example.COM:0080'), 'example.com:80')
    assert.equal(canonicalAuthority('[::1]:8899'), '[::1]:8899')
    assert.throws(() => { canonicalAuthority('no-port') }, /不是合法的 authority/u)
  })
})

describe('签名密钥只从凭据文件取', () => {
  it('正常读取', () => {
    process.env.DSH_HOME = writeCredentials(mkdtempSync(join(tmpdir(), 'door-')), SECRET)
    assert.deepEqual(readSigningSecret(), SECRET)
  })

  it('条目缺失时报错', () => {
    process.env.DSH_HOME = writeCredentials(mkdtempSync(join(tmpdir(), 'door-')), SECRET, ['other/record'])
    assert.throws(() => readSigningSecret(), /没有 client-connection\/browser-session 条目/u)
  })

  it('文件不存在时报错', () => {
    process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'door-empty-'))
    assert.throws(() => readSigningSecret(), /读不到凭据文件/u)
  })

  it('密钥长度不对时报错', () => {
    process.env.DSH_HOME = writeCredentials(mkdtempSync(join(tmpdir(), 'door-')), Buffer.from('short'))
    assert.throws(() => readSigningSecret(), /不是 32 字节/u)
  })
})

describe('代理入口', () => {
  let upstream
  let door
  let cookie

  before(async () => {
    upstream = await startUpstream()
    process.env.DSH_HOME = writeCredentials(mkdtempSync(join(tmpdir(), 'door-')), SECRET)
    door = createDoor(
      { door: true, doorPort: 0, days: DAYS, targetPort: upstream.port },
      { webPort: () => upstream.port, log: () => {} },
    )
    await new Promise(resolve => setTimeout(resolve, 60))
  })
  after(() => { door.close(); upstream.close() })

  it('没有凭据时给页面，并把凭据写给当前主机', async () => {
    const port = door.port() ?? 0
    const { status, headers, body } = await call(port, '/', { host: `192.168.3.197:${String(port)}` })
    assert.equal(status, 200)
    assert.equal(headers.get('content-type'), 'text/html; charset=utf-8')
    assert.equal(headers.get('cache-control'), 'no-store')
    assert.equal(pageCookie(body).split('=')[0], cookieName(`192.168.3.197:${String(port)}`))
    assert.match(body, new RegExp(`location\\.replace\\("http://192\\.168\\.3\\.197:${String(port)}/"\\)`))
    assert.equal(upstream.seen.length, 0, '没有凭据的请求不应该打到 DSH')
  })

  it('带上凭据后转发，并把 Host / Origin / Referer 改写成回环', async () => {
    const port = door.port() ?? 0
    const host = `192.168.3.197:${String(port)}`
    const page = await call(port, '/', { host })
    cookie = pageCookie(page.body)
    const forwarded = await call(port, '/api/thing?x=1', {
      host,
      cookie: `${cookie}; other=1`,
      headers: { origin: `http://${host}`, referer: `http://${host}/somewhere` },
    })
    assert.equal(forwarded.status, 200)
    assert.equal(forwarded.body, 'from dsh')
    assert.equal(forwarded.headers.get('x-upstream'), 'yes')

    const seen = upstream.seen.at(-1)
    assert.ok(seen)
    assert.equal(seen.url, '/api/thing?x=1')
    assert.equal(seen.headers.host, `127.0.0.1:${String(upstream.port)}`)
    assert.equal(seen.headers.origin, `http://127.0.0.1:${String(upstream.port)}`)
    assert.equal(seen.headers.referer, `http://127.0.0.1:${String(upstream.port)}/api/thing?x=1`)
    // 浏览器带来的插件凭据要摘掉，换成回环 authority 的凭据 DSH 才认。
    const relayed = seen.headers.cookie.split('; ').find(part => part.startsWith('dsh-auth-'))
    assert.ok(relayed, '要带上回环凭据')
    assert.equal(relayed.split('=')[0], cookieName(`127.0.0.1:${String(upstream.port)}`))
    assert.match(seen.headers.cookie, /other=1/, '其余 cookie 照常转发')
  })

  it('POST 也会转发', async () => {
    const port = door.port() ?? 0
    const host = `192.168.3.197:${String(port)}`
    const result = await call(port, '/api/submit', { method: 'POST', host, cookie })
    assert.equal(result.status, 200)
    assert.equal(upstream.seen.at(-1)?.method, 'POST')
  })

  it('凭据不对就不转发', async () => {
    const port = door.port() ?? 0
    const host = `192.168.3.197:${String(port)}`
    const before = upstream.seen.length
    const result = await call(port, '/api/thing', { method: 'POST', host, cookie: `${cookieName(host)}=v1.bad.bad` })
    assert.equal(result.status, 403)
    assert.equal(upstream.seen.length, before)
  })

  it('别的主机的凭据不算数', async () => {
    const port = door.port() ?? 0
    const { status, body } = await call(port, '/', { host: `10.0.0.7:${String(port)}`, cookie })
    assert.equal(status, 200)
    assert.match(body, /document\.cookie = /u)
  })

  it('HEAD 请求没有凭据也回页面', async () => {
    const result = await call(door.port() ?? 0, '/', { method: 'HEAD' })
    assert.equal(result.status, 200)
  })

  it('找不到 DSH 端口时明确报错，不转发', async () => {
    const orphan = createDoor(
      { door: true, doorPort: 0, days: DAYS, targetPort: 0 },
      { webPort: () => undefined, log: () => {} },
    )
    await new Promise(resolve => setTimeout(resolve, 60))
    const result = await call(orphan.port() ?? 0, '/')
    assert.equal(result.status, 503)
    orphan.close()
  })

  it('Host 不合法时拒绝', async () => {
    const port = door.port() ?? 0
    assert.equal((await call(port, '/', { host: 'no-port' })).status, 400)
    assert.equal((await call(port, '/', { host: 'a:0' })).status, 400)
    assert.equal((await call(port, '/', { host: 'a:99999' })).status, 400)
  })
})

describe('WebSocket 升级', () => {
  let upstream
  let door
  let cookie

  before(async () => {
    // 上游只接受带正确回环凭据的升级，并回一段数据。
    upstream = http.createServer((_request, response) => { response.writeHead(200); response.end('plain') })
    upstream.on('upgrade', (request, socket) => {
      const relayed = (request.headers.cookie ?? '').split('; ')
        .find(part => part.startsWith('dsh-auth-'))
      const authority = `127.0.0.1:${String(upstream.address().port)}`
      const ok = relayed !== undefined
        && relayed.split('=')[0] === cookieName(authority)
        && request.headers.host === authority
        && request.headers.origin === `http://${authority}`
      if (!ok) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return }
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n`)
      setTimeout(() => { socket.write('hello-from-dsh') }, 50)
    })
    await new Promise(resolve => { upstream.listen(0, '127.0.0.1', resolve) })
    process.env.DSH_HOME = writeCredentials(mkdtempSync(join(tmpdir(), 'door-ws-')), SECRET)
    door = createDoor(
      { door: true, doorPort: 0, days: DAYS, targetPort: upstream.address().port },
      { webPort: () => upstream.address().port, log: () => {} },
    )
    await new Promise(resolve => setTimeout(resolve, 60))
    const page = await call(upstream.address().port === 0 ? 0 : door.port(), '/', {
      host: `192.168.3.197:${String(door.port())}`,
    })
    cookie = pageCookie(page.body)
  })
  after(() => { door.close(); upstream.close() })

  it('带凭据时升级成功并双向通', async () => {
    const port = door.port()
    const result = await new Promise((resolve, reject) => {
      const request = http.request({
        host: '127.0.0.1', port, path: '/api/remote.mux',
        headers: {
          host: `192.168.3.197:${String(port)}`,
          cookie,
          origin: `http://192.168.3.197:${String(port)}`,
          connection: 'Upgrade', upgrade: 'websocket',
          'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        },
      })
      request.on('upgrade', (response, socket) => {
        const chunks = []
        socket.on('data', chunk => chunks.push(chunk))
        setTimeout(() => { socket.destroy(); resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }) }, 500)
      })
      request.on('response', response => {
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
      })
      request.on('error', reject)
      request.end()
    })
    assert.equal(result.status, 101, JSON.stringify(result))
    assert.equal(result.body, 'hello-from-dsh')
  })

  it('没有凭据时拒绝升级', async () => {
    const port = door.port()
    const status = await new Promise((resolve, reject) => {
      const request = http.request({
        host: '127.0.0.1', port, path: '/api/remote.mux',
        headers: {
          host: `192.168.3.197:${String(port)}`,
          connection: 'Upgrade', upgrade: 'websocket',
          'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        },
      })
      request.on('upgrade', response => resolve(response.statusCode))
      request.on('response', response => resolve(response.statusCode))
      request.on('error', reject)
      request.end()
    })
    assert.equal(status, 401)
  })
})

describe('页面模板', () => {
  it('把目标与凭据都按字面写进页面', () => {
    const html = doorPage('h:1', { name: 'n', value: 'v' }, 1)
    assert.match(html, /document\.cookie = "n=v; path=\/; max-age=86400/u)
    assert.match(html, /location\.replace\("http:\/\/h:1\/"\)/u)
  })
})
