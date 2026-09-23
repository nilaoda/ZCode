/*
 * Derived from vercel/ai-elements (packages/elements/src/reasoning.tsx).
 * Copyright 2023 Vercel, Inc. Licensed under Apache-2.0.
 * Modified by ZCode: local integration, formatting and adaptations.
 * See THIRD-PARTY-NOTICES.md in the repository root for license and provenance.
 */
"use client";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.js";
import { cn } from "../lib/utils.js";
import {
  estimateTokens,
  TID_CHAT_REASONING_CONTENT,
  TID_CHAT_REASONING_TRIGGER,
} from "@zcode/shared";
import { BrainIcon, ChevronRightIcon } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { QueuedSummaryContent } from "@/ToolCallBlocks/QueuedSummaryContent.js";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import {
  EMPTY_SCROLL_MASK_STATE,
  getVerticalScrollMaskStyle,
  resolveVerticalScrollMaskState,
  type ScrollMetrics,
  type ScrollMaskState,
} from "@/mentions/components/scrollMask.js";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  shouldRenderContent: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export const useReasoning = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
};

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  autoCollapseKey?: string | number | null;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
};

const MS_IN_S = 1000;
const REASONING_CONTENT_COLLAPSE_UNMOUNT_DELAY_MS = 300;
const REASONING_BOTTOM_LOCK_DISTANCE_PX = 2;

export function shouldAutoCollapseReasoning({
  autoCollapseKey,
  previousAutoCollapseKey,
  userInteracted,
}: {
  autoCollapseKey: string | number | null | undefined;
  previousAutoCollapseKey: string | number | null | undefined;
  userInteracted: boolean;
}) {
  return autoCollapseKey != null && autoCollapseKey !== previousAutoCollapseKey && !userInteracted;
}

export function getReasoningBottomDistance({
  clientHeight,
  scrollHeight,
  scrollTop,
}: ScrollMetrics) {
  return Math.max(0, scrollHeight - clientHeight - scrollTop);
}

export function isReasoningScrollAtBottom(metrics: ScrollMetrics) {
  return getReasoningBottomDistance(metrics) <= REASONING_BOTTOM_LOCK_DISTANCE_PX;
}

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    autoCollapseKey = null,
    open,
    defaultOpen = false,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }: ReasoningProps) => {
    const isOpenControlled = open !== undefined;
    const [isOpen, setIsOpen] = useControllableState<boolean>({
      defaultProp: defaultOpen,
      onChange: onOpenChange,
      prop: open,
    });
    const [duration, setDuration] = useControllableState<number | undefined>({
      defaultProp: undefined,
      prop: durationProp,
    });

    const startTimeRef = useRef<number | null>(null);
    const contentUnmountDelayRef = useRef<number | null>(null);
    const userInteractedRef = useRef(false);
    const previousAutoCollapseKeyRef = useRef<string | number | null>(null);
    const [shouldRenderContent, setShouldRenderContent] = useState(() => isOpen);
    const handleOpenChange = useCallback(
      (nextOpen: boolean) => {
        userInteractedRef.current = true;
        if (nextOpen) {
          setShouldRenderContent(true);
        }
        setIsOpen(nextOpen);
      },
      [setIsOpen],
    );

    useEffect(() => {
      if (!isStreaming) {
        if (startTimeRef.current !== null) {
          setDuration(Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S));
        }
        startTimeRef.current = null;
        return;
      }

      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
      }

      // 收起态展示流式摘要，不需要为了隐藏的耗时每秒触发整块 reasoning 重渲染；
      // 展开时再按同一个开始时间补算并持续更新时间。
      if (!isOpen) {
        return;
      }

      const updateDuration = () => {
        if (startTimeRef.current === null) {
          return;
        }
        setDuration(Math.max(1, Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S)));
      };

      updateDuration();
      const durationTimer = window.setInterval(updateDuration, MS_IN_S);
      return () => window.clearInterval(durationTimer);
    }, [isOpen, isStreaming, setDuration]);

    useEffect(() => {
      const previousAutoCollapseKey = previousAutoCollapseKeyRef.current;
      previousAutoCollapseKeyRef.current = autoCollapseKey;

      if (isOpenControlled) {
        return;
      }

      // 输出边界是结束收起的补充信号；用户手动操作后，自动规则不能覆盖选择。
      if (
        shouldAutoCollapseReasoning({
          autoCollapseKey,
          previousAutoCollapseKey,
          userInteracted: userInteractedRef.current,
        })
      ) {
        setIsOpen(false);
      }
    }, [autoCollapseKey, isOpenControlled, setIsOpen]);

    useEffect(() => {
      if (isOpen) {
        if (contentUnmountDelayRef.current !== null) {
          window.clearTimeout(contentUnmountDelayRef.current);
          contentUnmountDelayRef.current = null;
        }
        setShouldRenderContent(true);
        return;
      }

      if (!shouldRenderContent) {
        return;
      }

      // 思考内容收起时不能立刻卸载 children。Radix 的高度动画需要
      // closed 阶段仍能读到真实内容高度；先让 300ms 收起动画跑完，再卸载重 DOM。
      contentUnmountDelayRef.current = window.setTimeout(() => {
        setShouldRenderContent(false);
        contentUnmountDelayRef.current = null;
      }, REASONING_CONTENT_COLLAPSE_UNMOUNT_DELAY_MS);

      return () => {
        if (contentUnmountDelayRef.current !== null) {
          window.clearTimeout(contentUnmountDelayRef.current);
          contentUnmountDelayRef.current = null;
        }
      };
    }, [isOpen, shouldRenderContent]);

    useEffect(() => {
      return () => {
        if (contentUnmountDelayRef.current !== null) {
          window.clearTimeout(contentUnmountDelayRef.current);
        }
      };
    }, []);

    const contextValue = useMemo(
      () => ({ duration, isOpen, isStreaming, setIsOpen, shouldRenderContent }),
      [duration, isOpen, isStreaming, setIsOpen, shouldRenderContent],
    );

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          className={cn("not-prose flex flex-col", className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  },
);

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
  streamingText?: string;
};

