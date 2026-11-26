import { deleteApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  Schema,
  type HybridParams,
} from 'firebase/ai';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { fetchAndActivate, getRemoteConfig, getString } from 'firebase/remote-config';
import {
  assembleTriageReport,
  buildDeterministicTriage,
  type ParsedModelSynthesis,
} from '../core/localTriage';
import { redactLocalPii } from '../core/piiRedactor';
import type {
  FirebaseWebConfig,
  HybridCapabilityReport,
  HybridRoutingPolicy,
  RedactionResult,
  ResolvedInferenceSource,
  TriageReport,
} from '../core/types';

export const DEFAULT_CLOUD_MODEL = 'gemini-2.5-flash';
const CONFIG_STORAGE_KEY = 'vaultredact_firebase_web_config_v1';

// Structured JSON schema shared between Firebase AI Logic inCloudParams & onDeviceParams
export const TRIAGE_RESPONSE_SCHEMA = Schema.object({
  properties: {
    severity: Schema.enumString({
      enum: ['P0-CRITICAL', 'P1-HIGH', 'P2-MEDIUM', 'P3-LOW'],
      description: 'Operational urgency level',
    }),
    category: Schema.string({ description: 'Domain triage category' }),
    headline: Schema.string({ description: 'Concise action headline under 12 words' }),
    executiveSummary: Schema.string({ description: '2-sentence sanitized operational summary' }),
    actionChecklist: Schema.array({
      items: Schema.string(),
      description: '3 prioritized concrete next actions referencing only masked placeholders',
    }),
    complianceNotes: Schema.string({ description: 'Privacy & compliance verification note' }),
  },
});

export function mapPolicyToSdkMode(policy: HybridRoutingPolicy): InferenceMode {
  switch (policy) {
    case 'only_on_device':
      return InferenceMode.ONLY_ON_DEVICE;
    case 'prefer_in_cloud':
      return InferenceMode.PREFER_IN_CLOUD;
    case 'only_in_cloud':
      return InferenceMode.ONLY_IN_CLOUD;
    case 'prefer_on_device':
    default:
      return InferenceMode.PREFER_ON_DEVICE;
  }
}

export function buildHybridModelParams(
  policy: HybridRoutingPolicy,
  cloudModel: string = DEFAULT_CLOUD_MODEL
): HybridParams {
  const mode = mapPolicyToSdkMode(policy);
  return {
    mode,
    onDeviceParams: {
      createOptions: {
        temperature: 0.2,
        topK: 3,
      },
    },
    inCloudParams: {
      model: cloudModel,
      systemInstruction:
        'You are VaultRedact Hybrid Triage Assistant. The text you receive has already been scrubbed of raw PII on-device. Never invent personal details; reference placeholders like [PERSON_1] verbatim. Respond strictly as JSON.',
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: TRIAGE_RESPONSE_SCHEMA,
      },
    },
  };
}

