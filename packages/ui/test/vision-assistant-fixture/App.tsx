import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Emitter, Event } from "@zcode/rpc";
import { createPluginAgentStateId, VISION_ASSISTANT_PLUGIN_ID } from "@zcode/shared";
import { ServiceProvider } from "../../src/hooks/useServices.js";
import { PlatformProvider } from "../../src/hooks/usePlatform.js";
import { TabStoreProvider } from "../../src/store/TabStoreProvider.js";
import { ZCodeIntlProvider } from "../../src/i18n/IntlProvider.js";
import { useRemoteWorkspaceSessionStore } from "../../src/store/remoteWorkspaceSessionStore.js";
import { VisionAssistantSettings } from "../../src/settings/VisionAssistantSettings.js";
import { ImageVisionModelSelect } from "../../src/v4/composer/ImageVisionModelSelect.js";
import { useComposerAttachments } from "../../src/v4/composer/useComposerAttachments.js";
import "../../src/styles.css";

let view = {
  revision: 1,
  providers: [
    {
      providerId: "example",
      providerName: "Example",
      config: { api: { type: "openai" } },
      models: [
        {
          modelId: "text-model",
          config: {
            properties: { inputFormat: { supportsImage: false } },
            optionSpecs: { reasoningLevel: { values: ["none"] } },
          },
        },
        {
          modelId: "vision-a",
          config: {
            properties: { inputFormat: { supportsImage: true } },
            optionSpecs: { reasoningLevel: { values: ["none"] } },
          },
        },
        {
          modelId: "vision-b",
          config: {
            properties: { inputFormat: { supportsImage: true } },
            optionSpecs: { reasoningLevel: { values: ["none"] } },
          },
        },
      ],
    },
  ],
};
let enabled = true;
const visionTemplate = view.providers[0].models[1];
const modelChanges = new Emitter<typeof view>();
const pluginChanges = new Emitter<void>();
let backup;
const calls: unknown[] = [];
let failed = false;
const scenario = new URLSearchParams(location.search).get("scenario");
const plugin = () => ({
  id: VISION_ASSISTANT_PLUGIN_ID,
  name: "vision-assistant",
  enabled,
  rootPath: "/plugins/vision-assistant",
  mcpServerNames: [],
  components: [],
});
const services = {
  modelSelectionService: { getView: async () => view, onDidChange: modelChanges.event },
  subagentsService: {
    getPluginAgentModelOverride: async () => ({ modelSelection: backup }),
    list: async () => ({
      agents: [],
      userAgents: [],
      pluginAgents: [
        {
          id: createPluginAgentStateId(VISION_ASSISTANT_PLUGIN_ID, "vision-reader"),
          modelSelectionOverride: backup,
        },
      ],
    }),
    setPluginAgentModelOverride: async ({ modelSelection }) => {
      backup = modelSelection;
    },
  },
  pluginManagementService: {
    onDidChange: pluginChanges.event,
    listPlugins: async (input) => {
      calls.push(input);
      if (scenario === "error" && !failed) {
        failed = true;
        throw new Error("Fixture plugin read failed");
      }
      return { plugins: scenario === "missing" ? [] : [plugin()], diagnostics: [] };
    },
    getPluginsOverview: async () => ({
      marketplaces: [],
      availablePlugins: [],
      installedPlugins: [],
      restorableBuiltins: [],
      diagnostics: [],
    }),
    setPluginEnabled: async (input) => {
      calls.push(input);
      enabled = input.enabled;
      pluginChanges.fire();
      return { enabled, plugin: plugin() };
    },
  },
  promptAttachmentTransferService: {},
};
// 模拟远端项目外层 ServiceProvider：全局配置只能使用已注册的 Local Host。
useRemoteWorkspaceSessionStore.setState({ baseServices: services });
const failRemoteRead = async () => {
  throw new Error("Global settings must not read the remote Host");
};
const remoteServices = {
  ...services,
  modelSelectionService: { getView: failRemoteRead, onDidChange: Event.None },
  pluginManagementService: {
    onDidChange: Event.None,
    listPlugins: failRemoteRead,
    setPluginEnabled: failRemoteRead,
  },
  subagentsService: {
    getPluginAgentModelOverride: failRemoteRead,
    setPluginAgentModelOverride: failRemoteRead,
  },
};
const imageRefs = ["a", "b"].map((name) => ({
  ref: `zcode-artifact://test/${name}`,
  fileName: `${name}.png`,
  mime: "image/png",
  bytes: 10,
}));
const attachmentPut = async () => {
  throw new Error("Restored attachments must not upload again");
};

