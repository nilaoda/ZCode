import type { ModelSelection } from "@zcode/shared";
import type { ModelSelectionView } from "@zcode/services";
import { VisionModelSelect } from "@/components/VisionModelSelect.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function ImageVisionModelSelect({
  view,
  value,
  onChange,
  disabled,
}: {
  view?: ModelSelectionView | null;
  value?: ModelSelection;
  onChange: (value?: ModelSelection) => void;
  disabled?: boolean;
}) {
  const { intl } = useZCodeIntl();
  return (
    <VisionModelSelect
      compact
      view={view ?? undefined}
      value={value}
      onChange={onChange}
      disabled={disabled || !view}
      automaticLabel={intl.formatMessage({ id: "vision.automatic" })}
      label={intl.formatMessage({ id: "vision.thisImage" })}
    />
  );
}
