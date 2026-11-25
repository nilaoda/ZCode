# 预装工具本地归档源（内网发行版）

Status: ready-for-agent

内网发行版没有静态资源服务器，产品运行期也不允许访问 `cdn-zcode.z.ai`。本规格把五个预装工具的
归档随安装包分发，安装/更新时从包内读取，替代上游的 CDN 下载。

上游链路、catalog 版本口径、校验/解压/入口生成/删除/开关语义保持不变；本规格只增加一个
「本地归档源」，并把它排在网络候选之前。

## 目标与非目标

目标：

- 当前平台的全部预装工具归档随安装包分发，安装过程不产生任何网络请求。
- 保留上游全部行为：SHA-256 与大小校验、流式安全解压、安装后运行检查、原子发布、入口派生、
  按工具开关、删除与占用检查。
- 本地源缺失或损坏时给出明确失败，不静默回退到外网。
- 非 Local 构建（上游身份）仍可在本地源缺失时使用网络候选。

非目标：

- 不新增「手动导入压缩包」入口；包内归档是唯一离线来源。
- 不做增量更新：工具版本随 App 版本固定（catalog 内置 `resourceId` 与 SHA-256）。
- 不改变 catalog 的资源选择规则（平台/架构）。

## 所有者与数据流

构建期：

```text
catalog.json ──(target os/arch)──> prepare-preinstalled-tool-archives.mjs
                                        │ 下载/校验 (size + sha256)
                                        ▼
packages/desktop/bundled-tools/<platform-key>/preinstalled-tools/<archive.path>
                                        │ electron-builder extraResources
                                        ▼
                    <app>/Resources/preinstalled-tools/<archive.path>
```

运行期：

```text
Main (index.ts) ──env ZCODE_PREINSTALLED_TOOLS_ARCHIVE_DIR──> 预装工具 worker
                                                        │
                                          installation: 解析包内归档
                                                        │
                              ┌─────────────────────────┴────────────────────────┐
                              ▼                                                  ▼
                     包内归档存在：校验后直接流式解压                 包内缺失：Local 直接失败
                     （不复制归档，峰值磁盘≈installed）              非 Local 走网络候选
```

## 构建期规则

- 入口：`scripts/prepare-preinstalled-tool-archives.mjs`，由 `bundle.mjs` 在
  `prepare:runtime-assets` 之后、`electron-builder` 之前调用；`pnpm build` 不触发，避免开发构建
  反复下载大文件。
- 目标平台取 `ZCODE_TARGET_OS` / `ZCODE_TARGET_ARCH`（`getTargetPlatform()` 同口径）。
- 归档来源：`ZCODE_PREINSTALLED_TOOLS_ARCHIVE_SOURCE`（逗号分隔，支持 `https?://` 基址或本地
  目录）。未设置时使用 catalog 的官方 CDN 基址，仅作为构建机来源，不进入产品运行期。
- 每个资源必须通过 catalog 的 `archive.sizeBytes` 与 `archive.sha256` 校验后才写入目标目录；
  已存在且校验通过的文件跳过（幂等）。
- 只暂存当前 target 平台的资源；没有资源的平台不生成目录。
- 校验失败、下载失败、磁盘不足都让构建失败，不产出缺少归档的安装包。

## 运行期规则

- Main 通过子进程环境下发 `ZCODE_PREINSTALLED_TOOLS_ARCHIVE_DIR`（打包态为
  `process.resourcesPath/preinstalled-tools`；开发/E2E 指向
  `bundled-tools/<platform-key>/preinstalled-tools`，也可由外部显式覆盖）。初始化消息不为
  此新增字段，避免改动共享契约。
- 安装事务顺序：本地归档 → 网络候选（仅非 Local）。
- 本地归档直接作为解压输入，不复制到 staging；空间检查只要求 `installedSizeBytes`。
- 本地归档校验失败按 `checksum` 失败处理，不尝试网络候选。
- Local 构建（`ZCODE_LOCAL_ONLY_BUILD`）在本地归档缺失时直接以 `network` 失败返回，不创建网络
  传输、不发起请求。
- 非 Local 构建在本地归档缺失时保持上游行为（按候选顺序下载）。

## 失败与提示

| 场景 | 失败分类 | 用户可见结果 |
| --- | --- | --- |
| 包内归档缺失（Local） | `network` | 准备失败，可重试；不会出网 |
| 包内归档缺失（非 Local） | 上游候选结果 | 与上游一致 |
| 包内归档大小或哈希不符 | `checksum` | 准备失败，可重试 |
| 解压越界或超限 | `extract` | 准备失败 |
| 磁盘不足 | `disk-space` | 提示所需空间 |

## 验收场景

1. `bundle:desktop` 产物包含当前平台的全部归档，文件大小与 SHA-256 与 catalog 一致。
2. Local 构建在完全断网环境启动，自动预装完成，抓包无任何出网请求。
3. 删除包内某个归档后启动并准备该工具：立即失败为 `network`，抓包无请求。
4. 篡改包内归档一个字节：准备失败为 `checksum`，不产生安装记录。
5. 非 Local 构建删除包内归档：仍按 catalog 候选下载并安装。
6. 归档存在时安装峰值磁盘不超过 `installedSizeBytes` 加少量 staging 余量。
