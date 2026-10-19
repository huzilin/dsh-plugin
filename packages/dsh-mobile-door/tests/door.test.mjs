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
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { createDoor } from '../lib/index.js'

const SECRET = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8')
const DAYS = 400
const TARGET_PORT = 51234

/** 写一份最小的 .credentials.yaml，形状与 DSH 自己写出的一致。 */
function writeCredentials(secret, records = ['client-connection/browser-session']) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mobile-door-'))
  const lines = ['records:']
  for (const record of records) {
    lines.push(`  ${record}:`)
    lines.push('    kind: grant')
    lines.push('    payload:')
    lines.push('      version: 1')
    lines.push(`      secret: ${secret.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')}`)
  }
  writeFileSync(join(dir, '.credentials.yaml'), `${lines.join('\n')}\n`)
  return dir
}

/** 只看日志、不提供凭据服务的上下文替身。 */
function stubContext() {
  return {
    get: () => undefined,
    logger: { info: () => {}, warn: () => {} },
  }
}

/** 起一个只挂进门逻辑的服务器。 */
async function startDoor(home) {
  process.env.DSH_HOME = home
  const door = createDoor({ door: true, doorPort: 0, path: '/', days: DAYS, targetPort: TARGET_PORT }, stubContext())
  await door.listen()
  return door
}

/** 发一个 GET，返回状态码与响应头/正文。 */
async function get(port, path, headers = {}) {
  // 用原始 http 请求，才能自定义与 socket 地址不一致的 Host（web 的 fetch 会覆盖 Host）。
  const requestUrl = `http://127.0.0.1:${String(port)}${path}`
  const { status, headers: responseHeaders, body } = await new Promise((resolve, reject) => {
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
  return { status, headers: responseHeaders, body }
}

/** 验收侧复算：authority 对应的 cookie 名。 */
function expectedCookieName(authority) {
  return 'dsh-auth-' + createHash('sha256').update(authority).digest('base64')
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

describe('dsh-mobile-door', () => {
  let door
  before(async () => { door = await startDoor(writeCredentials(SECRET)) })
  after(() => { door.close() })

  it('GET /door 返回自动进门的页面，并给出目标地址', async () => {
    const { status, headers, body } = await get(door.port(), '/')
    assert.equal(status, 200)
    assert.equal(headers.get('content-type'), 'text/html; charset=utf-8')
    assert.equal(headers.get('cache-control'), 'no-store')
    assert.match(body, new RegExp(`location\\.replace\\("http://127\\.0\\.0\\.1:${String(TARGET_PORT)}/"\\)`))
    assert.match(body, /document\.cookie = /)
  })

  it('页面写入的 cookie 与连接插件的校验规则一致', async () => {
    const { body } = await get(door.port(), '/')
    const assignment = /document\.cookie = "([^"]+)"/.exec(body)?.[1]
    assert.ok(assignment, '页面里应有 cookie 赋值')
    const [pair] = assignment.split('; ')
    const at = pair.indexOf('=')
    const name = pair.slice(0, at)
    const value = pair.slice(at + 1)

    const authority = `127.0.0.1:${String(TARGET_PORT)}`
    assert.equal(name, expectedCookieName(authority))

    const [version, encodedBody, encodedSignature] = value.split('.')
    assert.equal(version, 'v1')
    const signature = Buffer.from(encodedSignature, 'base64url')
    assert.deepEqual(signature, createHmac('sha256', SECRET).update(encodedBody).digest())

    const payload = JSON.parse(Buffer.from(encodedBody, 'base64url').toString('utf8'))
    assert.equal(payload.version, 1)
    assert.equal(payload.authority, authority)
    assert.equal(payload.expiresAt - payload.issuedAt, DAYS * 24 * 60 * 60 * 1000)
    assert.ok(payload.issuedAt <= Date.now() && payload.expiresAt > Date.now())
  })

  it('authority 按验收侧规则归一（小写、去零填充端口）', async () => {
    const upper = await get(door.port(), '/', { host: 'LOCALHOST:8899' })
    assert.match(upper.body, /location\.replace\("http:\/\/localhost:51234\/"\)/)
    const padded = await get(door.port(), '/', { host: '127.0.0.1:008899' })
    assert.match(padded.body, /http:\/\/127\.0\.0\.1:51234\//)
    const body = /document\.cookie = "([^"]+)"/.exec(upper.body)[1]
    assert.equal(body.split('=')[0], expectedCookieName('localhost:51234'))
  })

  it('已持有有效通行证时直接跳转，不重新签发', async () => {
    const first = await get(door.port(), '/')
    const assignment = /document\.cookie = "([^"]+)"/.exec(first.body)[1]
    const cookie = assignment.split('; ')[0]
    const again = await get(door.port(), '/', { cookie })
    assert.equal(again.status, 303)
    assert.equal(again.headers.get('location'), `http://127.0.0.1:${String(TARGET_PORT)}/`)
  })

  it('伪造或被篡改的通行证不会放行', async () => {
    const first = await get(door.port(), '/')
    const cookie = /document\.cookie = "([^"]+)"/.exec(first.body)[1].split('; ')[0]
    const [name, value] = cookie.split('=')
    const [version, body, signature] = value.split('.')
    const tampered = `${name}=${version}.${body}.${signature.slice(0, -2)}AA`
    assert.equal((await get(door.port(), '/', { cookie: tampered })).status, 200)
    assert.equal((await get(door.port(), '/', { cookie: `${name}=garbage` })).status, 200)
  })

  it('本机访问 /status 返回自检信息，外部访问不返回', async () => {
    const local = await get(door.port(), '/status', { host: '127.0.0.1' })
    assert.equal(local.status, 200)
    const status = JSON.parse(local.body)
    assert.equal(status.target, `127.0.0.1:${String(TARGET_PORT)}`)
    assert.equal(status.days, DAYS)
    assert.ok(Array.isArray(status.lanAddresses))
    const remote = await get(door.port(), '/status', { host: '192.168.1.9' })
    assert.equal(remote.status, 404)
  })

  it('只提供这一个固定页面', async () => {
    assert.equal((await get(door.port(), '/elsewhere')).status, 404)
    assert.equal((await get(door.port(), '/page')).status, 404)
    const post = await fetch(`http://127.0.0.1:${String(door.port())}/`, { method: 'POST' })
    assert.equal(post.status, 404)
  })
})

