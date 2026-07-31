/**
 * InkUI React App — Full-Screen Wizard
 *
 * Renders the wizard in alternate-screen mode using Ink. The layout
 * fills the terminal:
 *
 *   ┌─ ◆ Sentry Init Wizard ──────────────────── sentry.io ─┐
 *   │                                                         │
 *   │  ╔═══╗                    │  ╭ Tasks ────── 2/8 ──────╮ │
 *   │  ║ S ║  Sentry banner     │  │ ◼ Analyze project      │ │
 *   │  ╚═══╝                    │  │ ▶ Apply changes         │ │
 *   │  ● log line               │  ╰────────────────────────╯ │
 *   │  ▲ log line               │                             │
 *   │                           │  ╭ Did you know? ─────────╮ │
 *   │  ◐ spinner...             │  │ Errors → context → fix │ │
 *   │  [PromptArea]             │  │ <tip>                  │ │
 *   │                           │  ╰────────────────────────╯ │
 *   │  ● Status   Files                                       │
 *   │  ←→ switch tab                                          │
 *   │  Sentry                         $ sentry cli feedback... │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Tab 1 (Status): Banner + logs + spinner + prompts + summary
 * Tab 2 (Files): Scrollable file read tree
 */

import { Box, render as inkRender, Text } from "ink";
import Spinner from "ink-spinner";
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type BannerLine,
  bannerLinesForWidth,
  bannerLinesWidth,
} from "../../banner.js";
import {
  buildFileTree,
  buildReadTree,
  type FileTreeRow,
  flattenTree,
} from "./file-tree.js";
import {
  type FrameTab,
  getInkFrameMargin,
  getInkFrameWidth,
  InitRenderBoundary,
  ShortcutFooter,
  TabFooter,
  useInkFrameSize,
} from "./ink-frame.js";
import {
  type ShortcutBinding,
  ShortcutHintProvider,
  useInkShortcuts,
} from "./ink-shortcuts.js";
import { BLOCK_LINE_COUNT, LEARN_SEQUENCE } from "./learn-content.js";
import { SENTRY_TIPS, type SentryTip } from "./sentry-tips.js";
import type { WizardSummary } from "./types.js";
import type {
  ActivePrompt,
  FileReadEntry,
  LearnState,
  LogEntry,
  LogSeverity,
  SpinnerState,
  StepEntry,
  WizardStore,
} from "./wizard-store.js";

// ──────────────────────────── Visual constants ────────────────────────

/** Sentry blurple — primary brand accent. */
const ACCENT = "#7553FF";
const MUTED = "gray";
const MUTED_DIM = "#555555";
/** Sentry purple — spinners, in-progress states. */
const PRIMARY = "#8B6AC8";

const COLOR_INFO = "#9C84D4";
const COLOR_WARN = "#FDB81B";
const COLOR_ERROR = "#fe4144";
const COLOR_SUCCESS = "#83da90";

const ICON_BY_SEVERITY: Record<LogSeverity, { glyph: string; color?: string }> =
  {
    info: { glyph: "●", color: COLOR_INFO },
    warn: { glyph: "▲", color: COLOR_WARN },
    error: { glyph: "✖", color: COLOR_ERROR },
    success: { glyph: "✔", color: COLOR_SUCCESS },
    message: { glyph: " " },
  };

const ICONS = {
  diamond: "\u25C6",
  diamondOpen: "\u25C7",
  separator: "\u250A",
  verticalLine: "\u2502",
  squareFilled: "\u25FC",
  squareOpen: "\u25FB",
  triangleRight: "\u25B6",
  triangleSmallRight: "\u25B8",
  bullet: "\u2022",
} as const;

const DEFAULT_WELCOME_OPTIONS = {
  title: "Sentry Init",
  body: [
    "We'll use AI to inspect this project and configure Sentry.",
    "You'll choose the setup before local files change.",
  ],
  punchline: "Continue to let Sentry use AI for setup.",
};
const FEEDBACK_BANNER_TEXT = '$ sentry cli feedback "what worked or broke"';
const FEEDBACK_BANNER_FG = "#FFFFFF";

function getIntroTopPadding(rows: number): number {
  return Math.min(6, Math.max(1, Math.floor(rows * 0.18)));
}

