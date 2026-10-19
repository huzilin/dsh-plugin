/**
 * dsh-mobile-door 的行为测例：签出的 cookie 必须与 dsh-client-connection 的
 * 校验规则逐项对齐，并且只能提供那一个固定页面。
 *
 * 这里独立实现一遍验收侧（cookie 名、签名、载荷约束），用来验证被测实现，
 * 而不是复用被测代码去验证自己。
 */
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import http from 'node:http'
import { connect as nodeConnect } from 'node:net'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { createDoor, respondToDoor } from '../lib/index.js'

const SECRET = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8')
const DAYS = 400
const DSH_PORT = 51234

/** 写一份最小的 .credentials.yaml，形状与 DSH 自己写出的一致。 */
function writeCredentials(secret, records = ['client-connection/browser-session']) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mobile-door-'))
  const lines = ['records:']
  for (const record of records) {
    lines.push(`  ${record}:`)
    lines.push('    kind: grant')
    lines.push('    payload:')
    lines.push('      version: 1')
    lines.push(`      secret: ${secret.toString('base64url')}`)
  }
  writeFileSync(join(dir, '.credentials.yaml'), `${lines.join('\n')}\n`)
  return dir
}

/** 只承接日志、提供 DSH 端口的运行期依赖替身。 */
function stubDoor(webPort = DSH_PORT) {
  const logs = []
  return { logs, webPort: () => webPort, log: (message) => { logs.push(message) } }
}

/** 起一个进门服务并等它监听完成。 */
async function startDoor(home, overrides = {}, webPort = DSH_PORT) {
  process.env.DSH_HOME = home
  const door = createDoor(
    { door: true, doorPort: 0, path: '/', days: DAYS, targetPort: 0, ...overrides },
    stubDoor(webPort),
  )
  await new Promise((resolve) => { setTimeout(resolve, 50) })
  return door
}

/** 发一个 GET，返回状态码与响应头/正文。 */
async function get(port, path, headers = {}) {
  // 用原始 http 请求，才能自定义与 socket 地址不一致的 Host（web 的 fetch 会覆盖 Host）。
  const requestUrl = `http://127.0.0.1:${String(port)}${path}`
  return await new Promise((resolve, reject) => {
    http.get(requestUrl, { headers }, (response) => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: { get: name => response.headers[name.toLowerCase()] ?? null },
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    }).on('error', reject)
  })
}

/** 直接驱动一次请求处理，返回状态码与正文（用于构造真实服务器拿不到的情形）。 */
async function drive(respond) {
  const request = { method: 'GET', url: '/', headers: { host: '127.0.0.1:8899' } }
  return await new Promise((resolve) => {
    const chunks = []
    const response = {
      status: 0,
      writeHead(status) { this.status = status },
      end(body) { chunks.push(body ?? ''); resolve({ status: this.status, body: chunks.join('') }) },
    }
    respond(request, response)
  })
}

/** 验收侧复算：authority 对应的 cookie 名。 */
function expectedCookieName(authority) {
  return 'dsh-auth-' + createHash('sha256').update(authority).digest('base64url')
}

/** 从页面里取出要写入的 cookie 名值对。 */
function pageCookie(body) {
  const assignment = /document\.cookie = "([^"]+)"/.exec(body)?.[1]
  assert.ok(assignment, '页面里应有 cookie 赋值')
  return assignment.split('; ')[0]
}

