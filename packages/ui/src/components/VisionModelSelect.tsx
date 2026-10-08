import { completeNewModelSelection } from "@zcode/provider";
import type { ModelSelectionView } from "@zcode/services";
import type { ModelSelection } from "@zcode/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function VisionModelSelect({
  view,
  value,
  onChange,
  disabled,
  automaticLabel,
  label,
  compact = false,
}: {
  view?: ModelSelectionView;
  value?: ModelSelection;
  onChange: (value?: ModelSelection) => void;
  disabled?: boolean;
  automaticLabel: string;
  label: string;
  compact?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const candidates =
    view?.providers.flatMap((provider) =>
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
    ) ?? [];
  const selectedKey = value ? JSON.stringify([value.providerId, value.modelId]) : "automatic";
  const unavailable = value && !candidates.some((candidate) => candidate.key === selectedKey);
  return (
    <Select
      value={selectedKey}
      disabled={disabled}
      onValueChange={(key) => {
        if (key === "automatic") onChange(undefined);
        else {
          const candidate = candidates.find((item) => item.key === key);
          if (candidate) onChange(candidate.selection);
        }
      }}
    >
      <SelectTrigger
        aria-label={label}
        data-testid="vision-model-select"
        size={compact ? "xs" : "lg"}
        className={compact ? "max-w-32" : "w-full max-w-72"}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="automatic">{automaticLabel}</SelectItem>
        {unavailable ? (
          <SelectItem value={selectedKey} disabled>
            {value.modelId} · {intl.formatMessage({ id: "vision.unavailable" })}
          </SelectItem>
        ) : null}
        {candidates.map((candidate) => (
          <SelectItem key={candidate.key} value={candidate.key}>
            {candidate.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
