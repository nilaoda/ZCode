import type { ModelSelectionView } from "./facades.js";
import { completeNewModelSelection } from "./model-selection-config.js";

/** 候选仅来自已配置且可执行的 Model Selection View，不读取模板或推荐目录。 */
export function listVisionModelCandidates(view: ModelSelectionView) {
  return view.providers.flatMap((provider) =>
    provider.models.flatMap((model) => {
      if (model.config.properties.inputFormat.supportsImage !== true) return [];
      const selection = completeNewModelSelection(view, {
        providerId: provider.providerId,
        modelId: model.modelId,
      });
      return selection
        ? [
            {
              key: JSON.stringify([provider.providerId, model.modelId]),
              name: `${model.modelId} · ${provider.providerName ?? provider.providerId}`,
              selection,
            },
          ]
        : [];
    }),
  );
}
