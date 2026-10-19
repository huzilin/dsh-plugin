# dsh-mobile-door

手机 / iPad 进门页。在局域网打开一个一次性页面，页面自动替浏览器写入 DSH 的长期
登录凭据并跳转到 GUI——不需要手抄终端里那条带 token 的登录链接，也不需要在手机
上装 cookie。

## 为什么需要它

DSH Web 的进门流程是「带 token 的链接 → 换取长期通行证（cookie）」：`dsh web`
启动时把带 token 的地址打进终端，浏览器访问它之后就拿到有效期 400 天的 cookie。

- Desktop 形态下终端不可见，这条链接看不到；
- 手机浏览器里手工写 cookie 基本没法操作。

本插件把这个「换通行证」的动作搬到手机能打开的一个普通网页上。

## 怎么工作

DSH 的 cookie 按**主机名**生效、不区分端口。所以只要有一个和 GUI **同一主机**、
不同端口的页面，就能替 GUI 的端口写好 cookie。

```
手机 → http://192.168.x.x:8899        （本插件的进门页）
       页面 JS 写入 dsh-auth-<hash>=v1.… cookie（绑定 192.168.x.x:19387）
       自动跳转 → http://192.168.x.x:19387/   （DSH GUI，已登录）
```

签名与连接插件（`dsh-client-connection` 的 browser-auth）逐项对齐，否则签出的
cookie 只会得到 401：

| 项 | 规则 |
| --- | --- |
| 签名密钥 | 凭据记录 `client-connection/browser-session` 的 `payload.secret`（32 字节 base64url） |
| cookie 名 | `dsh-auth-` + base64url(sha256(authority))，authority = `主机:端口`（按验收侧规则归一：小写、去零填充端口） |
| cookie 值 | `v1.<base64url(JSON 载荷)>.<base64url(HMAC-SHA256 签名)>` |
| 载荷 | `{ version: 1, authority, issuedAt, expiresAt }`，有效期上限 = 连接插件的 `cookieMaxAgeDays` |

密钥优先从凭据服务读（与连接插件同一份记录 `client-connection/browser-session`）；
凭据服务不可用时退回读 `$DSH_HOME/.credentials.yaml`。两条路都失败就不监听端口，
只在日志里报错——绝不用错误密钥签发一张永远 401 的 cookie。

插件对宿主包零运行时依赖：记录键与 `credentialKey()` 产出的字符串相同，写成字面量
而不是运行时 `import`，这样在没装该包的宿主里也能正常取到密钥。

已经持有有效通行证的设备再次打开进门页时直接跳转，不重新签发。

## 安全边界

- 只提供 `GET <path>` 这一个固定页面，不解析请求里的任何输入，没有任何写配置、
  执行命令或转发请求的能力；其余方法与路径一律 404。
- 页面自身不含任何凭据以外的东西；cookie 绑定的是「访问进门页时用的主机名」，
  所以换一个主机名访问 GUI 仍然需要正常登录。
- 默认关门（`door: false`）。打开后只在配置的端口上、对局域网可达；用完可在
  配置里改回 `door: false`。

## 配置

宿主 `cordis.patch.yml`（或 profile 的用户层补丁）里同 id 覆盖 `config`：

```yaml
- id: dsh-mobile-door
  config:
    door: true          # 打开进门页
    doorPort: 8899      # 进门服务端口；0 = 系统分配
    path: /             # 页面路径；整个端口只有这一页
    days: 400           # 通行证有效期，不得超过连接插件的 cookieMaxAgeDays
    targetPort: 0       # 0 = 用 DSH Web 实际端口
```

`targetPort` 一般留 0：插件用自己的 `webServer.port` 作为目标端口的默认值。

## 构建

`lib/` 与源码一起提交（与仓库里其他插件一致），安装时不跑构建脚本：

```sh
node /path/to/deepseek-harness/node_modules/typescript/bin/tsc -p tsconfig.json
node --test tests/*.test.mjs
```

## 安装

```sh
dsh plugin --profile desktop add 'github:huzilin/dsh-plugin#path:/packages/dsh-mobile-door'
```

改完冷启动一次（重启 DSH 进程）。启动日志里会打印可用的局域网地址：

```
[dsh-mobile-door] 进门服务已启动：http://192.168.x.x:8899
```

## 与「公网访问」的关系

进门页只解决「设备怎么拿到通行证」，解决不了「公网怎么连到这台机器」：

- 局域网 / 手机同一 Wi-Fi：进门页地址直接用。
- 外网：先让 DSH 的端口对外可达（如 Tailscale 的机器 IP），再用
  `http://<tailscale-ip>:8899` 打开；cookie 绑定的是你访问时用的主机名，
  所以进门前后的地址主机名必须一致。

## 已知限制

- 进门页本身不做任何认证（它就是用来发通行证的），因此**只应在可信网络里打开**，
  用完改回 `door: false`。
- 若连接插件把 `cookieMaxAgeDays` 调小于本插件的 `days`，签出的 cookie 会被
  验收侧拒绝（有效期差超过上限）；两处要保持一致。
- **宿主只监听回环时，进门页无法替它对外服务**。凭据只是「入场券」，真正连上 GUI
  还要 DSH 自己的端口在网络上可达；桌面端为满足外壳的固定回环 URL 而绑
  `127.0.0.1`，手机经局域网 IP 连它会直接被拒（连接层就断了，与凭据无关）。
  这种情况下的做法是：桌面端照常人机交互，手机走 `dsh web` 起的对外实例。
- 页面跳转用的绝对地址由「访问进门页时的主机名 + `targetPort`」拼成。若浏览器把
  `192.168.3.197` 这类输入补成 `www.192.168.3.197` 再去访问，页面会照样返回
  （服务端不挑主机名），但写入的凭据与跳转目标都指向那个被补出来的主机名；
  排查时先看 `http://127.0.0.1:<doorPort>/status` 给出的地址，并直接输入完整
  `http://` 开头的地址。