function truncateForBanner(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  if (maxLength <= 3) {
    return text.slice(0, maxLength);
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function formatBannerBrand(cliVersion: string | null): string {
  return cliVersion ? `Sentry v${cliVersion}` : "Sentry";
}

/** @internal Exported for testing. */
export function formatFeedbackBanner(
  width: number,
  cliVersion: string | null
): string {
  const brand = formatBannerBrand(cliVersion);
  const left = ` ${brand}`;
  if (width <= left.length) {
    return left.slice(0, Math.max(0, width));
  }

  const rightPadding = 1;
  const maxRight = Math.max(0, width - left.length - rightPadding - 1);
  const clippedRight = truncateForBanner(FEEDBACK_BANNER_TEXT, maxRight);
  if (clippedRight.length === 0) {
    return left.padEnd(width, " ");
  }

  const spacerWidth = Math.max(
    1,
    width - left.length - clippedRight.length - rightPadding
  );
  return `${left}${" ".repeat(spacerWidth)}${clippedRight}${" ".repeat(rightPadding)}`;
}

// ────────────────────────────── App entry ─────────────────────────────

export type AppProps = {
  store: WizardStore;
};

export function App({ store }: AppProps): React.ReactNode {
  return (
    <ShortcutHintProvider>
      <AppBody store={store} />
    </ShortcutHintProvider>
  );
}

function AppBody({ store }: AppProps): React.ReactNode {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const { columns, rows } = useInkFrameSize();
  const [activeTab, setActiveTab] = useState(0);

  const width = getInkFrameWidth(columns);
  const contentHeight = Math.max(5, rows - 4);
  const isWide = width >= 80;

  const tabs = useMemo<FrameTab[]>(
    () => [
      { id: "status", label: "Status" },
      { id: "files", label: "Files" },
    ],
    []
  );

  const appShortcuts = useMemo<ShortcutBinding[]>(() => {
    const bindings: ShortcutBinding[] = [
      {
        key: "ctrl+c",
        action: "cancel",
        priority: 0,
        showInFooter: false,
        match: (input, key) => key.ctrl && input === "c",
        run: () => snapshot.requestCancel?.(),
      },
      {
        key: "\u2190\u2192",
        action: "switch tab",
        priority: 10,
        match: (_input, key) => key.leftArrow || key.rightArrow,
        run: (_input, key) => {
          if (key.leftArrow) {
            setActiveTab((prev) => Math.max(0, prev - 1));
          }
          if (key.rightArrow) {
            setActiveTab((prev) => Math.min(tabs.length - 1, prev + 1));
          }
        },
      },
    ];
    return bindings;
  }, [snapshot.requestCancel, tabs.length]);
  useInkShortcuts("init-app", appShortcuts, {
    isActive: snapshot.layout === "workflow" && snapshot.prompt === null,
  });

  if (snapshot.layout === "intro" || snapshot.prompt?.kind === "welcome") {
    const inner = (
      <Box
        flexDirection="column"
        height={rows}
        marginLeft={getInkFrameMargin(columns, width)}
        width={width}
      >
        <Box
          alignItems="center"
          flexDirection="column"
          flexGrow={1}
          paddingTop={getIntroTopPadding(rows)}
        >
          <IntroScreen
            bannerRows={snapshot.bannerRows}
            logs={snapshot.logs}
            prompt={snapshot.prompt}
            spinner={snapshot.spinner}
            width={width}
          />
        </Box>
        <FeedbackBanner cliVersion={snapshot.cliVersion} width={width} />
      </Box>
    );
    return (
      <InitRenderBoundary errorColor={COLOR_ERROR}>{inner}</InitRenderBoundary>
    );
  }

  const inner = (
    <Box
      flexDirection="column"
      height={rows}
      marginLeft={getInkFrameMargin(columns, width)}
      width={width}
    >
      <Box flexDirection="column" flexGrow={1} paddingTop={1}>
        <Box flexDirection="column" height={contentHeight}>
          <Box
            flexDirection="row"
            flexGrow={1}
            flexShrink={1}
            gap={isWide ? 1 : 0}
            overflow="hidden"
          >
            <Box flexDirection="column" flexGrow={1} overflow="hidden">
              {activeTab === 0 ? (
                <ActivityPane
                  logs={snapshot.logs}
                  prompt={snapshot.prompt}
                  spinner={snapshot.spinner}
                  summary={snapshot.summary}
                />
              ) : (
                <FilesScreen
                  filesRead={snapshot.filesRead}
                  hasActivePrompt={snapshot.prompt !== null}
                  terminalRows={rows}
                />
              )}
            </Box>
            {isWide ? (
              <Sidebar
                learnState={snapshot.learnState}
                steps={snapshot.steps}
                terminalRows={rows}
                tipIndex={snapshot.tipIndex}
              />
            ) : null}
          </Box>

          {snapshot.overlay ? (
            <OverlayPanel overlay={snapshot.overlay} />
          ) : null}

          <TabFooter
            activeColor={ACCENT}
            activeGlyph={ICONS.bullet}
            activeTab={activeTab}
            inactiveColor={MUTED_DIM}
            tabs={tabs}
          />
          <ShortcutFooter color={MUTED_DIM} />
          <FeedbackBanner cliVersion={snapshot.cliVersion} width={width} />
        </Box>
      </Box>
    </Box>
  );

  return (
    <InitRenderBoundary errorColor={COLOR_ERROR}>{inner}</InitRenderBoundary>
  );
}

// ────────────────────────────── Sidebar ───────────────────────────────

function Sidebar({
  learnState,
  steps,
  terminalRows,
  tipIndex,
}: {
  learnState: LearnState;
  steps: StepEntry[];
  terminalRows: number;
  tipIndex: number;
}): React.ReactNode {
  const showTips = terminalRows >= 24;
  return (
    <Box flexDirection="column" overflow="hidden" width="40%">
      <ProgressPanel steps={steps} />
      {showTips ? (
        <>
          <Box height={1} />
          {learnState.complete ? (
            <TipPanel tipIndex={tipIndex} />
          ) : (
            <LearnPanel learnState={learnState} />
          )}
        </>
      ) : null}
    </Box>
  );
}

// ─────────────────────────── Activity Pane ────────────────────────────

function ActivityPane({
  logs,
  spinner,
  prompt,
  summary,
}: {
  logs: LogEntry[];
  spinner: SpinnerState;
  prompt: ActivePrompt | null;
  summary: WizardSummary | null;
}): React.ReactNode {
  const visibleLogs =
    prompt === null
      ? logs
      : logs.filter(
          (log) => log.severity === "warn" || log.severity === "error"
        );
  const hasContent =
    visibleLogs.length > 0 ||
    spinner.active ||
    prompt !== null ||
    summary !== null;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {hasContent ? null : (
        <Box flexDirection="column" paddingTop={1}>
          <Box gap={1}>
            <Text color={PRIMARY}>
              <Spinner type="dots" />
            </Text>
            <Text dimColor>Initializing wizard...</Text>
          </Box>
        </Box>
      )}
      {visibleLogs.length > 0 ? (
        <Box flexDirection="column">
          {visibleLogs.map((log) => (
            <LogLine entry={log} key={log.id} />
          ))}
        </Box>
      ) : null}
      {spinner.active ? <SpinnerRow state={spinner} /> : null}
      {summary ? <SummaryPanel summary={summary} /> : null}
      {prompt ? <PromptArea prompt={prompt} /> : null}
    </Box>
  );
}

// ─────────────────────────── Files Screen ─────────────────────────────

function FilesScreen({
  filesRead,
  hasActivePrompt,
  terminalRows,
}: {
  filesRead: FileReadEntry[];
  hasActivePrompt: boolean;
  terminalRows: number;
}): React.ReactNode {
  if (filesRead.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingTop={1} paddingX={1}>
        <Text dimColor>No files read yet...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <FilesPanel
        filesRead={filesRead}
        hasActivePrompt={hasActivePrompt}
        maxRows={Math.max(4, terminalRows - 10)}
      />
    </Box>
  );
}

// ──────────────────────────── Outro Screen ────────────────────────────

// ──────────────────────────── Overlay ─────────────────────────────────

function OverlayPanel({
  overlay,
}: {
  overlay: NonNullable<import("./wizard-store.js").Overlay>;
}): React.ReactNode {
  return (
    <Box
      borderColor={COLOR_WARN}
      borderStyle="round"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
    >
      <Box gap={1}>
        <Text color={COLOR_WARN}>▲</Text>
        <Text bold>{overlay.message}</Text>
      </Box>
      {overlay.retryCount > 0 ? (
        <Box paddingLeft={3}>
          <Text dimColor>Retry {overlay.retryCount}...</Text>
        </Box>
      ) : null}
    </Box>
  );
}

// ──────────────────────────── Components ──────────────────────────────

type ChoiceRow<T extends string> = {
  value: T;
  label: string;
  hint?: string;
};

function useChoiceNavigation<T extends string>({
  choices,
  onChoose,
  onCancel,
  scope,
}: {
  choices: ChoiceRow<T>[];
  onChoose: (value: T) => void;
  onCancel: () => void;
  scope: string;
}): number {
  const [highlighted, setHighlighted] = useState(0);
  const totalCount = choices.length;

  const shortcuts = useMemo<ShortcutBinding[]>(
    () => [
      {
        key: "\u2191\u2193",
        action: "navigate",
        priority: 40,
        match: (_input, key) => key.upArrow || key.downArrow,
        run: (_input, key) => {
          if (key.upArrow) {
            setHighlighted((idx) => (idx === 0 ? totalCount - 1 : idx - 1));
            return;
          }
          setHighlighted((idx) => (idx + 1) % totalCount);
        },
      },
      {
        key: "enter",
        action: "select",
        priority: 41,
        match: (_input, key) => key.return,
        run: () => {
          const current = choices[highlighted];
          if (current) {
            onChoose(current.value);
          }
        },
      },
      {
        key: "esc",
        action: "cancel",
        priority: 42,
        match: (input, key) => key.escape || (key.ctrl && input === "c"),
        run: onCancel,
      },
    ],
    [choices, highlighted, onCancel, onChoose, totalCount]
  );
  useInkShortcuts(scope, shortcuts);

  return highlighted;
}

function ActionList<T extends string>({
  centered = false,
  choices,
  highlighted,
}: {
  centered?: boolean;
  choices: ChoiceRow<T>[];
  highlighted: number;
}): React.ReactNode {
  const listWidth = centered ? "100%" : undefined;
  return (
    <Box flexDirection="column" width={listWidth}>
      {choices.map((choice, index) => {
        const isCursor = index === highlighted;
        // biome-ignore lint/nursery/noLeakedRender: variable assignment, not JSX expression
        const labelColor = isCursor ? undefined : MUTED;
        if (centered) {
          return (
            <Box
              flexDirection="row"
              justifyContent="center"
              key={choice.value}
              width="100%"
            >
              <Text color={ACCENT}>
                {isCursor ? `${ICONS.triangleSmallRight} ` : "  "}
              </Text>
              <Text bold={isCursor} color={labelColor}>
                {choice.label}
              </Text>
              {choice.hint ? (
                <Text color={MUTED_DIM}> {choice.hint}</Text>
              ) : null}
            </Box>
          );
        }
        return (
          <Box flexDirection="row" key={choice.value}>
            <Box flexShrink={0} width={4}>
              <Text color={ACCENT}>
                {isCursor ? ICONS.triangleSmallRight : " "}
              </Text>
            </Box>
            <Text bold={isCursor} color={labelColor}>
              {choice.label}
            </Text>
            {choice.hint ? <Text color={MUTED_DIM}> {choice.hint}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}

function FeedbackBanner({
  cliVersion,
  width,
}: {
  cliVersion: string | null;
  width: number;
}): React.ReactNode {
  return (
    <Box flexShrink={0} height={1}>
      <Text backgroundColor={ACCENT} color={FEEDBACK_BANNER_FG}>
        {formatFeedbackBanner(width, cliVersion)}
      </Text>
    </Box>
  );
}

// ─────────────────────────── Intro Screen ────────────────────────────

function IntroScreen({
  bannerRows,
  logs,
  prompt,
  spinner,
  width,
}: {
  bannerRows: BannerLine[];
  logs: LogEntry[];
  prompt: ActivePrompt | null;
  spinner: SpinnerState;
  width: number;
}): React.ReactNode {
  const welcomePrompt = prompt?.kind === "welcome" ? prompt : null;
  const options = welcomePrompt?.options ?? DEFAULT_WELCOME_OPTIONS;
  const bodyWidth = Math.min(width, 84);
  // Use the provided banner rows if they fit; if they're too wide for the
  // current terminal, downsize to the widest variant that fits so the banner
  // never wraps on resize. An explicitly-empty list means "no banner".
  const banner =
    bannerRows.length === 0 || bannerLinesWidth(bannerRows) <= bodyWidth
      ? bannerRows
      : bannerLinesForWidth(bodyWidth);
  // Center the banner as one unit; centering rows separately shifts shorter rows.
  const bannerWidth = bannerLinesWidth(banner);

  return (
    <Box alignItems="center" flexDirection="column" width={bodyWidth}>
      <Box
        flexDirection="column"
        marginBottom={welcomePrompt ? 2 : 1}
        width={bannerWidth}
      >
        {banner.map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional banner rows
          <Text color={row.color} key={i}>
            {row.content}
          </Text>
        ))}
      </Box>
      {welcomePrompt ? (
        <Box alignItems="center" flexDirection="column" marginBottom={1}>
          {options.body.map((line) => (
            <Text key={line}>{line}</Text>
          ))}
        </Box>
      ) : null}
      {welcomePrompt ? (
        <>
          <Box marginBottom={2}>
            <Text bold>{options.punchline}</Text>
          </Box>
          <WelcomeActions prompt={welcomePrompt} />
        </>
      ) : null}
      {welcomePrompt ? null : (
        <IntroPreflightContent logs={logs} prompt={prompt} spinner={spinner} />
      )}
    </Box>
  );
}

function WelcomeActions({
  prompt,
}: {
  prompt: Extract<ActivePrompt, { kind: "welcome" }>;
}): React.ReactNode {
  const choices = useMemo<ChoiceRow<"continue" | "cancel">[]>(
    () => [
      { value: "continue", label: "Continue" },
      { value: "cancel", label: "Cancel" },
    ],
    []
  );
  const onChoose = useCallback(
    (value: "continue" | "cancel") => {
      if (value === "cancel") {
        prompt.resolve(null);
        return;
      }
      prompt.resolve("continue");
    },
    [prompt]
  );
  const highlighted = useChoiceNavigation({
    choices,
    onChoose,
    onCancel: () => prompt.resolve(null),
    scope: "welcome-screen",
  });

  return (
    <Box>
      <ActionList centered choices={choices} highlighted={highlighted} />
    </Box>
  );
}

function IntroPreflightContent({
  logs,
  prompt,
  spinner,
}: {
  logs: LogEntry[];
  prompt: ActivePrompt | null;
  spinner: SpinnerState;
}): React.ReactNode {
  const visibleLogs = prompt ? [] : logs.slice(-5);
  const hasContent =
    visibleLogs.length > 0 || spinner.active || prompt !== null;

  if (!hasContent) {
    return null;
  }

  const promptContent = prompt ? (
    <Box alignItems="center" width="100%">
      <PromptArea alignment="center" prompt={prompt} />
    </Box>
  ) : null;

  return (
    <Box flexDirection="column" flexShrink={0} marginTop={1} width="100%">
      {visibleLogs.length > 0 ? (
        <Box alignItems="center" flexDirection="column">
          {visibleLogs.map((log) => (
            <LogLine entry={log} key={log.id} />
          ))}
        </Box>
      ) : null}
      {spinner.active ? (
        <Box justifyContent="center">
          <SpinnerRow state={spinner} />
        </Box>
      ) : null}
      {promptContent}
    </Box>
  );
}

function LogLine({ entry }: { entry: LogEntry }): React.ReactNode {
  const { glyph, color } = ICON_BY_SEVERITY[entry.severity];
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Box flexShrink={0} width={3}>
        <Text color={color}>{glyph}</Text>
      </Box>
      <Text wrap="truncate">{entry.text}</Text>
    </Box>
  );
}

function SpinnerRow({ state }: { state: SpinnerState }): React.ReactNode {
  return (
    <Box flexDirection="row" flexShrink={0} marginTop={1}>
      <Box flexShrink={0} width={3}>
        <Text color={PRIMARY}>
          <Spinner type="dots" />
        </Text>
      </Box>
      <Text>{state.message}</Text>
    </Box>
  );
}

// ──────────────────────────── Tip Panel ──────────────────────────────

function TipPanel({ tipIndex }: { tipIndex: number }): React.ReactNode {
  const tip = SENTRY_TIPS[tipIndex % SENTRY_TIPS.length] as SentryTip;
  const total = SENTRY_TIPS.length;
  const oneIndexed = (tipIndex % total) + 1;
  return (
    <Box
      borderColor={MUTED_DIM}
      borderStyle="round"
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
    >
      <Text bold color={MUTED}>
        {ICONS.diamondOpen} Did you know?
      </Text>
      <Box height={1} />
      <Text bold color={ACCENT}>
        {tip.title}
      </Text>
      <Text wrap="wrap">{tip.body}</Text>
      <Box height={1} />
      <Box justifyContent="flex-end">
        <Text color={MUTED_DIM}>
          {oneIndexed}/{total}
        </Text>
      </Box>
    </Box>
  );
}

// ─────────────────────────── Learn Panel ──────────────────────────────

function LearnPanel({
  learnState,
}: {
  learnState: LearnState;
}): React.ReactNode {
  const block = LEARN_SEQUENCE[learnState.blockIndex];
  if (!block) {
    return null;
  }
  // Pad short blocks to BLOCK_LINE_COUNT so height stays fixed.
  const lines = block.lines.slice(0, BLOCK_LINE_COUNT);
  const padding = Math.max(0, BLOCK_LINE_COUNT - lines.length);
  return (
    <Box
      borderColor={MUTED_DIM}
      borderStyle="round"
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text bold color={ACCENT}>
          {block.title}
        </Text>
        <Text color={MUTED_DIM}>
          {learnState.blockIndex + 1}/{LEARN_SEQUENCE.length}
        </Text>
      </Box>
      <Box height={1} />
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional content lines
        <Text key={i}>{line || " "}</Text>
      ))}
      {Array.from({ length: padding }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional filler
        <Text key={`p${i}`}> </Text>
      ))}
    </Box>
  );
}