export function scrollReasoningSummaryToEnd(
  viewport: Pick<HTMLElement, "scrollLeft" | "scrollWidth">,
) {
  viewport.scrollLeft = viewport.scrollWidth;
}

export function isReasoningSummaryOverflowing({
  clientWidth,
  scrollWidth,
}: Pick<HTMLElement, "clientWidth" | "scrollWidth">) {
  return scrollWidth > clientWidth + 1;
}

export function resolveReasoningStreamingSummary(
  streamingText: string,
): { key: string; text: string } | null {
  const lines = streamingText.replace(/\r\n?/gu, "\n").split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const text = lines[index]?.trim() ?? "";
    if (text.length > 0) {
      return { key: String(index), text };
    }
  }
  return null;
}

const REASONING_SUMMARY_MASK =
  "linear-gradient(to right, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)";

export function getReasoningSummaryMaskStyle(isOverflowing: boolean): CSSProperties | undefined {
  if (!isOverflowing) {
    return undefined;
  }
  return {
    WebkitMaskImage: REASONING_SUMMARY_MASK,
    maskImage: REASONING_SUMMARY_MASK,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskSize: "100% 100%",
    maskSize: "100% 100%",
  };
}

/**
 * 实时速度的刷新间隔。
 *
 * 刻意比 `Reasoning` 展开态的耗时秒表（1s）慢：这个读数是「从开始思考到现在」的**累计平均**，
 * 本身随时间收敛、两次刷新之间变化很小，刷新太快只是白白重渲染。
 * 想更灵敏就调小，想更稳就调大 —— 只影响观感，不影响读数本身。
 */
const LIVE_SPEED_REFRESH_MS = 3000;

/**
 * 流式思考中的实时速度估算，渲染成「（≈38 tok/s）」跟在「正在思考」后面。
 *
 * 为什么独立成叶子组件：收起态的 reasoning 刻意不跑每秒定时器（见 `Reasoning` 里
 * duration effect 的注释），不能因为加一个读数就把整块拉回每秒重渲染。
 * 定时器放在这里，重渲染只影响这一个 span。
 *
 * 为什么只能是估算：agent 侧的 token 计数在请求结束时才结算，流式过程中拿不到增量，
 * 因此这里用已接收文本按仓库既有的 `estimateTokens` 换算。读数带 ≈ 前缀，与完成后
 * 上下文浮窗里的精确「生成速度」区分开。
 */