describe('dsh-mobile-door', () => {
  let door
  before(async () => { door = await startDoor(writeCredentials(SECRET)) })
  after(() => { door.close() })

  it('根路径返回自动签名的页面，并跳到 DSH 端口', async () => {
    const { status, headers, body } = await get(door.port(), '/')
    assert.equal(status, 200)
    assert.equal(headers.get('content-type'), 'text/html; charset=utf-8')
    assert.equal(headers.get('cache-control'), 'no-store')
    assert.equal(headers.get('referrer-policy'), 'no-referrer')
    assert.match(body, new RegExp(`location\\.replace\\("http://127\\.0\\.0\\.1:${String(DSH_PORT)}/"\\)`))
  })

  it('页面写入的 cookie 与连接插件的校验规则一致', async () => {
    const { body } = await get(door.port(), '/')
    const pair = pageCookie(body)
    const at = pair.indexOf('=')
    const name = pair.slice(0, at)
    const value = pair.slice(at + 1)

    const authority = `127.0.0.1:${String(DSH_PORT)}`
    assert.equal(name, expectedCookieName(authority))

    const [version, encodedBody, encodedSignature] = value.split('.')
    assert.equal(version, 'v1')
    assert.deepEqual(Buffer.from(encodedSignature, 'base64url'), createHmac('sha256', SECRET).update(encodedBody).digest())

    const payload = JSON.parse(Buffer.from(encodedBody, 'base64url').toString('utf8'))
    assert.equal(payload.version, 1)
    assert.equal(payload.authority, authority)
    assert.equal(payload.expiresAt - payload.issuedAt, DAYS * 24 * 60 * 60 * 1000)
    assert.ok(payload.issuedAt <= Date.now() && payload.expiresAt > Date.now())
  })

  it('访问者用什么主机名来，就签给那个主机名的 DSH 端口', async () => {
    const lan = await get(door.port(), '/', { host: '192.168.3.197:8899' })
    assert.equal(pageCookie(lan.body).split('=')[0], expectedCookieName(`192.168.3.197:${String(DSH_PORT)}`))
    assert.match(lan.body, new RegExp(`location\\.replace\\("http://192\\.168\\.3\\.197:${String(DSH_PORT)}/"\\)`))

    const named = await get(door.port(), '/', { host: 's-mac-mini.tail3b3293.ts.net:8899' })
    assert.equal(pageCookie(named.body).split('=')[0], expectedCookieName(`s-mac-mini.tail3b3293.ts.net:${String(DSH_PORT)}`))
  })

  it('已持有该地址的凭据时直接跳转，不重新签发', async () => {
    const first = await get(door.port(), '/', { host: '192.168.3.197:8899' })
    const cookie = pageCookie(first.body)
    const again = await get(door.port(), '/', { host: '192.168.3.197:8899', cookie })
    assert.equal(again.status, 303)
    assert.equal(again.headers.get('location'), `http://192.168.3.197:${String(DSH_PORT)}/`)
  })

  it('别的主机名的凭据不算数，会重新签发', async () => {
    const other = await get(door.port(), '/', { host: '10.0.0.7:8899' })
    const cookie = pageCookie(other.body)
    const here = await get(door.port(), '/', { host: '192.168.3.197:8899', cookie })
    assert.equal(here.status, 200)
    assert.match(here.body, /document\.cookie = /)
  })

  it('伪造或被篡改的凭据不会被当成已登录', async () => {
    const first = await get(door.port(), '/')
    const [name, value] = pageCookie(first.body).split('=')
    const [version, body, signature] = value.split('.')
    const tampered = `${name}=${version}.${body}.${signature.slice(0, -2)}AA`
    assert.equal((await get(door.port(), '/', { cookie: tampered })).status, 200)
    assert.equal((await get(door.port(), '/', { cookie: `${name}=garbage` })).status, 200)
  })

  it('任何路径都只给这一页，非 GET 一律拒绝', async () => {
    assert.equal((await get(door.port(), '/anything')).status, 200)
    const post = await fetch(`http://127.0.0.1:${String(door.port())}/`, { method: 'POST' })
    assert.equal(post.status, 405)
  })

  it('Host 是空串时拒绝', async () => {
    // Node 客户端不会发出空 Host，这里直接用裸 socket 写一行请求。
    const status = await new Promise((resolve, reject) => {
      const socket = nodeConnect(door.port(), '127.0.0.1', () => {
        socket.write('GET / HTTP/1.1\r\nHost: \r\nConnection: close\r\n\r\n')
      })
      let text = ''
      socket.on('data', (chunk) => { text += chunk.toString('utf8') })
      socket.on('end', () => { resolve(Number(text.split(' ')[1])) })
      socket.on('error', reject)
    })
    assert.equal(status, 400)
  })

  it('DSH 端口未知时明确报错，不签错地址', async () => {
    // 直接驱动请求处理：真实服务器在监听回调里才拿得到端口，无法构造这个情形。
    process.env.DSH_HOME = writeCredentials(SECRET)
    const config = { door: true, doorPort: 0, path: '/', days: DAYS, targetPort: 0 }
    const secret = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8')
    const response = await drive((request, response) => {
      respondToDoor(request, response, config, { ...stubDoor(undefined), webPort: () => undefined }, secret)
    })
    assert.equal(response.status, 503)
    assert.match(response.body, /找不到 DSH 的端口/u)
  })

  it('配置指定端口时优先用它', async () => {
    const pinned = await startDoor(writeCredentials(SECRET), { targetPort: 6000 })
    const { body } = await get(pinned.port(), '/')
    assert.match(body, /location\.replace\("http:\/\/127\.0\.0\.1:6000\/"\)/)
    pinned.close()
  })
})

describe('dsh-mobile-door 签名密钥来源', () => {
  it('凭据文件里没有该条目时启动失败', async () => {
    process.env.DSH_HOME = writeCredentials(SECRET, ['other/record'])
    assert.throws(
      () => createDoor({ door: true, doorPort: 0, path: '/', days: DAYS, targetPort: 0 }, stubDoor()),
      /没有 client-connection\/browser-session 条目/u,
    )
  })

  it('凭据文件不存在时启动失败', async () => {
    process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-mobile-door-empty-'))
    assert.throws(
      () => createDoor({ door: true, doorPort: 0, path: '/', days: DAYS, targetPort: 0 }, stubDoor()),
      /读不到凭据文件/u,
    )
  })

  it('密钥不是 32 字节时报错', async () => {
    process.env.DSH_HOME = writeCredentials(Buffer.from('short', 'utf8'))
    assert.throws(
      () => createDoor({ door: true, doorPort: 0, path: '/', days: DAYS, targetPort: 0 }, stubDoor()),
      /不是 32 字节/u,
    )
  })
})
