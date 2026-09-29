/**
 * 票面文件路径的两个纯函数：①按会话地址化（点击打开用）；②按工作区相对化
 * （页面显示用）。抽出来是因为渲染点有十来个，各写一遍必然漂移；且本模块
 * 无 React、无 DOM，可直接被 `node --test` 加载（见 `test/file-path.test.js`）。
 *
 * 地址形态镜像官方 `@deepseek-ai/dsh-util-workspace-path` 的 `sessionFileAddress`：
 * `dsh-resource://file/session/<sessionId>/<path>`，路径段逐段百分号编码。
 * 不直接依赖该包——本插件自包含（零运行时依赖，见 api.ts 同款取舍），而地址
 * 语法是右侧栏契约的一部分，宿主换语法时全站一起换，此处不是唯一的耦合点。
 *
 * **绝对路径在地址里带前导空段**（`…/session/<id>//Users/…`）——这不是笔误，
 * 是官方语法：`parseFileAddress` 靠那个空段把路径还原成绝对形式。视图显示的是
 * 相对工作区的短路径（见 `displayPath`），所以常态下不出现；仓外文件才走这条。
 */

/** 编码一个路径段：保留 `:` 字面量，让 Windows 盘符读起来仍是原样。 */
const encodeSegment = (segment: string): string => encodeURIComponent(segment).replace(/%3A/gi, ':')

/**
 * 一个文件在某个会话下的资源地址——与聊天里 `@文件`、文件树点开是同一条地址，
 * 右侧栏据此路由到文本预览类型。
 *
 * 传进来的路径本就可相对或绝对：绝对路径的地址里保留一个前导空段（官方语法），
 * 相对路径则原样拼在会话 id 后。
 * @param sessionId - 读取该文件的会话 id。
 * @param path - 绝对路径，或相对该会话工作目录的路径。
 * @returns `dsh-resource://file/session/<sessionId>/<path>` 地址。
 */
export function fileAddress(sessionId: string, path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  const encoded = normalized.split('/').map(encodeSegment).join('/')
  return `dsh-resource://file/session/${encodeSegment(sessionId)}/${encoded}`
}

/**
 * 页面显示用的路径：在工作目录内显示相对形式（`.scratch/<effort>/issues/14-….md`），
 * 仓外路径原样显示（绝对路径）——相对化只为好读，不改变它指向的文件。
 * @param path - 文件的绝对路径（或已相对的路径）。
 * @param cwd - 会话工作目录；未知则原样返回。
 * @returns 显示路径。
 */
export function displayPath(path: string, cwd: string | undefined): string {
  const normalized = path.replace(/\\/g, '/')
  const root = cwd?.replace(/\\/g, '/').replace(/\/+$/, '')
  if (root === undefined || root === '') return normalized
  if (normalized === root) return '.'
  return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized
}
