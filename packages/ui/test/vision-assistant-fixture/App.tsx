import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Event } from "@zcode/rpc";
import { createPluginAgentStateId, VISION_ASSISTANT_PLUGIN_ID } from "@zcode/shared";
import { ServiceProvider } from "../../src/hooks/useServices.js";
import { PlatformProvider } from "../../src/hooks/usePlatform.js";
import { TabStoreProvider } from "../../src/store/TabStoreProvider.js";
import { ZCodeIntlProvider } from "../../src/i18n/IntlProvider.js";
import { VisionAssistantSettings } from "../../src/settings/VisionAssistantSettings.js";
import { ImageVisionModelSelect } from "../../src/v4/composer/ImageVisionModelSelect.js";
import { useComposerAttachments } from "../../src/v4/composer/useComposerAttachments.js";
import "../../src/styles.css";

const view = {
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
let backup;
const plugin = () => ({
  id: VISION_ASSISTANT_PLUGIN_ID,
  name: "vision-assistant",
  enabled,
  rootPath: "/plugins/vision-assistant",
  mcpServerNames: [],
  components: [],
});
const services = {
  modelSelectionService: { getView: async () => view, onDidChange: Event.None },
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
    listPlugins: async () => ({ plugins: [plugin()], diagnostics: [] }),
    getPluginsOverview: async () => ({
      marketplaces: [],
      availablePlugins: [],
      installedPlugins: [],
      restorableBuiltins: [],
      diagnostics: [],
    }),
    setPluginEnabled: async (input) => {
      enabled = input.enabled;
      return { enabled, plugin: plugin() };
    },
  },
  promptAttachmentTransferService: {},
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
      <VisionAssistantSettings
        key={page}
        localOnly={page === "models"}
        workspacePath="/workspace"
      />
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