function App() {
  const [page, setPage] = useState("models");
  const [sent, setSent] = useState([]);
  const attachments = useComposerAttachments({
    workspacePath: "/workspace",
    scopeId: "test",
    attachmentSessionId: "session",
    attachmentPut,
    listenAddToChatEvents: false,
  });
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4">
      <button onClick={() => setPage(page === "models" ? "plugin" : "models")}>
        {page === "models" ? "Plugin details" : "Model settings"}
      </button>
      <button onClick={() => setPage("remote")}>Remote project</button>
      <button
        onClick={() => {
          view = {
            ...view,
            revision: view.revision + 1,
            providers: view.providers.map((provider) => ({
              ...provider,
              models: [...provider.models, { ...visionTemplate, modelId: "vision-c" }],
            })),
          };
          modelChanges.fire(view);
        }}
      >
        Add vision model
      </button>
      <button
        onClick={() => {
          view = {
            ...view,
            revision: view.revision + 1,
            providers: view.providers.map((provider) => ({
              ...provider,
              models: provider.models.filter((model) => model.modelId !== "vision-c"),
            })),
          };
          modelChanges.fire(view);
        }}
      >
        Delete vision model
      </button>
      <button
        onClick={() => {
          view = {
            ...view,
            revision: view.revision + 1,
            providers: view.providers.map((provider) => ({
              ...provider,
              models: provider.models.filter((model) => model.modelId === "text-model"),
            })),
          };
          modelChanges.fire(view);
          // 模拟 Host 的自动关闭广播；持久化和并发规则由真实 Service 单测覆盖。
          enabled = false;
          pluginChanges.fire();
        }}
      >
        Delete all vision models
      </button>
      <ServiceProvider services={page === "remote" ? remoteServices : services}>
        <VisionAssistantSettings
          key={page}
          localOnly={page !== "plugin"}
          workspacePath={page === "plugin" ? "/workspace" : undefined}
        />
      </ServiceProvider>
      <button onClick={() => attachments.restoreSessionOwnedAttachments(imageRefs)}>
        Add images
      </button>
      <div className="flex flex-wrap gap-3">
        {attachments.attachments.map((item) => (
          <div key={item.id} data-testid="image-choice">
            <p>{item.filename}</p>
            <ImageVisionModelSelect
              view={view}
              value={item.visionModel}
              onChange={(selection) => attachments.setVisionModel(item.id, selection)}
            />
          </div>
        ))}
      </div>
      <button
        onClick={async () => {
          const refs = await attachments.prepareForSend();
          if (refs) {
            setSent(refs);
            attachments.clearAttachments();
          }
        }}
      >
        Send
      </button>
      <button onClick={() => attachments.restoreSessionOwnedAttachments(sent)}>Withdraw</button>
      <output data-testid="sent-attachments" className="block break-all text-ui-sm">
        {JSON.stringify(sent)}
      </output>
      <output data-testid="configuration-calls">{JSON.stringify(calls)}</output>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <ServiceProvider services={services}>
    <PlatformProvider platform={{ canSelectFilePath: false }}>
      <TabStoreProvider>
        <ZCodeIntlProvider initialLocale="zh-CN">
          <App />
        </ZCodeIntlProvider>
      </TabStoreProvider>
    </PlatformProvider>
  </ServiceProvider>,
);