describe('dsh-mobile-door 签名密钥来源', () => {
  it('没有凭据记录、也读不到凭据文件时不监听端口', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-mobile-door-empty-'))
    process.env.DSH_HOME = home
    const warnings = []
    const ctx = { get: () => undefined, logger: { info: () => {}, warn: (error) => { warnings.push(String(error)) } } }
    const door = createDoor({ door: true, doorPort: 0, path: '/', days: DAYS, targetPort: TARGET_PORT }, ctx)
    await assert.rejects(door.listen(), /读不到凭据文件|凭据文件/)
    assert.equal(door.port(), undefined)
    door.close()
  })

  it('凭据文件里的密钥对不上 32 字节时报错', async () => {
    const home = writeCredentials(Buffer.from('short', 'utf8'))
    process.env.DSH_HOME = home
    const door = createDoor(
      { door: true, doorPort: 0, path: '/', days: DAYS, targetPort: TARGET_PORT },
      { get: () => undefined, logger: { info: () => {}, warn: () => {} } },
    )
    await assert.rejects(door.listen(), /secret 不是 32 字节/)
    door.close()
  })

  it('优先使用凭据服务里的记录，而不是凭据文件', async () => {
    const fileSecret = Buffer.from('ffffffffffffffffffffffffffffffff', 'utf8')
    const serviceSecret = Buffer.from('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'utf8')
    process.env.DSH_HOME = writeCredentials(fileSecret)
    const payload = { version: 1, secret: serviceSecret.toString('base64url') }
    const ctx = {
      get: (name) => (name === 'credentials'
        ? { readRecord: async () => ({ kind: 'grant', payload }) }
        : undefined),
      logger: { info: () => {}, warn: () => {} },
    }
    const door = createDoor(
      { door: true, doorPort: 0, path: '/', days: DAYS, targetPort: TARGET_PORT },
      ctx,
    )
    await door.listen()
    const body = (await get(door.port(), '/')).body
    const value = /document\.cookie = "[^=]+=([^;]+);/.exec(body)[1]
    const [, encodedBody, encodedSignature] = value.split('.')
    assert.deepEqual(
      Buffer.from(encodedSignature, 'base64url'),
      createHmac('sha256', serviceSecret).update(encodedBody).digest(),
    )
    door.close()
  })

  it('凭据服务记录形状不符时退回凭据文件并留下警告', async () => {
    process.env.DSH_HOME = writeCredentials(SECRET)
    const warnings = []
    const ctx = {
      get: (name) => (name === 'credentials'
        ? { readRecord: async () => ({ kind: 'grant', payload: { version: 9 } }) }
        : undefined),
      logger: { info: () => {}, warn: (error) => { warnings.push(String(error)) } },
    }
    const door = createDoor(
      { door: true, doorPort: 0, path: '/', days: DAYS, targetPort: TARGET_PORT },
      ctx,
    )
    await door.listen()
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /凭据服务读取失败/)
    door.close()
  })
})
