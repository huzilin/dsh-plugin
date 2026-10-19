# dsh-mobile-door

手机 / iPad 进 DSH Web 的签名认证页。在局域网打开一个普通网页，页面自动替浏览器
写入 DSH 的长期登录凭据，然后跳转到 DSH 本身——不需要手抄终端里那条带 token 的
登录链接，也不需要在手机上装 cookie。此后一段时间该设备直接访问 DSH 即可。

## 为什么需要它

DSH Web 的进门流程是「带 token 的链接 → 换取长期凭据（cookie）」：`dsh web` 启动时
把带 token 的地址打印在终端里，浏览器访问一次之后才能正常使用。

- 桌面端形态下看不到终端，这条链接拿不到；
- 手机浏览器里无法手工写入 cookie。

本插件把「换凭据」这一步搬到一个手机能打开的普通网页上。

## 怎么工作

浏览器的 cookie 按**主机名**保存、不区分端口。所以只要有一个与 DSH 同主机、不同
端口的页面，就能替 DSH 的端口写好凭据：

```
手机 → http://192.168.x.x:8899        （本插件的认证页）
        页面写入 dsh-auth-<hash>=v1.…  （绑定 192.168.x.x:<DSH端口>）
        自动跳转 → http://192.168.x.x:<DSH端口>   （DSH 界面，已登录）
```

之后的访问直接走 DSH 端口，不再经过本插件。

凭据格式必须与 DSH 连接插件（`dsh-client-connection` 的 browser-auth）逐项一致，
否则签出来的是永远 401 的一张纸：

| 项 | 规则 |
| --- | --- |
| 签名密钥 | `$DSH_HOME/.credentials.yaml` 里 `client-connection/browser-session` 的 `secret`（32 字节 base64url） |
| cookie 名 | `dsh-auth-` + base64url(sha256(authority))，authority = `主机:DSH端口` |
| cookie 值 | `v1.<base64url(JSON 载荷)>.<base64url(HMAC-SHA256 签名)>` |
| 载荷 | `{ version: 1, authority, issuedAt, expiresAt }` |

其中 authority 用的是**访问者自己的主机名**：手机从 `192.168.3.197` 进来，就签给
`192.168.3.197:<DSH端口>`；从 Tailscale 机器名进来，就签给那个机器名。

凭据文件缺失或形状不符时插件不监听端口并报错，绝不用错误密钥签发一张永远 401 的
凭据。设备已持有该地址的有效凭据时直接跳转，不重复签发。

## 前提：DSH 自己要能被手机连上

本插件只解决「凭据从哪来」，不解决「手机能不能连到这台机器」。DSH 默认只监听
本机回环地址，此时手机连它的端口是不通的，进门页也会跳到一个打不开的地址。

要真正可用，DSH 必须监听一个手机可达的具体地址（例如局域网 IP 或 Tailscale IP）：

```yaml
# profile 的 cordis.patch.yml
- id: webserver
  config:
    host: '192.168.3.197'   # 换成这台机器实际的局域网 / Tailscale 地址
    port: !!js ctx.webStartup.port ?? 3080
    ...（其余字段必须一并重述：补丁是替换整个 config，不是合并）
```

注意 DSH 不接受通配符地址（`0.0.0.0`），必须写具体地址；且监听某个具体地址后，
**回环地址不再可达**，只经由 `127.0.0.1` 连接 DSH 的客户端（例如桌面外壳）会连不上。

## 配置

在 profile 的 `cordis.patch.yml` 里同 id 覆盖 `config`：

```yaml
- id: dsh-mobile-door
  config:
    door: true          # 打开认证页
    doorPort: 8899      # 认证页端口；0 = 系统分配
    days: 400           # 凭据有效期，不得超过连接插件的 cookieMaxAgeDays
    targetPort: 0       # 0 = 用 DSH Web 实际监听的端口
```

`targetPort` 一般留 0，插件会自己读取 DSH 的端口。

## 安装

```sh
dsh plugin --profile <名称> add 'github:huzilin/dsh-plugin#path:/packages/dsh-mobile-door'
```

安装后冷启动一次 DSH。启动日志会打印可用地址：

```
[dsh-mobile-door] 认证页：http://192.168.3.197:8899  http://100.103.217.67:8899
```

## 安全边界

- 只提供这一个固定页面，任何路径都返回同一页，非 GET 请求直接拒绝；不转发请求、
  不读写配置、不解析任何输入。
- 页面不含凭据以外的东西；凭据绑定访问时用的主机名，换一个主机名访问 DSH 仍需
  正常登录。
- **认证页本身不做认证**（它就是用来发凭据的），所以只在可信网络里打开；不用时
  在配置里改回 `door: false`。

## 已知限制

- 若连接插件把 `cookieMaxAgeDays` 调得比本插件的 `days` 小，签出的凭据会被拒；
  两处要保持一致（默认都是 30，本插件建议显式配成同一个值）。
- 凭据按主机名绑定：换了 Wi-Fi 导致 IP 变化后，用新地址重进一次即可。