// ────────────────────────── Progress Panel ────────────────────────────

function ProgressPanel({ steps }: { steps: StepEntry[] }): React.ReactNode {
  const completedCount = steps.filter(
    (entry) => entry.status === "completed"
  ).length;
  const totalCount = steps.length;

  const headerRight = totalCount > 0 ? `${completedCount}/${totalCount}` : "";
  const badgeColor = completedCount === totalCount ? COLOR_SUCCESS : MUTED_DIM;

  return (
    <Box
      borderColor={MUTED_DIM}
      borderStyle="round"
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text bold color={MUTED}>
          {ICONS.diamondOpen} Tasks
        </Text>
        {headerRight ? <Text color={badgeColor}>{headerRight}</Text> : null}
      </Box>
      <Box height={1} />
      {steps.length === 0 ? (
        <Box gap={1}>
          <Text color={PRIMARY}>
            <Spinner type="dots" />
          </Text>
          <Text dimColor>Analyzing project...</Text>
        </Box>
      ) : null}
      {steps.map((entry) => (
        <ProgressRow entry={entry} key={entry.id} />
      ))}
    </Box>
  );
}

function ProgressRow({ entry }: { entry: StepEntry }): React.ReactNode {
  const { glyph, glyphColor, labelColor, dimLabel } = progressStyle(entry);
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Box flexShrink={0} width={3}>
        <Text color={glyphColor}>{glyph}</Text>
      </Box>
      <Text color={labelColor} dimColor={dimLabel}>
        {entry.label}
      </Text>
    </Box>
  );
}

