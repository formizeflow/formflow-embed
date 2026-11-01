/** Type declarations for public/embed.js (the hand-written SDK, version 2.1.0). v1 options and the postMessage protocol are unchanged. */
export type EmbedMode = "inline" | "popup" | "modal" | "drawer" | "slider" | "fullscreen" | "floating" | "popover";
export type EmbedStyles = {
  width?: string | number; height?: string | number; buttonColor?: string;
  position?: "bottom-right" | "bottom-left";
  /** slider: which edge the panel slides from. Default "right". */
  side?: "left" | "right";
};
/** Chat-bubble launcher for `popover` and `floating` modes. */
export type EmbedLauncher = {
  /** Built-in icon name or an https image URL. Default "chat". */
  icon?: "chat" | "question" | "clipboard" | "star" | (string & {});
  /** Text shown next to the bubble on hover/focus. */
  tooltip?: string;
  /** Accessible name (defaults to the tooltip). */
  label?: string;
  color?: string;
  position?: "bottom-right" | "bottom-left";
};
/** Opens the popup automatically. Multiple conditions: the first to happen wins. */
export type EmbedTrigger = {
  exitIntent?: boolean;
  /** Open after the visitor scrolled this far down the page (0-100). */
  scrollPercent?: number;
  /** Seconds after load. */
  delay?: number;
  /** Fire at most once per browser session (sessionStorage). Default true. */
  once?: boolean;
};
export type EmbedOptions = {
  mode?: EmbedMode;
  baseUrl?: string;
  prefill?: Record<string, string | number | boolean>;
  hidden?: Record<string, string | number | boolean>;
  /** Copy host-page query params to the form: true (all), an allow-list, or v1's passQueryParams. */
  transitiveSearchParams?: boolean | string[];
  passQueryParams?: boolean | string[];
  /** Prefill from the host URL: true (every param), a list of param names, or { fieldId: "paramName" }. */
  prefillFromUrl?: boolean | string[] | Record<string, string>;
  /** Prefill from Google Tag Manager's window.dataLayer: { fieldId: "key.or.dotted.path" }; newest entry wins. */
  prefillFromDataLayer?: Record<string, string>;
  /** Close the popup/slider this many ms after submit (true = 3000). */
  autoClose?: boolean | number;
  launcher?: boolean | EmbedLauncher;
  trigger?: EmbedTrigger;
  /** Set false to skip the theme-matched loading skeleton. */
  placeholder?: boolean;
  respondent?: Record<string, string | number | boolean>;
  /** Stable user id of your product; the server uses it for experiments and resume. Defaults to the id passed to identify(). */
  uid?: string;
  /** HMAC signature of uid computed on YOUR server (never in the browser). */
  uidSignature?: string;
  /** User attributes, sent as attrs.<key>. */
  attributes?: Record<string, string | number | boolean>;
  /** Read window.posthog for the session and distinct id. */
  posthog?: boolean;
  posthogSessionId?: string;
  posthogDistinctId?: string;
  autoResize?: boolean;
  buttonText?: string;
  title?: string;
  styles?: EmbedStyles;
  onReady?: (data: { slug: string }) => void;
  onSubmit?: (data: { submissionId: string; outcome: { passed?: boolean; outcomeId?: string; endingId?: string } }) => void;
  onProgress?: (data: { step: number; total: number; percent: number }) => void;
  onError?: (data: { message: string }) => void;
  /** The visitor is in a test's holdout, so no form is shown. Default: the embed is removed (inline) or closed (overlays). */
  onHoldout?: (data: { experimentId: string; redirectUrl?: string }) => void;
  onClose?: () => void;
};
export type EmbedWidget = { iframe: HTMLIFrameElement | null; open(): void; close(): void; destroy(): void };
export interface FormFlowGlobal {
  version: "2.1.0";
  init(opts?: { baseUrl?: string; workspace?: string; widget?: EmbedOptions }): void;
  open(slug: string, opts?: EmbedOptions): EmbedWidget;
  close(): void;
  createWidget(el: HTMLElement, slug: string, opts?: EmbedOptions): EmbedWidget;
  identify(userId: string | number, attributes?: Record<string, string | number | boolean | null>): void;
  track(event: string): void;
  decide(opts: { entry: string; uid?: string; uidSignature?: string; attributes?: Record<string, string | number | boolean>; baseUrl?: string; timeoutMs?: number; posthog?: boolean; posthogSessionId?: string; posthogDistinctId?: string }): Promise<OnboardingDecision>;
}
declare global { interface Window { FormFlow?: FormFlowGlobal; dataLayer?: unknown[] } }

/** Protocol v3 (native WebViews, `?native=1`). Envelope posted to the platform bridge. */
export type NativeEvent =
  | { type: "ready"; data: { formId: string; versionId?: string; experimentId?: string; variantId?: string; locale: string } }
  | { type: "view" | "start" | "close"; data: Record<string, never> }
  | { type: "holdout"; experimentId: string; data: { experimentId: string; redirectUrl?: string } }
  | { type: "step"; data: { index: number; fieldId: string; total: number } }
  | { type: "answer"; data: { fieldId: string; type: string; value?: unknown } }
  | { type: "complete" | "submit"; data: { submissionId: string; queued?: boolean; outcome: { passed?: boolean; outcomeId?: string; endingId?: string }; endingId?: string; durationMs?: number } }
  | { type: "progress"; data: { step: number; total: number; percent: number } }
  | { type: "resize"; data: { height: number } }
  | { type: "error"; data: { message: string } };
export type NativeMessage = NativeEvent & { source: "formflow"; formId: string };

/** Response of POST /api/v1/public/onboarding/decide. */
export type OnboardingDecision = {
  show: boolean;
  experimentId?: string | null; variantId?: string | null;
  formId?: string | null; slug?: string | null; versionId?: string | null;
  /** Why: e.g. "holdout", "variant", "no_match", "completed". */
  reason: string;
  definition?: unknown;
  resume?: Record<string, unknown> | null;
};
