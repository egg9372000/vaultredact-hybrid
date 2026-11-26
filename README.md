# 🛡️ VaultRedact Hybrid — Privacy-First On-Device PII Redactor & Field Triage

> **Built for Google / Firebase `#BuildHybridAI` Hackathon 2026 (Web / Chrome Track)**  
> A two-stage hybrid AI workspace powered by the official **Firebase AI Logic Hybrid Inference SDK (`firebase/ai`)**, combining **on-device Gemini Nano** privacy scrubbing with seamless **cloud Gemini** executive synthesis, **Firebase App Check**, and **Firebase Remote Config**.

- **Live Web App (GitHub Pages)**: `https://egg9372000.github.io/vaultredact-hybrid/`
- **License**: Apache License 2.0

---

## 🔒 Why Hybrid AI? (The Two-Stage Privacy Boundary)

Pure cloud AI leaks sensitive personal identifiers (PII) and fails completely in offline dead-zones (ambulances, field sites, secure rooms). Pure on-device models have smaller reasoning windows for complex multi-step synthesis.

**VaultRedact Hybrid** bridges both worlds cleanly using **Firebase AI Logic (`firebase/ai`)**:

1. **Stage 1 — On-Device Privacy Vault (`InferenceMode.ONLY_ON_DEVICE` + Deterministic Guardrail)**
   - Detects and masks 7 sensitive PII entity classes (`PERSON`, `EMAIL`, `PHONE`, `SSN_ID`, `CARD`, `MRN`, `IPV4`) locally in browser memory into reversible placeholders (`[PERSON_1]`, `[MRN_1]`, `[CARD_1]`).
   - Enforces a mathematical **`verifyZeroRawPiiLeak()`** gate so **zero raw personal identifiers ever cross the cloud boundary**.
   - Runs secondary on-device verification via Chrome's built-in **Gemini Nano** through `getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE })`.

2. **Stage 2 — Hybrid Executive Triage (`InferenceMode.PREFER_ON_DEVICE` / `PREFER_IN_CLOUD` / `ONLY_ON_DEVICE` / `ONLY_IN_CLOUD`)**
   - Feeds **only the redacted payload** into Firebase AI Logic (`getAI(app, { backend: new GoogleAIBackend() })` + `getGenerativeModel(ai, hybridParams)`).
   - Uses `Schema.object` structured JSON output (`responseMimeType: "application/json"`) to generate Severity (`P0-CRITICAL` – `P3-LOW`), Category, Action Checklist, and Compliance Notes.
   - Reports real runtime **`result.response.inferenceSource`** (`on_device` vs `in_cloud`), live latency, and estimated cloud tokens saved.
   - Automatically forces `InferenceMode.ONLY_ON_DEVICE` when offline (or when the **Offline Sim** switch is enabled).

---

## 🔥 Official Firebase Integrations (`src/ai/firebaseHybridEngine.ts`)

- **`firebase/ai`**: `getAI`, `GoogleAIBackend`, `getGenerativeModel`, `InferenceMode`, `InferenceSource`, `Schema`
- **`firebase/app-check`**: `initializeAppCheck`, `ReCaptchaEnterpriseProvider`, plus `FIREBASE_APPCHECK_DEBUG_TOKEN` support on localhost
- **`firebase/remote-config`**: `getRemoteConfig`, `fetchAndActivate`, `getString` for dynamic `cloud_fallback_model` routing without redeployment

---

## 🛠️ Local Development & Automated Tests

```bash
npm install
npm run typecheck   # Strict TypeScript validation
npm test            # Vitest suite (PII zero-leak invariants + Firebase AI Logic HybridParams checks)
npm run build       # Production static bundle (docs/) for GitHub Pages
npm run dev         # Local dev server (http://localhost:5178)
```