function progressStyle(entry: StepEntry): {
  glyph: string;
  glyphColor: string;
  labelColor?: string;
  dimLabel: boolean;
} {
  if (entry.status === "in_progress") {
    return {
      glyph: ICONS.triangleRight,
      glyphColor: PRIMARY,
      dimLabel: false,
    };
  }
  if (entry.status === "completed") {
    return {
      glyph: ICONS.squareFilled,
      glyphColor: COLOR_SUCCESS,
      labelColor: MUTED,
      dimLabel: false,
    };
  }
  if (entry.status === "failed") {
    return {
      glyph: "\u2716",
      glyphColor: COLOR_ERROR,
      labelColor: COLOR_ERROR,
      dimLabel: false,
    };
  }
  if (entry.status === "skipped") {
    return {
      glyph: "\u25CC",
      glyphColor: MUTED_DIM,
      labelColor: MUTED_DIM,
      dimLabel: true,
    };
  }
  return {
    glyph: ICONS.squareOpen,
    glyphColor: MUTED_DIM,
    labelColor: MUTED,
    dimLabel: true,
  };
}

// ─────────────────────────── Files Panel ──────────────────────────────

function FilesPanel({
  filesRead,
  maxRows,
  hasActivePrompt,
}: {
  filesRead: FileReadEntry[];
  maxRows: number;
  hasActivePrompt: boolean;
}): React.ReactNode {
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [offset, setOffset] = useState(0);

  const tree = buildReadTree(filesRead);
  const rows = flattenTree(tree);
  const totalRows = rows.length;

  const viewport = Math.max(1, maxRows - 1);
  const canScroll = totalRows > viewport;

  const maxOffset = Math.max(0, totalRows - viewport);
  const effectiveOffset = pinnedToBottom ? 0 : Math.min(offset, maxOffset);

  const sliceEnd = totalRows - effectiveOffset;
  const sliceStart = Math.max(0, sliceEnd - viewport);
  const visible = rows.slice(sliceStart, sliceEnd);

  const prevTotalRef = useRef(totalRows);
  useEffect(() => {
    const prev = prevTotalRef.current;
    prevTotalRef.current = totalRows;
    if (pinnedToBottom) {
      return;
    }
    const newMax = Math.max(0, totalRows - viewport);
    if (totalRows > prev) {
      setOffset((current) => Math.min(newMax, current + (totalRows - prev)));
    } else if (totalRows < prev) {
      setOffset((current) => Math.min(current, newMax));
    }
  }, [totalRows, viewport, pinnedToBottom]);

  const fileShortcuts = useMemo<ShortcutBinding[]>(() => {
    if (!canScroll) {
      return [];
    }
    return [
      {
        key: "\u2191\u2193",
        action: "scroll",
        priority: 30,
        match: (_input, key) => key.upArrow || key.downArrow,
        run: (_input, key) => {
          if (key.upArrow) {
            setPinnedToBottom(false);
            setOffset((current) => Math.min(maxOffset, current + 1));
            return;
          }
          setOffset((current) => {
            const next = Math.max(0, current - 1);
            if (next === 0) {
              setPinnedToBottom(true);
            }
            return next;
          });
        },
      },
      {
        key: "page",
        action: "scroll",
        priority: 31,
        showInFooter: false,
        match: (_input, key) => key.pageUp || key.pageDown,
        run: (_input, key) => {
          if (key.pageUp) {
            setPinnedToBottom(false);
            setOffset((current) => Math.min(maxOffset, current + viewport));
            return;
          }
          setOffset((current) => {
            const next = Math.max(0, current - viewport);
            if (next === 0) {
              setPinnedToBottom(true);
            }
            return next;
          });
        },
      },
      {
        key: "home/end",
        action: "jump",
        priority: 32,
        showInFooter: false,
        match: (_input, key) => key.home || key.end,
        run: (_input, key) => {
          if (key.home) {
            setPinnedToBottom(false);
            setOffset(maxOffset);
            return;
          }
          setPinnedToBottom(true);
          setOffset(0);
        },
      },
    ];
  }, [canScroll, maxOffset, viewport]);
  useInkShortcuts("files-panel", fileShortcuts, {
    isActive: !hasActivePrompt && canScroll,
  });

  if (filesRead.length === 0) {
    return null;
  }

  const analyzedCount = filesRead.filter(
    (entry) => entry.status === "analyzed"
  ).length;
  const padding = Math.max(0, viewport - visible.length);

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box justifyContent="space-between">
        <Text bold color={MUTED}>
          Files analyzed
        </Text>
        <Text color={MUTED_DIM}>
          {pinnedToBottom ? "" : "\u2191 "}
          {analyzedCount}/{filesRead.length}
        </Text>
      </Box>
      <Box height={1} />
      <Box flexDirection="row">
        <Box flexDirection="column" flexGrow={1}>
          {visible.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional read-tree rows
            <ReadTreeLine key={`r${i}`} row={row} />
          ))}
          {Array.from({ length: padding }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional filler
            <Text key={`p${i}`}> </Text>
          ))}
        </Box>
        {canScroll ? (
          <Scrollbar
            offset={effectiveOffset}
            totalRows={totalRows}
            viewport={viewport}
          />
        ) : null}
      </Box>
    </Box>
  );
}

