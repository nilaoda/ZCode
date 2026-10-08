import { Switch } from "@/components/ui/switch.js";
import { VisionModelSelect } from "@/components/VisionModelSelect.js";
import { useVisionAssistant, type VisionAssistantTarget } from "@/hooks/useVisionAssistant.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

export function VisionAssistantSettings(target: VisionAssistantTarget) {
  const { intl } = useZCodeIntl();
  const vision = useVisionAssistant(target);
  return (
    <section className="space-y-3" data-testid="vision-assistant-settings">
      <h3 className="text-ui-base font-medium">{intl.formatMessage({ id: "vision.title" })}</h3>
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "vision.enabled" })}
          description={intl.formatMessage({ id: "vision.description" })}
          control={
            <Switch
              aria-label={intl.formatMessage({ id: "vision.enabled" })}
              checked={vision.plugin?.enabled === true}
              disabled={!vision.plugin || vision.pending}
              onCheckedChange={(enabled) => void vision.setEnabled(enabled)}
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "vision.backup" })}
          description={intl.formatMessage({ id: "vision.backupDescription" })}
          control={
            <VisionModelSelect
              view={vision.models.state.status === "ready" ? vision.models.state.view : undefined}
              value={vision.selection}
              disabled={
                !vision.plugin ||
                !vision.ready ||
                vision.pending ||
                vision.models.state.status !== "ready"
              }
              onChange={(selection) => void vision.setModel(selection)}
              automaticLabel={intl.formatMessage({ id: "vision.unconfigured" })}
              label={intl.formatMessage({ id: "vision.backup" })}
            />
          }
          detail={
            vision.error ? (
              <p role="alert" className="text-ui-base text-destructive">
                {vision.error}
              </p>
            ) : !vision.plugin ? (
              <p className="text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "vision.loading" })}
              </p>
            ) : undefined
          }
        />
      </SettingsGroupCard>
    </section>
  );
}