const LiveReasoningSpeed = memo(function LiveReasoningSpeed({ text }: { text: string }) {
  const { intl } = useZCodeIntl();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  }, [text]);

  // 首个非空文本到达时才开始计时：把 TTFT 算进生成时间会低估速度。
  useEffect(() => {
    if (startedAt === null && text.length > 0) {
      setStartedAt(Date.now());
      setNow(Date.now());
    }
  }, [startedAt, text.length]);

  useEffect(() => {
    if (startedAt === null) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), LIVE_SPEED_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  // 依赖里刻意不含 text：文本每个 delta 都变，但读数每秒才需要刷新一次。
  // 否则长思考文本会在每次 delta 上重复做全串正则扫描。
  const label = useMemo(() => {
    if (startedAt === null) {
      return null;
    }
    const elapsedMs = now - startedAt;
    // 这是**测量窗口**下限（样本不足一秒算出来的速度没有意义），与上面的刷新间隔无关。
    if (elapsedMs < MS_IN_S) {
      return null;
    }
    const tokens = estimateTokens(textRef.current);
    if (tokens <= 0) {
      return null;
    }
    const tokensPerSecond = tokens / (elapsedMs / MS_IN_S);
    if (!Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) {
      return null;
    }
    const tps =
      tokensPerSecond >= 10
        ? String(Math.round(tokensPerSecond))
        : String(Math.round(tokensPerSecond * 10) / 10);
    return intl.formatMessage({ id: "chat.reasoning.liveTokensPerSecond" }, { tps });
  }, [intl, now, startedAt]);

  if (label === null) {
    return null;
  }
  return <span className="ml-1 font-normal text-foreground-subtle">{label}</span>;
});