function Scrollbar({
  offset,
  totalRows,
  viewport,
}: {
  offset: number;
  totalRows: number;
  viewport: number;
}): React.ReactNode {
  const maxOff = Math.max(1, totalRows - viewport);
  const thumbSize = Math.max(1, Math.floor((viewport * viewport) / totalRows));
  const trackSpan = Math.max(1, viewport - thumbSize);
  const thumbStart = Math.round(((maxOff - offset) / maxOff) * trackSpan);
  const cells = Array.from({ length: viewport }, (_v, i) => {
    const inThumb = i >= thumbStart && i < thumbStart + thumbSize;
    return inThumb ? "\u2588" : ICONS.verticalLine;
  });
  return (
    <Box flexDirection="column" flexShrink={0} marginLeft={1}>
      {cells.map((cell, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional scrollbar
        <Text color={MUTED_DIM} key={i}>
          {cell}
        </Text>
      ))}
    </Box>
  );
}

function ReadTreeLine({ row }: { row: FileTreeRow }): React.ReactNode {
  if (row.kind === "directory") {
    return (
      <Box flexDirection="row" flexShrink={0}>
        <Text color={MUTED_DIM}>{`${row.prefix}${row.branch} `}</Text>
        <Text>{row.label}</Text>
      </Box>
    );
  }
  const { glyph, glyphColor, labelColor } = readStatusStyle(row.status);
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Text color={MUTED_DIM}>{`${row.prefix}${row.branch} `}</Text>
      <Text color={glyphColor}>{`${glyph} `}</Text>
      <Text color={labelColor}>{row.label}</Text>
    </Box>
  );
}

