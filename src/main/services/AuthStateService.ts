import { BrowserWindow, session, webContents } from 'electron'
import type Store from 'electron-store'
import {
  platformAuthCookies,
  platformAuthCookieRules,
  platformAuthCookieDomains,
  platformAuthStorage
} from '../../shared/config/selectors'

/** 单个平台的登录态判定结果。 */
export interface PlatformAuthState {
  platform: string
  /** true=已登录，false=明确未登录（游客），undefined=无法判定（名单未收录或页面不可读）。 */
  signedIn?: boolean
  /** 命中的账号 cookie 名或 localStorage 键，便于排查；不返回任何凭证值。 */
  matchedCookie?: string
  /** 判定来源：cookie、实时页面 localStorage 或持久化缓存。 */
  source?: 'cookie' | 'storage' | 'cache'
}

interface StoredPlatformAuthEntry {
  signedIn: boolean
  matchedCookie?: string
  updatedAt: number
}

/**
 * 双通道判断登录态，与 UI 共用 persist:shared 分区，读到的就是当前真实状态：
 * ① cookie 名单（chatgpt/gemini/doubao/grok/yuanbao/qwen/chatglm/yiyan/arena）；
 * ② 页面 localStorage（deepseek 的 userToken、kimi 的 refresh_token）。
 *
 * 两个通道都要看，不能只看 cookie：deepseek 的 cookie 只有设备标识，kimi 完全不用 cookie
 * 存凭证，只看 cookie 会把已登录误判成游客。判定顺序是
 * "cookie 命中 → 已登录；否则 localStorage 给出结论 → 采用；都没有 → 未知"。
 * 反过来，名字命中也不等于已登录：chatglm/yuanbao 游客态会写同名 cookie，须再按值否决
 * （platformAuthCookieRules）。
 *
 * cookie 通道直读分区、不加载页面；localStorage 通道优先复用已打开的 WebContents，
 * 需要时（`allowPageLoad`）才临时加载一次目标站点——只有这样做才能读到 Kimi 这类
 * 凭证完全不在 cookie 里的平台，且读到的是站点自己恢复出来的真实登录态。
 *
 * 只按平台名单精确匹配：通用"名字像凭证"的启发式会把 __Host-id-token-nonce（grok 游客态
 * 一次性 nonce）、sid 类统计 cookie 误判成登录，实测已证伪，因此不采用。
 */
export class AuthStateService {
  /** 临时加载页面的上限；超时按"未知"处理，不阻塞调用方。 */
  private static readonly STORAGE_LOAD_TIMEOUT_MS = 12_000
  private static readonly STORAGE_CACHE_KEY = 'platformAuthStorageCache'

  private store: Store<Record<string, unknown>> | null = null
  private storageCache: Record<string, StoredPlatformAuthEntry> = {}