export const ReasoningTrigger = memo(
  ({
    className,
    children,
    getThinkingMessage,
    streamingText = "",
    ...props
  }: ReasoningTriggerProps) => {
    const { isStreaming, isOpen, duration } = useReasoning();
    const { intl } = useZCodeIntl();
    const streamingSummary =
      isStreaming && !isOpen ? resolveReasoningStreamingSummary(streamingText) : null;
    const streamingSummaryRef = useRef<HTMLSpanElement | null>(null);
    const streamingSummaryTextRef = useRef<HTMLSpanElement | null>(null);
    const [isStreamingSummaryOverflowing, setIsStreamingSummaryOverflowing] = useState(false);

    useEffect(() => {
      const viewport = streamingSummaryRef.current;
      if (!viewport || !streamingSummary) {
        return;
      }

      const syncSummaryViewport = () => {
        setIsStreamingSummaryOverflowing((current) => {
          const next = isReasoningSummaryOverflowing(viewport);
          return current === next ? current : next;
        });
        // 流式摘要超过可用宽度后，普通 overflow-hidden 会固定显示旧前缀，
        // 最新 token 被裁在右侧。每次内容增长后把单行视口推到末尾，让旧内容向左移。
        scrollReasoningSummaryToEnd(viewport);
      };

      syncSummaryViewport();
      if (typeof ResizeObserver === "undefined") {
        return;
      }
      const resizeObserver = new ResizeObserver(syncSummaryViewport);
      resizeObserver.observe(viewport);
      if (streamingSummaryTextRef.current) {
        resizeObserver.observe(streamingSummaryTextRef.current);
      }
      return () => resizeObserver.disconnect();
    }, [streamingSummary?.text]);

    const thinkingMessage =
      getThinkingMessage?.(isStreaming, duration) ??
      (isStreaming && !isOpen ? (
        <>
          <span className="animated-gradient-text font-medium">
            {intl.formatMessage({ id: "chat.reasoning.thinking" })}
          </span>
          {/* 实时速度只在确实有文本可估算时出现；拿不到就不显示，不留占位。 */}
          {streamingText ? <LiveReasoningSpeed text={streamingText} /> : null}
        </>
      ) : duration === undefined ? (
        <span className="inline-flex items-center gap-2">
          {/* 完成态“思考”单独使用 semibold，比同列工具类型标签更粗。
              统一为 medium，保持对话时间线的视觉层级一致。 */}
          <span className="font-medium text-foreground-subtlest">
            {intl.formatMessage({ id: "chat.reasoning.thought" })}
          </span>
          <span className="font-normal text-foreground-subtlest">·</span>
          <span className="font-normal text-foreground-subtlest">
            {intl.formatMessage({ id: "chat.reasoning.durationFewSeconds" })}
          </span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-2">
          <span className="font-medium text-foreground-subtlest">
            {intl.formatMessage({ id: "chat.reasoning.thought" })}
          </span>
          <span className="font-normal text-foreground-subtlest">·</span>
          <span className="font-normal text-foreground-subtlest">
            {intl.formatMessage(
              { id: "chat.reasoning.durationSeconds" },
              { seconds: String(duration) },
            )}
          </span>
        </span>
      ));

    return (
      <CollapsibleTrigger
        data-testid={TID_CHAT_REASONING_TRIGGER}
        className={cn(
          "group/reasoning inline-flex max-w-full min-w-0 items-center gap-2 self-start text-ui-base transition-colors",
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            {/* thinking 会在长流式回复里持续存在，旋转 loader 会长期占用渲染资源；
            运行态保留文案扫光，图标固定为静态思考语义。 */}
            <BrainIcon className="size-4 shrink-0 text-foreground-subtlest" />
            {/* 右侧流式摘要是可伸缩内容；如果左侧标签也参与 flex shrink，
                长摘要会把思考状态标签挤成多行。固定语义标签宽度，只让摘要占剩余空间。 */}
            <span className="shrink-0 whitespace-nowrap" data-reasoning-label="true">
              {thinkingMessage}
            </span>
            {streamingSummary ? <span className="shrink-0 text-foreground-subtlest">·</span> : null}
            {streamingSummary ? (
              <span
                ref={streamingSummaryRef}
                className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-foreground-subtle"
                data-reasoning-streaming-mask={isStreamingSummaryOverflowing ? "both" : "none"}
                data-reasoning-streaming-line="true"
                data-reasoning-streaming-roll="true"
                style={getReasoningSummaryMaskStyle(isStreamingSummaryOverflowing)}
              >
                <QueuedSummaryContent
                  contentKey={`reasoning-line:${streamingSummary.key}`}
                  contentRefreshVersion={streamingSummary.text}
                  primaryText={
                    <span
                      ref={streamingSummaryTextRef}
                      className="inline-block min-w-max"
                      data-reasoning-streaming-text="true"
                    >
                      {streamingSummary.text}
                    </span>
                  }
                  enabled
                />
              </span>
            ) : null}
            <ChevronRightIcon
              className={cn(
                "size-4 shrink-0 text-foreground-subtlest transition-opacity transition-transform",
                isOpen
                  ? "rotate-90 opacity-100"
                  : "rotate-0 opacity-0 group-hover/reasoning:opacity-100",
              )}
            />
          </>
        )}
      </CollapsibleTrigger>
    );
  },
);

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent> & {
  children: string;
  variant?: "default" | "nested";
};