function readStatusStyle(status: FileTreeRow["status"]): {
  glyph: string;
  glyphColor: string;
  labelColor?: string;
} {
  if (status === "reading") {
    return { glyph: "\u25D0", glyphColor: PRIMARY };
  }
  return { glyph: "\u2713", glyphColor: COLOR_SUCCESS, labelColor: MUTED };
}

// ────────────────────────────── Summary ───────────────────────────────

function SummaryPanel({
  summary,
}: {
  summary: WizardSummary;
}): React.ReactNode {
  return (
    <Box
      borderBottom={false}
      borderColor={MUTED_DIM}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      flexDirection="column"
      flexShrink={0}
      marginTop={1}
      paddingTop={1}
    >
      {summary.fields.length > 0 ? (
        <Box flexDirection="column" flexShrink={0}>
          {summary.fields.map((field) => (
            <Box flexDirection="row" flexShrink={0} key={field.label}>
              <Box flexShrink={0} width={14}>
                <Text color={MUTED}>{field.label}</Text>
              </Box>
              <Text bold>{field.value}</Text>
            </Box>
          ))}
        </Box>
      ) : null}
      {summary.featureBlurbs !== undefined &&
      summary.featureBlurbs.length > 0 ? (
        <Box flexDirection="column" flexShrink={0} marginTop={1}>
          <Text bold color={MUTED}>
            Here&apos;s what we set up
          </Text>
          {summary.featureBlurbs.map(({ label, blurb }) => (
            <Box flexDirection="row" flexShrink={0} key={label}>
              <Box flexShrink={0} width={22}>
                <Text bold color={PRIMARY}>
                  {label}
                </Text>
              </Box>
              <Box flexShrink={1}>
                <Text color={MUTED} wrap="wrap">
                  {blurb}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}
      {summary.changedFiles !== undefined && summary.changedFiles.length > 0 ? (
        <ChangedFilesTree files={summary.changedFiles} />
      ) : null}
    </Box>
  );
}

function ChangedFilesTree({
  files,
}: {
  files: { action: string; path: string }[];
}): React.ReactNode {
  const tree = buildFileTree(files);
  const treeRows = flattenTree(tree);
  return (
    <Box flexDirection="column" flexShrink={0} marginTop={1}>
      <Text bold color={MUTED}>
        Changed files
      </Text>
      {treeRows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional tree rows
        <FileTreeLine key={i} row={row} />
      ))}
    </Box>
  );
}

function FileTreeLine({ row }: { row: FileTreeRow }): React.ReactNode {
  if (row.kind === "directory") {
    return (
      <Box flexDirection="row" flexShrink={0}>
        <Text color={MUTED_DIM}>{`${row.prefix}${row.branch} `}</Text>
        <Text>{row.label}</Text>
      </Box>
    );
  }
  const { glyph, color } = changedFileStyle(row.action ?? "modify");
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Text color={MUTED_DIM}>{`${row.prefix}${row.branch} `}</Text>
      <Text color={color}>{`${glyph} `}</Text>
      <Text>{row.label}</Text>
    </Box>
  );
}

function changedFileStyle(action: string): { glyph: string; color: string } {
  if (action === "create") {
    return { glyph: "+", color: COLOR_SUCCESS };
  }
  if (action === "delete") {
    return { glyph: "\u2212", color: COLOR_ERROR };
  }
  return { glyph: "~", color: COLOR_WARN };
}

// ─────────────────────────────── Prompts ──────────────────────────────

type PromptAlignment = "start" | "center";
type SelectPromptOptionData = Extract<
  ActivePrompt,
  { kind: "select" }
>["options"][number];
type MultiSelectPromptOptionData = Extract<
  ActivePrompt,
  { kind: "multiselect" }
>["options"][number];

function PromptArea({
  alignment = "start",
  prompt,
}: {
  alignment?: PromptAlignment;
  prompt: ActivePrompt;
}): React.ReactNode {
  if (prompt.kind === "select") {
    return <SelectPrompt alignment={alignment} prompt={prompt} />;
  }
  if (prompt.kind === "confirm") {
    return <ConfirmPrompt alignment={alignment} prompt={prompt} />;
  }
  if (prompt.kind === "multiselect") {
    return <MultiSelectPrompt alignment={alignment} prompt={prompt} />;
  }
  return null;
}

function SelectPrompt({
  alignment,
  prompt,
}: {
  alignment: PromptAlignment;
  prompt: Extract<ActivePrompt, { kind: "select" }>;
}): React.ReactNode {
  const isCentered = alignment === "center";
  const promptWidth = isCentered ? "100%" : undefined;
  const totalCount = prompt.options.length;
  const [highlighted, setHighlighted] = useState<number>(() =>
    Math.min(Math.max(prompt.initialIndex, 0), Math.max(0, totalCount - 1))
  );

  const shortcuts = useMemo<ShortcutBinding[]>(
    () => [
      {
        key: "\u2191\u2193",
        action: "navigate",
        priority: 40,
        match: (_input, key) => key.upArrow || key.downArrow,
        run: (_input, key) => {
          if (key.upArrow) {
            setHighlighted((idx) => (idx === 0 ? totalCount - 1 : idx - 1));
            return;
          }
          setHighlighted((idx) => (idx + 1) % totalCount);
        },
      },
      {
        key: "enter",
        action: "confirm",
        priority: 41,
        match: (_input, key) => key.return,
        run: () => {
          const current = prompt.options[highlighted];
          if (current) {
            prompt.resolve(current.value);
          }
        },
      },
      {
        key: "esc",
        action: "cancel",
        priority: 42,
        match: (input, key) => key.escape || (key.ctrl && input === "c"),
        run: () => prompt.resolve(null),
      },
    ],
    [highlighted, prompt, totalCount]
  );
  useInkShortcuts("select-prompt", shortcuts);

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      marginTop={1}
      width={promptWidth}
    >
      {isCentered ? (
        <Box justifyContent="center" marginBottom={1} width="100%">
          <Text bold>{prompt.message}</Text>
        </Box>
      ) : (
        <Box gap={1} marginBottom={1}>
          <Text bold color={ACCENT}>
            {ICONS.diamondOpen}
          </Text>
          <Text bold>{prompt.message}</Text>
        </Box>
      )}
      <Box flexDirection="column" width={promptWidth}>
        {prompt.options.map((option, idx) => {
          const isCursor = idx === highlighted;
          return (
            <SelectPromptOptionRow
              centered={isCentered}
              isCursor={isCursor}
              key={option.value}
              option={option}
            />
          );
        })}
      </Box>
    </Box>
  );
}

