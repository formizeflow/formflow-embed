# FormFlow embed SDK

[![CI](https://github.com/formizeflow/formflow-embed/actions/workflows/ci.yml/badge.svg)](https://github.com/formizeflow/formflow-embed/actions/workflows/ci.yml)

`embed.js` (hand-written ES2017 IIFE, `FormFlow.version === "2.1.0"`, no cookies, no credentials). Types: `index.d.ts`.

```html
<script src="https://forms.example.com/embed.js" data-workspace="ws_123"></script>
<div data-formflow="contact" data-mode="inline" data-prefill-email="a@b.co" data-hidden-source="pricing"></div>
<div data-formflow="nps" data-mode="modal" data-button-text="Give feedback"></div>
```

Attributes: `data-formflow` (slug), `data-mode` (inline, popup, modal, drawer, slider, fullscreen, floating, popover), `data-prefill-*`, `data-hidden-*` (HTML lower-cases attribute names, so use lowercase field ids or the JS API), `data-button-text`, `data-width`, `data-height`, `data-button-color`, `data-base-url`, `data-pass-query-params="true"`. Set `data-auto-init="false"` on the script tag to skip the automatic scan.

## API

- `FormFlow.init({ baseUrl?, workspace?, widget? })` scans `[data-formflow]` and starts in-product surveys when a workspace is set.
- `FormFlow.open(slug, opts)` / `FormFlow.close()`: open a form in a dialog (default `modal`).
- `FormFlow.createWidget(el, slug, opts)` returns `{ iframe, open, close, destroy }`.
- `FormFlow.identify(userId, attributes)` and `FormFlow.track(eventName)` feed the targeting rules.

Options: `mode`, `baseUrl`, `prefill`, `hidden`, `passQueryParams` (`true` or an allow-list of query keys), `autoResize`, `onReady`, `onSubmit`, `onProgress`, `onError`, `onHoldout`, `onClose`, `styles: { width, height, buttonColor, position: "bottom-right" | "bottom-left" }`.

Modal, drawer, popup and fullscreen trap focus, close on Escape and restore focus. The floating button is a real `<button>` with `aria-expanded`.

## postMessage protocol (iframe to host)

`{ source: "formflow", type: "ready" | "resize" | "progress" | "submit" | "error" | "close", formId, data }`, always posted to the origin given in `?origin=`. The SDK accepts only messages whose `origin` equals the `baseUrl` origin, whose `source` is `"formflow"`, and that come from its own iframe. `submit` carries `{ submissionId, outcome: { passed, outcomeId, endingId } }`, never answers.

URL parameters on `/embed/:slug`: `origin`, `prefill.<fieldId>`, `hidden.<name>`, `respondent.<attr>`, `close=1`, `lang`, plus any pass-through query params (UTM etc.).

## Surveys

Rules come from `GET /api/v1/public/targeting?workspace=<id>`. Triggers: `page_view` (optional path substring), `event` (`FormFlow.track(name)`), `delay` (seconds). `sampleRate` and `recontactDays` (localStorage key `ff:last:<slug>`) apply. Respondent attributes are sent to the form as `respondent` and stored with the submission.

## Notes for integrators

Embeds get `Content-Security-Policy: frame-ancestors *` from `src/proxy.ts`; everything else is `X-Frame-Options: DENY` (except `/f/*`). Keep `embed.js` and `types.d.ts` in sync by hand (no build step).

## v2 additions (all optional; v1 options and the postMessage protocol are unchanged)

```html
<!-- side panel -->
<button data-formflow="feedback" data-mode="slider">Feedback</button>

<!-- chat bubble with tooltip, opens by itself on exit intent or after 50% scroll (once per session) -->
<div data-formflow="nps" data-mode="popover" data-launcher-icon="chat" data-launcher-tooltip="Got 1 minute?"
     data-trigger-exit-intent="true" data-trigger-scroll="50"></div>

<!-- prefill from the host page, close 2.5 s after submit -->
<div data-formflow="demo" data-mode="inline" data-prefill-from-url="true" data-auto-close="2500"></div>
```

```js
FormFlow.open("demo", {
  mode: "slider", styles: { side: "left", width: 560 },
  prefillFromUrl: { email: "e", plan: "utm_plan" },          // { fieldId: urlParam }
  prefillFromDataLayer: { company: "user.company" },         // GTM dataLayer, newest entry wins
  transitiveSearchParams: ["utm_source", "utm_campaign"],    // forwarded to the form (attribution)
  autoClose: 2500,
});
FormFlow.createWidget(document.body, "nps", {
  mode: "popover",
  launcher: { icon: "https://example.com/icon.svg", tooltip: "Tell us what you think", color: "#4f46e5" },
  trigger: { exitIntent: true, scrollPercent: 60, delay: 30, once: true },
});
```

- `slider`: panel sliding from `styles.side` (right by default); backdrop click, Escape and the X close it.
- `launcher` (popover/floating): round bubble, tooltip on hover and focus, `aria-expanded`. Icons: `chat`, `question`, `clipboard`, `star` or an https image URL. Without `launcher` a popover opens immediately (v1 behavior, used by in-product surveys).
- `trigger`: opens the popup automatically on `exitIntent` (pointer leaves through the top), `scrollPercent` or `delay` seconds; fires once per session unless `once: false`. With a trigger and no launcher no button is rendered.
- `prefillFromUrl`, `prefillFromDataLayer`, `transitiveSearchParams` (alias of `passQueryParams`): all values travel as `prefill.<fieldId>` / plain query params; the form decides which fields accept them.
- `autoClose`: ms after a successful submit (`true` = 3000) for overlay modes.
- Loading placeholder: a skeleton in the form's own background color shows until the form reports `ready` (theme fetched from the public API; honors reduced motion). `placeholder: false` / `data-placeholder="false"` disables it.
- Attributes: `data-launcher-icon`, `data-launcher-tooltip`, `data-trigger-exit-intent`, `data-trigger-scroll`, `data-trigger-delay`, `data-auto-close`, `data-prefill-from-url`, `data-transitive-search-params`, `data-placeholder`.

Password-protected forms: the unlock screen runs inside the iframe; the cookie it sets needs third-party cookies (it is `SameSite=None; Secure; Partitioned` in production), otherwise visitors should use the hosted URL.

## Protocol v3: native WebViews (additive; v1 and v2 messages are unchanged)

`/embed/:slug?native=1` runs the page for iOS, Android, React Native and Flutter WebViews. There is no parent window and no `origin` is needed. Every message is posted to each bridge that exists:

| Bridge | Payload |
| --- | --- |
| `window.ReactNativeWebView.postMessage(json)` | JSON string |
| `window.webkit.messageHandlers.formflow.postMessage(obj)` | object |
| `window.FormFlowAndroid.postMessage(json)` | JSON string |
| `window.FormFlowFlutter.postMessage(json)` | JSON string |

Envelope: `{ source: "formflow", type, formId, data }`. Native mode events:

- `ready` `{ formId, versionId, experimentId?, variantId?, locale }`, then `view` `{}`
- `start` `{}` (first interaction)
- `step` `{ index, fieldId, total }` (`fieldId` is the most recently answered field)
- `answer` `{ fieldId, type }`, plus `value` only when the URL has `answers=1` and the field is not sensitive (never file uploads or signatures)
- `complete` `{ submissionId, outcome, endingId, durationMs }` (also sent as `submit`)
- `progress`, `resize`, `error`, and `close` (the user tapped the close button, `close=1`)

Other URL params (all optional): `uid` (the app's stable user id) and `variant` (force an experiment variant id), which the server uses; `lang`, `prefill.<fieldId>`, `hidden.<name>`, `respondent.<attr>`.

Holdout: when a test holds the visitor out, the page shows no form. It posts `{ source: "formflow", type: "holdout", experimentId, data: { experimentId, redirectUrl? } }` and then `close`, on the parent bridge and the native bridge alike. `embed.js` calls `onHoldout({ experimentId, redirectUrl })` or, without it, removes (inline) or closes (overlay) the embed. On the hosted page the visitor is redirected to the test's `holdoutExit.redirectUrl` (uid and params kept) or sees a "You're all set" screen.

Native UI: `100dvh`, safe-area padding via `env(safe-area-inset-*)`, no overscroll bounce, and the focused input scrolls into view above the keyboard. Native pages never carry the host-to-page `receive` channel; control (close, back) belongs to the native view. Logic lives in `src/modules/form-rendering/native-bridge.ts`.

Native SDKs: `sdks/react-native`, `sdks/ios`, `sdks/android`, `sdks/flutter`.

## v2.1: identity and decide

Options on `open`/`createWidget`: `uid`, `uidSignature` (compute the HMAC on your server), `attributes` (sent as `attrs.<key>`), `posthog: true` (reads `window.posthog` session and distinct ids) or `posthogSessionId`/`posthogDistinctId`. URL params: `uid`, `uid_sig`, `attrs.<k>`, `ph_session`, `ph_distinct`.

`FormFlow.decide({ entry, uid, uidSignature, attributes })` calls `POST /api/v1/public/onboarding/decide` and resolves `{ show, experimentId, variantId, formId, slug, versionId, reason, definition?, resume? }`. Use `show: false` for holdouts (an "excluded" visitor, outside the test's traffic or targeting, gets `show: true` with the original form and no experiment id, the same as the hosted page), then open `slug` with `variant`.

## Native v3.1 additions

- `request` event `{ requestId, action, params }`: an in-form link `[Enable notifications](https://example.com/#ff-action=notifications&topic=news)` asks the app to act. Answer with `window.FormFlow.native.receive({ type: "respond", requestId, result })` (JS evaluated by the host); the link gets `data-ff-result`. Feeding the result into form logic is not implemented.
- `complete` carries `answers` (`{ fieldId: value }`, non-sensitive fields) when `answers=1`.
- Appearance params: `scheme=light|dark|system`, `accent=#rrggbb`, `font=<family>`.
- `resume=0` disables server-side resume for a uid (default on, implemented server-side).
- No schema change was made; the "app action" is a link convention.