export const ReasoningContent = memo(
  ({ className, children, forceMount, variant = "default", ...props }: ReasoningContentProps) => {
    const { isOpen, shouldRenderContent } = useReasoning();
    const shouldRenderChildren = isOpen || shouldRenderContent || Boolean(forceMount);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const autoFollowBottomRef = useRef(true);
    const [scrollMaskState, setScrollMaskState] =
      useState<ScrollMaskState>(EMPTY_SCROLL_MASK_STATE);
    const updateScrollMaskState = useCallback(() => {
      const scrollNode = scrollRef.current;
      if (!scrollNode) {
        setScrollMaskState(EMPTY_SCROLL_MASK_STATE);
        return;
      }

      setScrollMaskState(
        resolveVerticalScrollMaskState({
          clientHeight: scrollNode.clientHeight,
          scrollHeight: scrollNode.scrollHeight,
          scrollTop: scrollNode.scrollTop,
        }),
      );
    }, []);
    const scrollToReasoningBottom = useCallback(() => {
      const scrollNode = scrollRef.current;
      if (!scrollNode) {
        return;
      }

      scrollNode.scrollTop = scrollNode.scrollHeight;
      updateScrollMaskState();
    }, [updateScrollMaskState]);
    const handleScroll = useCallback(() => {
      const scrollNode = scrollRef.current;
      if (!scrollNode) {
        return;
      }

      autoFollowBottomRef.current = isReasoningScrollAtBottom({
        clientHeight: scrollNode.clientHeight,
        scrollHeight: scrollNode.scrollHeight,
        scrollTop: scrollNode.scrollTop,
      });
      updateScrollMaskState();
    }, [updateScrollMaskState]);

    useEffect(() => {
      if (!shouldRenderChildren) {
        autoFollowBottomRef.current = true;
        setScrollMaskState(EMPTY_SCROLL_MASK_STATE);
        return;
      }

      const scrollNode = scrollRef.current;
      if (!scrollNode || typeof ResizeObserver === "undefined") {
        if (autoFollowBottomRef.current) {
          scrollToReasoningBottom();
        } else {
          updateScrollMaskState();
        }
        return;
      }

      // thought 内容流式追加时 scrollHeight 会变化；同时监听容器和内容尺寸。
      // 默认吸底跟随最新思考；用户主动离底后暂停，直到用户自己滚回底部再恢复。
      const syncScrollPosition = () => {
        if (autoFollowBottomRef.current) {
          scrollToReasoningBottom();
          return;
        }
        updateScrollMaskState();
      };
      syncScrollPosition();
      const resizeObserver = new ResizeObserver(syncScrollPosition);
      resizeObserver.observe(scrollNode);
      if (contentRef.current) {
        resizeObserver.observe(contentRef.current);
      }

      return () => {
        resizeObserver.disconnect();
      };
    }, [scrollToReasoningBottom, shouldRenderChildren, updateScrollMaskState]);

    useEffect(() => {
      if (!shouldRenderChildren) {
        return;
      }
      if (autoFollowBottomRef.current) {
        scrollToReasoningBottom();
        return;
      }
      updateScrollMaskState();
    }, [children, scrollToReasoningBottom, shouldRenderChildren, updateScrollMaskState]);

    const scrollMaskStyle = getVerticalScrollMaskStyle(scrollMaskState);
    const scrollMaskData =
      scrollMaskState.showTop && scrollMaskState.showBottom
        ? "both"
        : scrollMaskState.showTop
          ? "top"
          : scrollMaskState.showBottom
            ? "bottom"
            : "none";

    return (
      <CollapsibleContent
        data-reasoning-content="true"
        data-reasoning-content-variant={variant}
        data-testid={TID_CHAT_REASONING_CONTENT}
        forceMount={forceMount}
        className={className}
        {...props}
      >
        {shouldRenderChildren ? (
          <div className="pt-3">
            <div
              ref={scrollRef}
              className={cn(
                "max-h-60 space-y-2 overflow-auto text-ui-base text-foreground-subtlest",
                // CUA Group 已提供清晰的父级边界；子思考继续显示左导线与缩进会形成重复层级。
                variant === "default" && "ml-2 border-border border-l pl-3.5",
              )}
              data-reasoning-scroll-mask={scrollMaskData}
              onScroll={handleScroll}
              style={scrollMaskStyle}
            >
              {/* 思考块之前打开时把 Radix content 一起按需挂载并强制 forceMount，
                  content 首帧已经是 open 状态，高度动画来不及从 closed 状态过渡，看起来像突然展开。
                  这里和工具详情保持一致：CollapsibleContent 只负责 Presence/高度动画，重内容单独延迟卸载；
                  间距放在动画内容内部，避免 closed 动画结束时父级 gap/padding 被移除造成末帧跳动。
                  性能修复：thought 内容可能非常长且会流式追加，展开后如果继续走 MessageResponse/Streamdown，
                  每次 chunk 都会重跑 Markdown 解析和插件渲染，字数越多越卡；这里按纯文本展示并保留换行。 */}
              <div
                ref={contentRef}
                className="min-w-0 whitespace-pre-wrap break-words text-foreground-subtlest"
              >
                {children}
              </div>
            </div>
          </div>
        ) : null}
      </CollapsibleContent>
    );
  },
);

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