function SelectPromptOptionRow({
  centered,
  isCursor,
  option,
}: {
  centered: boolean;
  isCursor: boolean;
  option: SelectPromptOptionData;
}): React.ReactNode {
  const labelColor = isCursor ? undefined : MUTED;
  if (centered) {
    return (
      <Box flexDirection="row" justifyContent="center" width="100%">
        <Text color={ACCENT}>
          {isCursor ? `${ICONS.triangleSmallRight} ` : "  "}
        </Text>
        <Text bold={isCursor} color={labelColor}>
          {option.label}
        </Text>
        {option.hint !== undefined && option.hint !== "" ? (
          <Text color={MUTED_DIM}> {option.hint}</Text>
        ) : null}
      </Box>
    );
  }
  return (
    <Box flexDirection="row">
      <Box flexShrink={0} width={3}>
        <Text color={ACCENT}>{isCursor ? ICONS.triangleSmallRight : " "}</Text>
      </Box>
      <Text bold={isCursor} color={labelColor}>
        {option.label}
      </Text>
      {option.hint !== undefined && option.hint !== "" ? (
        <Text color={MUTED_DIM}> {option.hint}</Text>
      ) : null}
    </Box>
  );
}

function ConfirmPrompt({
  alignment,
  prompt,
}: {
  alignment: PromptAlignment;
  prompt: Extract<ActivePrompt, { kind: "confirm" }>;
}): React.ReactNode {
  const isCentered = alignment === "center";
  const promptWidth = isCentered ? "100%" : undefined;
  const shortcuts = useMemo<ShortcutBinding[]>(
    () => [
      {
        key: "y/n",
        action: "answer",
        priority: 40,
        match: (input) =>
          input === "y" || input === "Y" || input === "n" || input === "N",
        run: (input) => prompt.resolve(input === "y" || input === "Y"),
      },
      {
        key: "enter",
        action: "default",
        priority: 41,
        showInFooter: false,
        match: (_input, key) => key.return,
        run: () => prompt.resolve(prompt.initialValue),
      },
      {
        key: "esc",
        action: "cancel",
        priority: 42,
        showInFooter: false,
        match: (input, key) => key.escape || (key.ctrl && input === "c"),
        run: () => prompt.resolve(null),
      },
    ],
    [prompt]
  );
  useInkShortcuts("confirm-prompt", shortcuts);

  const yLabel = prompt.initialValue ? "Y" : "y";
  const nLabel = prompt.initialValue ? "n" : "N";

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      marginTop={1}
      width={promptWidth}
    >
      {isCentered ? (
        <Box gap={1} justifyContent="center" width="100%">
          <Text bold>{prompt.message}</Text>
          <Text color={MUTED_DIM}>
            ({yLabel}/{nLabel})
          </Text>
        </Box>
      ) : (
        <Box gap={1}>
          <Text bold color={ACCENT}>
            {ICONS.diamondOpen}
          </Text>
          <Text bold>{prompt.message}</Text>
          <Text color={MUTED_DIM}>
            ({yLabel}/{nLabel})
          </Text>
        </Box>
      )}
    </Box>
  );
}

