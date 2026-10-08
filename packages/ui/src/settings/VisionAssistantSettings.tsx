import { Switch } from "@/components/ui/switch.js";
import { Button } from "@/components/ui/button.js";
import { VisionModelSelect } from "@/components/VisionModelSelect.js";
import { useVisionAssistant, type VisionAssistantTarget } from "@/hooks/useVisionAssistant.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

export function VisionAssistantSettings(target: VisionAssistantTarget) {
  const { intl } = useZCodeIntl();
  const vision = useVisionAssistant(target);
  const status = vision.loading
    ? "vision.loading"
    : vision.unavailableReason === "remote-waiting"
      ? "vision.remoteWaiting"
      : vision.unavailableReason === "missing-target"
        ? "vision.workspaceRequired"
        : !vision.plugin
          ? "vision.notInstalled"
          : vision.models.state.status === "ready" && !vision.hasCandidates
            ? "vision.noModels"
            : undefined;
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
              checked={vision.hasCandidates && vision.plugin?.enabled === true}
              disabled={!vision.plugin || !vision.ready || !vision.hasCandidates || vision.pending}
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
                !vision.hasCandidates ||
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
              <div role="alert" className="flex items-center gap-2 text-ui-base text-destructive">
                <p>{vision.error}</p>
                <Button variant="ghost" size="xs" disabled={vision.pending} onClick={vision.reload}>
                  {intl.formatMessage({ id: "common.retry" })}
                </Button>
              </div>
            ) : status ? (
              <p className="text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: status })}
              </p>
            ) : undefined
          }
        />
      </SettingsGroupCard>
    </section>
  );
}
