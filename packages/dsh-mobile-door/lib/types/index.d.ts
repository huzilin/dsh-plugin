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
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-mobile-door";
/** 依赖：Web 服务器必选；凭据服务可选（缺失时退回凭据文件）。 */
export declare const inject: {
    required: string[];
    optional: string[];
};
/** 插件配置：由宿主 `cordis.yml` / `cordis.patch.yml` 的 `config` 提供。 */
export interface Config {
    /** 是否开启进门服务；关闭时不监听任何端口。 */
    door: boolean;
    /** 进门服务监听的端口；0 表示由系统分配。 */
    doorPort: number;
    /** 页面路径（进门服务上的固定路径）。 */
    path: string;
    /** 签出的通行证有效期（天），必须不大于连接插件的 `cookieMaxAgeDays`。 */
    days: number;
    /** 目标 GUI 所在 authority 的端口；授权给 entry 时自动补为 Web 服务器端口。 */
    targetPort: number;
}
/**
 * 处理进门请求：GET `config.path` 回页面，其余一律 404。
 * @param request - 进来的 HTTP 请求。
 * @param response - 响应所有者。
 * @param config - 已解析的配置。
 * @param secret - 签名密钥。
 */
export declare function handleDoor(request: IncomingMessage, response: ServerResponse, config: Config, secret: Buffer): void;
/** 进门服务实例：监听（含异步取密钥失败）的完整生命周期。 */
export interface DoorServer {
    /**
     * 开始监听；签名密钥异步取到之前不占用端口。
     * @returns 异步取密钥并开始监听，失败时 reject 同样的错误。
     */
    listen(): Promise<void>;
    /** 关闭监听（幂等）。 */
    close(): void;
    /** 实际监听端口；未开始监听时为 undefined。 */
    port(): number | undefined;
}
/**
 * 创建进门服务（尚未监听）。
 * @param config - 已解析的配置。
 * @param ctx - 插件上下文（取签名密钥与日志用）。
 * @returns 服务实例。
 */
export declare function createDoor(config: Config, ctx: Context): DoorServer;
/**
 * 插件入口：按配置起进门服务；默认关门。
 *
 * 组件卸载时关闭服务，避免端口被遗留进程占住。
 * @param ctx - 插件上下文。
 * @param config - 宿主传入的配置。
 */
export declare function apply(ctx: Context, config: Config): void;