function MultiSelectPrompt({
  alignment,
  prompt,
}: {
  alignment: PromptAlignment;
  prompt: Extract<ActivePrompt, { kind: "multiselect" }>;
}): React.ReactNode {
  const isCentered = alignment === "center";
  const promptWidth = isCentered ? "100%" : undefined;
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(prompt.initialSelected)
  );
  const [highlighted, setHighlighted] = useState<number>(0);
  const totalCount = prompt.options.length;

  const toggleAt = useCallback(
    (idx: number) => {
      const current = prompt.options[idx];
      if (!current) {
        return;
      }
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(current.value)) {
          next.delete(current.value);
        } else {
          next.add(current.value);
        }
        return next;
      });
    },
    [prompt.options]
  );

  const commit = useCallback(() => {
    if (prompt.required && selected.size === 0) {
      return;
    }
    const ordered = prompt.options
      .map((option) => option.value)
      .filter((value) => selected.has(value));
    prompt.resolve(ordered);
  }, [prompt, selected]);

  const shortcuts = useMemo<ShortcutBinding[]>(
    () => [
      {
        key: "\u2191\u2193",
        action: "navigate",
        priority: 40,
        match: (_input, key) => key.upArrow || key.downArrow,
        run: (_input, key) => {
          if (key.upArrow) {
            setHighlighted((idx) => (idx === 0 ? totalCount - 1 : idx - 1));
            return;
          }
          setHighlighted((idx) => (idx + 1) % totalCount);
        },
      },
      {
        key: "space",
        action: "toggle",
        priority: 41,
        match: (input) => input === " ",
        run: () => toggleAt(highlighted),
      },
      {
        key: "a",
        action: "all",
        priority: 42,
        match: (input) => input === "a",
        run: () => {
          setSelected((prev) => {
            if (prev.size === totalCount) {
              return new Set<string>();
            }
            return new Set(prompt.options.map((option) => option.value));
          });
        },
      },
      {
        key: "enter",
        action: "confirm",
        priority: 43,
        match: (_input, key) => key.return,
        run: commit,
      },
      {
        key: "esc",
        action: "cancel",
        priority: 44,
        match: (input, key) => key.escape || (key.ctrl && input === "c"),
        run: () => prompt.resolve(null),
      },
    ],
    [commit, highlighted, prompt, toggleAt, totalCount]
  );
  useInkShortcuts("multiselect-prompt", shortcuts);
  const shortcutText = `space toggle ${ICONS.bullet} a all ${ICONS.bullet} enter confirm ${ICONS.bullet} esc cancel`;
  const selectedCount = `${selected.size}/${totalCount}`;

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      marginTop={1}
      width={promptWidth}
    >
      {isCentered ? (
        <Box justifyContent="center" marginBottom={1} width="100%">
          <Text bold>{prompt.message}</Text>
        </Box>
      ) : (
        <Box justifyContent="space-between" marginBottom={1}>
          <Box gap={1}>
            <Text bold color={ACCENT}>
              {ICONS.diamondOpen}
            </Text>
            <Text bold>{prompt.message}</Text>
          </Box>
          <Text color={ACCENT}>{selectedCount}</Text>
        </Box>
      )}
      {isCentered ? (
        <Box
          alignItems="center"
          flexDirection="column"
          marginBottom={1}
          width="100%"
        >
          <Text color={MUTED_DIM}>{shortcutText}</Text>
          <Text color={ACCENT}>{selectedCount}</Text>
        </Box>
      ) : null}
      <Box flexDirection="column" width={promptWidth}>
        {prompt.options.map((option, idx) => {
          const isSelected = selected.has(option.value);
          const isCursor = idx === highlighted;
          return (
            <MultiSelectPromptOptionRow
              centered={isCentered}
              isCursor={isCursor}
              isSelected={isSelected}
              key={option.value}
              option={option}
            />
          );
        })}
      </Box>
    </Box>
  );
}

function MultiSelectPromptOptionRow({
  centered,
  isCursor,
  isSelected,
  option,
}: {
  centered: boolean;
  isCursor: boolean;
  isSelected: boolean;
  option: MultiSelectPromptOptionData;
}): React.ReactNode {
  const marker = isSelected ? ICONS.squareFilled : ICONS.squareOpen;
  const markerColor = isSelected ? COLOR_SUCCESS : MUTED_DIM;
  if (centered) {
    return (
      <Box flexDirection="row" justifyContent="center" width="100%">
        <Text color={ACCENT}>
          {isCursor ? `${ICONS.triangleSmallRight} ` : "  "}
        </Text>
        <Text color={markerColor}>{marker} </Text>
        <Text bold={isCursor}>{option.label}</Text>
        {option.hint !== undefined && option.hint !== "" ? (
          <Text color={MUTED_DIM}> {option.hint}</Text>
        ) : null}
      </Box>
    );
  }
  return (
    <Box flexDirection="row">
      <Box flexShrink={0} width={3}>
        <Text color={ACCENT}>{isCursor ? ICONS.triangleSmallRight : " "}</Text>
      </Box>
      <Text color={markerColor}>{marker} </Text>
      <Text bold={isCursor}>{option.label}</Text>
      {option.hint !== undefined && option.hint !== "" ? (
        <Text color={MUTED_DIM}> {option.hint}</Text>
      ) : null}
    </Box>
  );
}

/**
 * Mount the wizard App component via Ink and return the Ink instance.
 *
 * This function must live inside the sidecar so it uses the same
 * `react` and `ink` copies as the App's hooks. Importing ink/react
 * separately in the main bundle and calling `ink.render()` from
 * there would create a second React instance, causing "Invalid hook
 * call" errors at runtime. By centralising the mount call here,
 * only one copy of ink + react exists.
 */
export function mountApp(
  store: WizardStore,
  options: {
    exitOnCtrlC: boolean;
    patchConsole: boolean;
    stdin?: import("node:tty").ReadStream;
  }
): {
  unmount: () => void;
  waitUntilExit: () => Promise<unknown>;
  rerender: (node: React.ReactNode) => void;
  clear: () => void;
} {
  return inkRender(createElement(App, { store }), options);
}
