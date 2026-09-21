import type { ProviderConfigLayerSnapshot, ProviderSource } from "@zcode/provider";
import {
  normalizeZCodeBuiltinEndpointOrigin,
  resolveZCodeBuiltinCachePaths,
} from "./zcode-builtin-cache-paths.js";
import { NodeZCodeBuiltinProviderConfigSource } from "./zcode-builtin-provider-config-source.js";
import {
  ZCodeBuiltinRemoteSynchronizer,
  type ZCodeBuiltinRefreshResult,
  type ZCodeBuiltinRemoteSynchronizerOptions,
} from "./zcode-builtin-remote-synchronizer.js";

export interface EndpointScopedZCodeBuiltinSourceOptions {
  readonly bundledFilePath: string;
  readonly environmentConfigRoot: string;
  readonly platform: string;
  readonly appVersion: string;
  readonly resolveEndpointOrigin: () => string | Promise<string>;
  readonly fetchRelease: ZCodeBuiltinRemoteSynchronizerOptions["fetchRelease"];
  readonly onRefreshResult?: ZCodeBuiltinRemoteSynchronizerOptions["onRefreshResult"];
  readonly watch?: boolean;
  /**
   * 是否启用「从产品 Endpoint 刷新内置目录」。默认启用。
   *
   * 置为 false 时**完全不创建同步器**：不发请求、不写刷新控制文件、不参与 1 小时节流。
   * 纯内网 / 纯本地发行版应关闭它 —— 只把本地 revision 钉高只能让远端结果被忽略，
   * 请求本身仍会发出去。
   */
  readonly remoteRefresh?: boolean;
}

/**
 * 让 Environment 的 ZCode 控制面 Endpoint 同时决定 Active/LKG 与刷新控制路径。
 * Endpoint 切换只替换当前 Source，不读取上一 Endpoint 的缓存。
 */
export class EndpointScopedZCodeBuiltinSource implements ProviderSource<ProviderConfigLayerSnapshot> {
  readonly #options: EndpointScopedZCodeBuiltinSourceOptions;
  readonly #listeners = new Set<(reason: string) => void>();
  #current: CurrentEndpointSource | null = null;
  #ensureInFlight: Promise<CurrentEndpointSource> | null = null;
  #disposed = false;

  constructor(options: EndpointScopedZCodeBuiltinSourceOptions) {
    this.#options = options;
  }

  async read(): Promise<ProviderConfigLayerSnapshot> {
    return (await this.#ensureCurrent()).source.read();
  }

  onDidChange(listener: (reason: string) => void): () => void {
    this.#assertNotDisposed();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async refresh(options?: { readonly force?: boolean }): Promise<ZCodeBuiltinRefreshResult> {
    const current = await this.#ensureCurrent();
    // 远端刷新被禁用时不存在同步器：直接返回 skipped，不发任何请求。
    return current.synchronizer?.refresh(options) ?? "skipped";
  }

  /** 返回当前 Environment Endpoint 对应、已完成物化的 Active Config 路径。 */
  async resolveActiveFilePath(): Promise<string> {
    return (await this.#ensureCurrent()).activeFilePath;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#current?.dispose();
    this.#current = null;
    this.#listeners.clear();
  }

  async #ensureCurrent(): Promise<CurrentEndpointSource> {
    this.#assertNotDisposed();
    if (this.#ensureInFlight) return this.#ensureInFlight;
    const ensure = this.#resolveCurrent().finally(() => {
      if (this.#ensureInFlight === ensure) this.#ensureInFlight = null;
    });
    this.#ensureInFlight = ensure;
    return ensure;
  }

  async #resolveCurrent(): Promise<CurrentEndpointSource> {
    const endpointOrigin = normalizeZCodeBuiltinEndpointOrigin(
      await this.#options.resolveEndpointOrigin(),
    );
    const paths = resolveZCodeBuiltinCachePaths({
      environmentConfigRoot: this.#options.environmentConfigRoot,
      platform: this.#options.platform,
      appVersion: this.#options.appVersion,
      zcodeEndpointOrigin: endpointOrigin,
    });
    if (this.#current?.activeFilePath === paths.activeFilePath) return this.#current;

    const source = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath: this.#options.bundledFilePath,
      activeFilePath: paths.activeFilePath,
      watch: this.#options.watch,
    });
    const sourceDispose = source.onDidChange((reason) => this.#emit(reason));
    // 纯内网 / 纯本地发行版可整体关掉远端刷新：不建同步器即不发请求。
    const synchronizer =
      this.#options.remoteRefresh === false
        ? undefined
        : new ZCodeBuiltinRemoteSynchronizer({
            source,
            controlFilePath: paths.controlFilePath,
            resolveEndpointKey: async () =>
              normalizeZCodeBuiltinEndpointOrigin(await this.#options.resolveEndpointOrigin()),
            fetchRelease: this.#options.fetchRelease,
            onRefreshResult: this.#options.onRefreshResult,
          });
    try {
      await source.read();
      this.#assertNotDisposed();
    } catch (error) {
      sourceDispose();
      synchronizer?.dispose();
      source.dispose();
      throw error;
    }

    const previous = this.#current;
    const current = new CurrentEndpointSource(
      paths.activeFilePath,
      source,
      synchronizer,
      sourceDispose,
    );
    this.#current = current;
    previous?.dispose();
    if (previous) this.#emit("endpoint-changed");
    return current;
  }

  #emit(reason: string): void {
    if (this.#disposed) return;
    for (const listener of this.#listeners) listener(reason);
  }

  #assertNotDisposed(): void {
    if (this.#disposed) throw new Error("EndpointScopedZCodeBuiltinSource 已 dispose");
  }
}

class CurrentEndpointSource {
  constructor(
    readonly activeFilePath: string,
    readonly source: NodeZCodeBuiltinProviderConfigSource,
    /** 远端刷新被禁用时为 undefined。 */
    readonly synchronizer: ZCodeBuiltinRemoteSynchronizer | undefined,
    readonly sourceDispose: () => void,
  ) {}

  dispose(): void {
    this.sourceDispose();
    this.synchronizer?.dispose();
    this.source.dispose();
  }
}
