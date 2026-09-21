interface RootStartupGateState {
  isResolvingStartupAuthState: boolean;
  isResolvingProviderStartupState: boolean;
  isRestoring: boolean;
  isBootstrappingInitialWorkspace: boolean;
}

interface RootStartupLoadingVisibilityState extends RootStartupGateState {
  isDesktop: boolean | undefined;
  welcomeScreenOpen: boolean;
}

interface FallbackWorkspaceCreateState {
  isMounted: boolean;
  activeWorkspacePath: string | null;
}

interface ProviderStartupSyncState {
  providerFamilyDomainMigrationComplete: boolean;
  modelSelectionViewHydrated: boolean;
}

interface ProviderStartupResolutionState {
  providerStartupSyncPending: boolean;
  providerAvailabilityStartupCheckCompleted: boolean;
}

export function shouldBlockRootRender(state: RootStartupGateState): boolean {
  return (
    state.isResolvingStartupAuthState ||
    state.isResolvingProviderStartupState ||
    state.isRestoring ||
    state.isBootstrappingInitialWorkspace
  );
}

export function shouldShowRootStartupLoading(state: RootStartupLoadingVisibilityState): boolean {
  // 登录入口是启动门禁的结果，不是可继续被门禁遮挡的后台状态。
  // 如果 WelcomeScreen 已经打开，继续返回启动 loading 会把未登录用户卡在黑屏 logo。
  return Boolean(state.isDesktop) && !state.welcomeScreenOpen && shouldBlockRootRender(state);
}

/**
 * 是否启用「无可用 Provider 就强制打开登录入口」的启动门禁。
 *
 * 本地化版本：**关闭该门禁**。外部登录服务已整体移除，这里不再有可登录的目标；
 * 继续开启只会把没有配置模型的用户卡在一个无法完成的登录页上。
 *
 * 关闭后应用始终直接进入工作台，用户在「设置 → 模型供应商」中自行添加本地模型
 * （任意 baseUrl + OpenAI 兼容协议）。`useProviderAvailabilityLoginEntryGuard`
 * 在 enabled=false 时会直接把 startupCheckCompleted 置为 true，
 * 因此启动 loading 不会被无限期遮挡。
 */
export function shouldEnableProviderAvailabilityLoginEntryGuard(): boolean {
  return false;
}

export function shouldResolveProviderStartupState(state: ProviderStartupResolutionState): boolean {
  return state.providerStartupSyncPending || !state.providerAvailabilityStartupCheckCompleted;
}

export function shouldOpenFallbackWorkspaceAfterCreate(
  state: FallbackWorkspaceCreateState,
): boolean {
  return state.isMounted && !state.activeWorkspacePath;
}

export function isProviderStartupSyncPending(state: ProviderStartupSyncState): boolean {
  return !state.providerFamilyDomainMigrationComplete || !state.modelSelectionViewHydrated;
}