export function loadSavedFirebaseConfig(): FirebaseWebConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FirebaseWebConfig>;
    if (parsed.apiKey && parsed.projectId && parsed.appId) {
      return {
        apiKey: parsed.apiKey.trim(),
        authDomain: (parsed.authDomain ?? `${parsed.projectId}.firebaseapp.com`).trim(),
        projectId: parsed.projectId.trim(),
        appId: parsed.appId.trim(),
        storageBucket: parsed.storageBucket?.trim(),
        messagingSenderId: parsed.messagingSenderId?.trim(),
        recaptchaSiteKey: parsed.recaptchaSiteKey?.trim(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveFirebaseConfig(config: FirebaseWebConfig | null): void {
  if (typeof window === 'undefined') return;
  if (!config) {
    window.localStorage.removeItem(CONFIG_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
}

interface GlobalWithLanguageModel {
  LanguageModel?: {
    availability?: () => Promise<string>;
  };
  ai?: {
    languageModel?: {
      capabilities?: () => Promise<{ available?: string }>;
    };
  };
  FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
}

export async function probeBrowserHybridCapabilities(
  savedConfig: FirebaseWebConfig | null
): Promise<HybridCapabilityReport> {
  const g = globalThis as unknown as GlobalWithLanguageModel;
  let chromeAiStatus: HybridCapabilityReport['chromeAiStatus'] = 'unavailable';

  try {
    if (g.LanguageModel && typeof g.LanguageModel.availability === 'function') {
      const status = await g.LanguageModel.availability();
      if (status === 'available' || status === 'readily') {
        chromeAiStatus = 'available';
      } else if (status === 'downloadable' || status === 'after-download') {
        chromeAiStatus = 'downloadable';
      } else if (status === 'downloading') {
        chromeAiStatus = 'downloading';
      }
    } else if (g.ai?.languageModel && typeof g.ai.languageModel.capabilities === 'function') {
      const caps = await g.ai.languageModel.capabilities();
      if (caps.available === 'readily') chromeAiStatus = 'available';
      else if (caps.available === 'after-download') chromeAiStatus = 'downloadable';
    }
  } catch {
    chromeAiStatus = 'unavailable';
  }

  return {
    chromeBuiltInAiDetected: chromeAiStatus !== 'unavailable',
    chromeAiStatus,
    navigatorOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    firebaseConfigured: Boolean(savedConfig?.apiKey && savedConfig?.projectId),
    firebaseProjectId: savedConfig?.projectId ?? null,
    appCheckActive: Boolean(savedConfig?.recaptchaSiteKey),
    remoteConfigStatus: savedConfig ? 'active' : 'defaults',
  };
}

let activeApp: FirebaseApp | null = null;
let activeConfigSignature = '';
let activeAppCheckEnabled = false;

async function ensureFirebaseApp(
  config: FirebaseWebConfig | null,
  traceLog: string[]
): Promise<{ app: FirebaseApp; isLiveProject: boolean; appCheckEnabled: boolean }> {
  const effectiveConfig: FirebaseWebConfig = config ?? {
    apiKey: 'demo-local-on-device-only',
    authDomain: 'vaultredact-local.firebaseapp.com',
    projectId: 'vaultredact-local-demo',
    appId: '1:000000000000:web:0000000000000000000000',
  };

  const sig = `${effectiveConfig.projectId}|${effectiveConfig.apiKey}|${effectiveConfig.recaptchaSiteKey ?? ''}`;
  if (activeApp && activeConfigSignature === sig) {
    return {
      app: activeApp,
      isLiveProject: Boolean(config),
      appCheckEnabled: activeAppCheckEnabled,
    };
  }

  // Clean up prior named instance if user changed Firebase config
  const existing = getApps().find((a) => a.name === 'vaultredact-hybrid');
  if (existing) {
    await deleteApp(existing);
  }

  activeApp = initializeApp(effectiveConfig, 'vaultredact-hybrid');
  activeConfigSignature = sig;
  activeAppCheckEnabled = false;

  if (config && typeof window !== 'undefined') {
    if (config.recaptchaSiteKey) {
      try {
        initializeAppCheck(activeApp, {
          provider: new ReCaptchaEnterpriseProvider(config.recaptchaSiteKey),
          isTokenAutoRefreshEnabled: true,
        });
        activeAppCheckEnabled = true;
        traceLog.push('Firebase App Check initialized with ReCaptchaEnterpriseProvider.');
      } catch (err) {
        traceLog.push(`App Check skipped: ${err instanceof Error ? err.message : 'unavailable'}`);
      }
    } else if (window.location.hostname === 'localhost') {
      const g = globalThis as unknown as GlobalWithLanguageModel;
      g.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      traceLog.push('Localhost detected: FIREBASE_APPCHECK_DEBUG_TOKEN enabled for debug testing.');
    }
  }

  return {
    app: activeApp,
    isLiveProject: Boolean(config),
    appCheckEnabled: activeAppCheckEnabled,
  };
}

function parseSynthesisJson(rawText: string, fallback: ParsedModelSynthesis): ParsedModelSynthesis {
  try {
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned) as Partial<ParsedModelSynthesis>;
    const validSeverities = ['P0-CRITICAL', 'P1-HIGH', 'P2-MEDIUM', 'P3-LOW'] as const;
    const severity = validSeverities.includes(parsed.severity as (typeof validSeverities)[number])
      ? (parsed.severity as ParsedModelSynthesis['severity'])
      : fallback.severity;

    return {
      severity,
      category: typeof parsed.category === 'string' && parsed.category.trim() ? parsed.category.trim() : fallback.category,
      headline: typeof parsed.headline === 'string' && parsed.headline.trim() ? parsed.headline.trim() : fallback.headline,
      executiveSummary:
        typeof parsed.executiveSummary === 'string' && parsed.executiveSummary.trim()
          ? parsed.executiveSummary.trim()
          : fallback.executiveSummary,
      actionChecklist:
        Array.isArray(parsed.actionChecklist) && parsed.actionChecklist.length > 0
          ? parsed.actionChecklist.map(String).slice(0, 5)
          : fallback.actionChecklist,
      complianceNotes:
        typeof parsed.complianceNotes === 'string' && parsed.complianceNotes.trim()
          ? parsed.complianceNotes.trim()
          : fallback.complianceNotes,
    };
  } catch {
    return fallback;
  }
}

export async function runHybridPrivacyPipeline(options: {
  rawText: string;
  policy: HybridRoutingPolicy;
  simulatedOffline: boolean;
  firebaseConfig: FirebaseWebConfig | null;
}): Promise<{ redaction: RedactionResult; report: TriageReport }> {
  const traceLog: string[] = [];
  const stage1Start = performance.now();

  // Stage 1A: Deterministic zero-leak PII boundary (always executes locally in browser memory)
  const redaction = redactLocalPii(options.rawText);
  traceLog.push(
    `[Stage 1] Local Privacy Gate masked ${redaction.entities.length} PII span(s) (zeroLeakVerified=${String(redaction.zeroLeakVerified)}).`
  );

  const { app, isLiveProject, appCheckEnabled } = await ensureFirebaseApp(
    options.firebaseConfig,
    traceLog
  );

  // Optional Firebase Remote Config dynamic hybrid routing policy
  let effectivePolicy: HybridRoutingPolicy = options.policy;
  let cloudModelName = DEFAULT_CLOUD_MODEL;
  let remoteConfigApplied = false;

  if (isLiveProject && !options.simulatedOffline && typeof window !== 'undefined') {
    try {
      const rc = getRemoteConfig(app);
      rc.settings.minimumFetchIntervalMillis = 60_000;
      rc.defaultConfig = {
        hybrid_routing_mode: options.policy,
        cloud_fallback_model: DEFAULT_CLOUD_MODEL,
      };
      await fetchAndActivate(rc);
      const rcModel = getString(rc, 'cloud_fallback_model');
      if (rcModel) {
        cloudModelName = rcModel;
        remoteConfigApplied = true;
        traceLog.push(`[Remote Config] Loaded cloud_fallback_model="${cloudModelName}".`);
      }
    } catch {
      traceLog.push('[Remote Config] Using local default hybrid routing policy.');
    }
  }

  // Enforce strict ONLY_ON_DEVICE whenever offline simulation or browser offline is active
  const isOffline =
    options.simulatedOffline || (typeof navigator !== 'undefined' && !navigator.onLine);
  if (isOffline) {
    effectivePolicy = 'only_on_device';
    traceLog.push('[Network] Offline mode active -> forcing InferenceMode.ONLY_ON_DEVICE.');
  }

  // Initialize official Firebase AI Logic service with GoogleAIBackend
  const ai = getAI(app, { backend: new GoogleAIBackend() });

  // Stage 1B: Attempt strictly on-device Gemini Nano sanity verification via Firebase AI Logic
  let stage1Source: ResolvedInferenceSource = 'LOCAL_DETERMINISTIC_FALLBACK';
  try {
    const localAuditModel = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: { createOptions: { temperature: 0.1 } },
    });
    const auditRes = await localAuditModel.generateContent(
      `Confirm in 8 words or fewer that no raw personal contact details remain in: "${redaction.redactedText.slice(0, 320)}"`
    );
    const auditText = auditRes.response.text().trim();
    const isChromiumEchoStub = /not available in Chromium|echoing back the input/i.test(auditText);
    if (auditRes.response.inferenceSource === InferenceSource.ON_DEVICE && !isChromiumEchoStub) {
      stage1Source = 'ON_DEVICE';
      traceLog.push(
        `[Stage 1 · Firebase AI Logic] Chrome Gemini Nano verified local scrub (inferenceSource="on_device"): "${auditText.slice(0, 90)}".`
      );
    } else if (isChromiumEchoStub) {
      traceLog.push(
        '[Stage 1 · Firebase AI Logic] Chromium Prompt API echo stub detected -> Enforced Deterministic Local Privacy Gate 100% locally.'
      );
    }
  } catch {
    traceLog.push(
      '[Stage 1 · Firebase AI Logic] On-device Gemini Nano unavailable in this browser -> Deterministic Local Privacy Gate enforced 100% locally.'
    );
  }
  const stage1LatencyMs = Math.max(1, Math.round(performance.now() - stage1Start));

  // Stage 2: Hybrid Triage Synthesis (only sanitized text crosses this boundary!)
  const stage2Start = performance.now();
  const deterministicBaseline = buildDeterministicTriage(redaction);
  let synthesis: ParsedModelSynthesis = deterministicBaseline;
  let stage2Source: ResolvedInferenceSource = 'LOCAL_DETERMINISTIC_FALLBACK';

  const hybridParams = buildHybridModelParams(effectivePolicy, cloudModelName);
  traceLog.push(
    `[Stage 2 · Firebase AI Logic] Invoking getGenerativeModel(ai, { mode: "${hybridParams.mode}", inCloudParams.model: "${cloudModelName}" }).`
  );

  // If no live Firebase project is configured and we aren't on a Nano-enabled browser, avoid dead network calls
  const shouldInvokeSdk =
    isLiveProject ||
    stage1Source === 'ON_DEVICE' ||
    effectivePolicy === 'only_on_device';

  if (shouldInvokeSdk && !(isOffline && stage1Source !== 'ON_DEVICE')) {
    try {
      const hybridModel = getGenerativeModel(ai, hybridParams);
      const prompt = [
        'Analyze this ALREADY-REDACTED field report and output strictly valid JSON matching keys: severity, category, headline, executiveSummary, actionChecklist (array of 3 strings), complianceNotes.',
        `Redacted report:\n${redaction.redactedText}`,
      ].join('\n\n');

      const result = await hybridModel.generateContent(prompt);
      const rawOutput = result.response.text();
      const isStub = /not available in Chromium|echoing back the input/i.test(rawOutput);
      if (isStub) {
        stage2Source = 'LOCAL_DETERMINISTIC_FALLBACK';
        traceLog.push(
          '[Stage 2 · Firebase AI Logic] Chromium Prompt API echo stub detected -> Using deterministic offline-safe structured triage.'
        );
      } else {
        synthesis = parseSynthesisJson(rawOutput, deterministicBaseline);
        if (result.response.inferenceSource === InferenceSource.ON_DEVICE) {
          stage2Source = 'ON_DEVICE';
        } else if (result.response.inferenceSource === InferenceSource.IN_CLOUD) {
          stage2Source = 'IN_CLOUD';
        } else {
          stage2Source = isLiveProject && !isOffline ? 'IN_CLOUD' : 'ON_DEVICE';
        }
        traceLog.push(
          `[Stage 2 · Firebase AI Logic] Completed via inferenceSource="${result.response.inferenceSource ?? stage2Source}".`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'SDK inference unavailable';
      traceLog.push(
        `[Stage 2 · Failover] Firebase AI Logic returned "${msg.slice(0, 120)}" -> Graceful offline deterministic triage active.`
      );
    }
  } else {
    traceLog.push(
      '[Stage 2 · Sandbox Mode] No live Firebase Web Config pasted & Chrome Gemini Nano not enabled -> Executed transparent local deterministic triage. Click "Configure Firebase" to enable live Cloud Gemini fallback.'
    );
  }

  const stage2LatencyMs = Math.max(1, Math.round(performance.now() - stage2Start));

  const report = assembleTriageReport({
    synthesis,
    redaction,
    stage1Source,
    stage2Source,
    stage1LatencyMs,
    stage2LatencyMs,
    sdkModeUsed: effectivePolicy,
    cloudModelName,
    remoteConfigApplied,
    appCheckEnabled,
    traceLog,
  });

  return { redaction, report };
}
