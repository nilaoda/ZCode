import { useState, type KeyboardEvent } from "react";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ProviderModelsResult } from "@zcode/services";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import { modelEditorControlStyle } from "@/settings/model-provider-section/modelEditorControlStyle.js";

/** 通过供应商的 `/models` 接口拉取模型列表。 */
export type ListProviderModels = () => Promise<ProviderModelsResult>;

/**
 * 模型 ID 输入框 + 从 `/models` 拉取候选列表。
 *
 * 输入框**始终可手输**，候选列表只作建议 —— 接口不可用或未收录某个模型时不会卡住用户。
 * 候选会排除已添加的与当前已填写的，避免重复添加同一个 ID；全被过滤掉时给一句说明，
 * 否则用户点了按钮会以为没反应。
 *
 * 传 `onListProviderModels: undefined` 表示不提供该能力（由调用方按 API 格式判断）——
 * 本组件不感知格式，避免把「哪些格式支持 /models」的知识散到 UI 层。
 */
export function ProviderModelIdField({
  value,
  readOnly = false,
  autoFocus = false,
  saving = false,
  existingModelIds,
  onListProviderModels,
  onChange,
  onBlur,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
}: {
  value: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  saving?: boolean;
  /** 已添加的模型 ID，用于从候选里排除。 */
  existingModelIds?: readonly string[];
  onListProviderModels?: ListProviderModels;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [candidates, setCandidates] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const discoverEnabled = Boolean(onListProviderModels) && !readOnly;

  const handleDiscover = async () => {
    if (!onListProviderModels || state === "loading") return;
    setState("loading");
    setErrorMessage(undefined);
    setNotice(undefined);
    try {
      const result = await onListProviderModels();
      if (!result.ok) {
        setCandidates([]);
        setState("error");
        setErrorMessage(result.error.message);
        return;
      }
      const taken = new Set(existingModelIds ?? []);
      const current = value.trim();
      const remaining = result.models.filter((id) => !taken.has(id) && id !== current);
      setCandidates(remaining);
      setState("idle");
      if (remaining.length === 0) {
        setNotice(intl.formatMessage({ id: "settings.modelProvider.fetchModelsAllAdded" }));
      }
    } catch (error) {
      setCandidates([]);
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="min-w-0 flex-1">
      <label className="mb-1 block text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "settings.modelProvider.modelId" })}
      </label>
      <div className="relative">
        <Input
          {...TECHNICAL_INPUT_ATTRIBUTES}
          type="text"
          autoFocus={autoFocus}
          size="lg"
          className={cn("font-mono", discoverEnabled && "pr-10", modelEditorControlStyle(false))}
          readOnly={readOnly}
          value={value}
          placeholder={intl.formatMessage({ id: "settings.modelProvider.modelId" })}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onKeyDown={onKeyDown}
        />
        {/* 按钮同时承担「拉取」与「刷新」。 */}
        {discoverEnabled ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute right-1.5 top-1/2 -translate-y-1/2"
            aria-label={intl.formatMessage({ id: "settings.modelProvider.fetchModels" })}
            title={intl.formatMessage({ id: "settings.modelProvider.fetchModels" })}
            disabled={state === "loading" || saving}
            onClick={() => void handleDiscover()}
          >
            {state === "loading" ? (
              <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCwIcon className="size-3.5" aria-hidden="true" />
            )}
          </Button>
        ) : null}
      </div>
      {candidates.length > 0 ? (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-surface-raised p-1">
          {candidates.map((id) => (
            <li key={id}>
              <button
                type="button"
                className="w-full truncate rounded px-2 py-1 text-left font-mono text-ui-base text-foreground hover:bg-hover"
                onClick={() => {
                  onChange(id);
                  setCandidates([]);
                  setNotice(undefined);
                }}
              >
                {id}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {errorMessage ? <p className="mt-1 text-ui-base text-destructive">{errorMessage}</p> : null}
      {notice ? <p className="mt-1 text-ui-base text-foreground-subtle">{notice}</p> : null}
    </div>
  );
}