  /** 注入配置存储，恢复 localStorage 类平台的上次已知登录态缓存。 */
  public init(store: Store<Record<string, unknown>>): void {
    this.store = store
    try {
      const raw = store.get(AuthStateService.STORAGE_CACHE_KEY)
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const restored: Record<string, StoredPlatformAuthEntry> = {}
        for (const [platform, entry] of Object.entries(raw as Record<string, unknown>)) {
          if (!entry || typeof entry !== 'object') continue
          const record = entry as Record<string, unknown>
          if (typeof record.signedIn !== 'boolean') continue
          restored[platform] = {
            signedIn: record.signedIn,
            ...(typeof record.matchedCookie === 'string' && record.matchedCookie
              ? { matchedCookie: record.matchedCookie }
              : {}),
            updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now()
          }
        }
        this.storageCache = restored
      }
    } catch (error) {
      console.warn('[AuthState] 恢复登录态缓存失败:', error)
    }
  }

  private updateStorageCache(platform: string, result: { signedIn: boolean; matched?: string }): void {
    const prev = this.storageCache[platform]
    const nextMatched = result.matched || undefined
    if (prev && prev.signedIn === result.signedIn && prev.matchedCookie === nextMatched) {
      return
    }
    this.storageCache[platform] = {
      signedIn: result.signedIn,
      ...(nextMatched ? { matchedCookie: nextMatched } : {}),
      updatedAt: Date.now()
    }
    try {
      this.store?.set(AuthStateService.STORAGE_CACHE_KEY, this.storageCache)
    } catch (error) {
      console.warn('[AuthState] 写入登录态缓存失败:', error)
    }
  }

  private readStorageCache(platform: string): PlatformAuthState | null {
    const entry = this.storageCache[platform]
    if (!entry || typeof entry.signedIn !== 'boolean') return null
    return {
      platform,
      signedIn: entry.signedIn,
      ...(entry.matchedCookie ? { matchedCookie: entry.matchedCookie } : {}),
      source: 'cache'
    }
  }

  /**
   * 被动采集：当已有 WebContents 加载/导航到 localStorage 类平台时，顺手读取一次
   * localStorage 并更新持久化缓存，避免为了判登录额外在后台建窗。
   */
  public async captureFromWebContents(wc: Electron.WebContents): Promise<void> {
    if (wc.isDestroyed()) return
    const url = wc.getURL()
    if (!url.startsWith('https://')) return

    for (const [platform, storage] of Object.entries(platformAuthStorage)) {
      if (!storage.origins.some(origin => url.startsWith(origin))) continue
      const result = await this.readStorageFrom(wc, storage)
      if (result) {
        this.updateStorageCache(platform, result)
      }
    }
  }

  private cookieUrl(platform: string, baseUrl: string): string {
    return baseUrl || `https://${platform}.com`
  }

  /**
   * 在已加载目标 origin 的 WebContents 上读取 localStorage。
   * 只读现有窗口，不新建、不导航——避免为了判登录而触发页面加载。
   */
  private async readStorage(
    origins: string[],
    keys: { signedInKeys?: string[]; signedOutMarkers?: string[] }
  ): Promise<{ signedIn: boolean; matched?: string } | null> {
    const target = [...webContents.getAllWebContents()].find(wc => {
      if (wc.isDestroyed()) return false
      const url = wc.getURL()
      return origins.some(origin => url.startsWith(origin))
    })
    if (!target) return null

    return this.readStorageFrom(target, keys)
  }

  /** 在指定 WebContents 上求值 localStorage 名单；页面异常时返回 null。 */
  private async readStorageFrom(
    target: Electron.WebContents,
    keys: { signedInKeys?: string[]; signedOutMarkers?: string[] }
  ): Promise<{ signedIn: boolean; matched?: string } | null> {
    const script = `(() => {
      const read = k => { try { return window.localStorage.getItem(k) } catch { return null } };
      // 站点常把值包一层 {"value":null,"__version":"0"}（deepseek 游客态即如此），
      // 直接判断"非空字符串"会把空壳当成凭证，这里剥出真实值。
      const meaningful = raw => {
        if (raw === null || raw === undefined) return false;
        const text = String(raw).trim();
        if (!text || text === 'null' || text === '""' || text === '{}' || text === '[]') return false;
        if (text.charAt(0) === '{' || text.charAt(0) === '[') {
          try {
            const parsed = JSON.parse(text);
            const inner = parsed && typeof parsed === 'object' && 'value' in parsed ? parsed.value : parsed;
            if (inner === null || inner === undefined || inner === '' || inner === false) return false;
            if (typeof inner === 'object') return Object.keys(inner).length > 0;
            return true;
          } catch { return true; }
        }
        return true;
      };
      const markers = ${JSON.stringify(keys.signedOutMarkers ?? [])};
      const signedInKeys = ${JSON.stringify(keys.signedInKeys ?? [])};
      const marker = markers.find(k => read(k) !== null);
      if (marker) return { signedIn: false, matched: marker };
      const hit = signedInKeys.find(k => meaningful(read(k)));
      if (hit) return { signedIn: true, matched: hit };
      return { signedIn: false };
    })()`

    try {
      const result = await target.executeJavaScript(script) as { signedIn: boolean; matched?: string }
      return result
    } catch (error) {
      console.warn('[AuthState] 读取 localStorage 失败:', error)
      return null
    }
  }

  /**
   * 临时加载一次目标站点再读 localStorage。
   * 只在没有任何 WebContents 停在该 origin 时使用：localStorage 按 origin 落在 persist:shared
   * 磁盘上，加载页面只是为了取得读取入口，读到的就是用户真实打开该平台时的内容。
   * 加载失败/超时返回 null（未知），不能当成游客——错误页的 localStorage 是空的，
   * 当成游客会让已登录用户被登录门槛平台直接拦下。
   */
  private async loadAndReadStorage(
    origin: string,
    keys: { signedInKeys?: string[]; signedOutMarkers?: string[] }
  ): Promise<{ signedIn: boolean; matched?: string } | null> {
    let win: BrowserWindow | null = null
    try {
      win = new BrowserWindow({
        show: false,
        skipTaskbar: true,
        width: 1024,
        height: 720,
        webPreferences: {
          partition: 'persist:shared',
          sandbox: false,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false
        }
      })
      const wc = win.webContents
      let loadedOk = false
      const loaded = new Promise<void>(resolve => {
        wc.once('did-finish-load', () => {
          loadedOk = true
          resolve()
        })
        wc.once('did-fail-load', () => resolve())
      })
      await Promise.race([
        wc.loadURL(origin).catch(() => undefined).then(() => loaded),
        new Promise<void>(resolve => setTimeout(resolve, AuthStateService.STORAGE_LOAD_TIMEOUT_MS))
      ])
      if (wc.isDestroyed()) return null
      if (!loadedOk || !wc.getURL().startsWith(origin)) return null
      return await this.readStorageFrom(wc, keys)
    } catch (error) {
      console.warn('[AuthState] 加载页面读取 localStorage 失败:', error)
      return null
    } finally {
      if (win && !win.isDestroyed()) win.destroy()
    }
  }

  /**
   * 判定顺序：cookie 命中即已登录；否则用 localStorage 给出结论；两者都判不出才是未知。
   * 判不出"已登录"时不会伪造成游客：登录门槛平台据此快速失败，误判会直接挡住可用平台。
   *
   * @param options.allowPageLoad 允许为读 localStorage 临时加载站点。默认关闭：
   *        `platforms` 列表与提交前快速失败都走默认值，不为判登录额外开窗（两者分别有
   *        能力表性能和页面侧兜底可用）。`auth.status` 显式查询时打开，才能读到 Kimi。
   * @param options.useCache 当页面未打开且未允许临时加载时，回退读取持久化缓存（UI 展示用）。
   */
  public async getState(
    platform: string,
    baseUrl: string,
    options?: { allowPageLoad?: boolean; useCache?: boolean }
  ): Promise<PlatformAuthState> {
    const storage = platformAuthStorage[platform]
    const names = platformAuthCookies[platform]
    const rule = platformAuthCookieRules[platform]

    // cookie 命中即已登录；未命中不代表游客（凭证可能在 localStorage 或另一站点），继续看 storage。
    const cookieHit = names?.length
      ? await this.readCookie(platform, baseUrl, names)
      : rule
        ? await this.readCookieWithRule(platform, baseUrl, rule)
        : null
    if (cookieHit?.signedIn) return cookieHit

    if (storage) {
      const fromStorage = await this.readStorage(storage.origins, storage)
      if (fromStorage) {
        this.updateStorageCache(platform, fromStorage)
        return {
          platform,
          signedIn: fromStorage.signedIn,
          ...(fromStorage.matched ? { matchedCookie: fromStorage.matched } : {}),
          source: 'storage'
        }
      }
      if (options?.allowPageLoad) {
        for (const origin of storage.origins) {
          const loaded = await this.loadAndReadStorage(origin, storage)
          if (loaded) {
            this.updateStorageCache(platform, loaded)
            return {
              platform,
              signedIn: loaded.signedIn,
              ...(loaded.matched ? { matchedCookie: loaded.matched } : {}),
              source: 'storage'
            }
          }
        }
      }
      if (options?.useCache) {
        const cached = this.readStorageCache(platform)
        if (cached) return cached
      }
    }
    // 有 cookie 名单但没命中、也没有 storage 结论时，才是明确的游客态。
    if (cookieHit) return cookieHit
    return { platform }
  }

  private async readCookie(platform: string, baseUrl: string, names: string[]): Promise<PlatformAuthState> {
    return this.readCookieWithRule(platform, baseUrl, { names })
  }

  /**
   * 带值判定的 cookie 读取。名字命中后仍可能被值否决（游客态也写同名 cookie），
   * 此时返回 signedIn:false；读取失败或页面无 cookie 时返回 undefined，交给上层继续判定。
   */
  private async readCookieWithRule(
    platform: string,
    baseUrl: string,
    rule: { names: string[]; jwtGuestFlag?: string; valuePrefix?: string }
  ): Promise<PlatformAuthState> {
    let cookies: Electron.Cookie[] = []
    try {
      cookies = await session.fromPartition('persist:shared').cookies.get({ url: this.cookieUrl(platform, baseUrl) })
    } catch (error) {
      console.warn(`[AuthState] 读取 cookie 失败 (${platform}):`, error)
      return { platform }
    }
    if (!cookies.length) return { platform, signedIn: false }

    const nowSeconds = Date.now() / 1000
    const domain = platformAuthCookieDomains[platform]
    const alive = cookies.filter(c => {
      if (c.expirationDate && c.expirationDate <= nowSeconds) return false
      if (!domain) return true
      const host = (c.domain ?? '').replace(/^\./, '').toLowerCase()
      // 按域名标签边界匹配，避免 notbaidu.com 之类的同名后缀误命中
      return host === domain || host.endsWith(`.${domain}`)
    })
    // 名称精确匹配或分片匹配（如 __Secure-next-auth.session-token.0/.1）
    const matched = alive.find(c => rule.names.some(n => c.name === n || c.name.startsWith(`${n}.`)))
    if (!matched) return { platform, signedIn: false, source: 'cookie' }
    if (this.isGuestCookieValue(matched.value ?? '', rule)) {
      return { platform, signedIn: false, source: 'cookie' }
    }
    return { platform, signedIn: true, matchedCookie: matched.name, source: 'cookie' }
  }

  /** 名字命中但值是游客凭证时返回 true（见 platformAuthCookieRules）。 */
  private isGuestCookieValue(
    value: string,
    rule: { jwtGuestFlag?: string; valuePrefix?: string }
  ): boolean {
    if (rule.valuePrefix && value.startsWith(rule.valuePrefix)) return true
    if (rule.jwtGuestFlag) {
      const parts = value.split('.')
      if (parts.length >= 2) {
        try {
          const payload = JSON.parse(
            Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
          ) as Record<string, unknown>
          if (payload[rule.jwtGuestFlag]) return true
        } catch {
          // 非 JWT 或载荷不可解析：不据此判游客，交给后续通道。
        }
      }
    }
    return false
  }

  /** 批量查询，供 `platforms` 能力表使用。 */
  public async getAll(states: Array<{ platform: string; baseUrl: string }>): Promise<PlatformAuthState[]> {
    const results: PlatformAuthState[] = []
    for (const item of states) {
      results.push(await this.getState(item.platform, item.baseUrl))
    }
    return results
  }

  /** 批量查询并映射为字典，供渲染层模型选择器展示登录态（不触发额外网页加载）。 */
  public async getStatesMap(
    states: Array<{ platform: string; baseUrl: string }>,
    options?: { useCache?: boolean }
  ): Promise<Record<string, PlatformAuthState>> {
    const entries = await Promise.all(
      states.map(async item => [
        item.platform,
        await this.getState(item.platform, item.baseUrl, { useCache: options?.useCache ?? true }).catch(
          () => ({ platform: item.platform } as PlatformAuthState)
        )
      ] as const)
    )
    return Object.fromEntries(entries)
  }
}

export const authStateService = new AuthStateService()
