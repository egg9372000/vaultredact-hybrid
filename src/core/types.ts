export type PiiKind = 'EMAIL' | 'PHONE' | 'SSN_ID' | 'CARD' | 'MRN' | 'IPV4' | 'PERSON';

export interface PiiEntity {
  id: string;
  kind: PiiKind;
  placeholder: string;
  original: string;
  start: number;
  end: number;
}

export interface RedactionResult {
  originalText: string;
  redactedText: string;
  entities: PiiEntity[];
  countsByKind: Record<PiiKind, number>;
  zeroLeakVerified: boolean;
  estimatedTokens: number;
}

export type HybridRoutingPolicy =
  | 'prefer_on_device'
  | 'only_on_device'
  | 'prefer_in_cloud'
  | 'only_in_cloud';

export type ResolvedInferenceSource =
  | 'ON_DEVICE'
  | 'IN_CLOUD'
  | 'LOCAL_DETERMINISTIC_FALLBACK';

export interface TriageReport {
  severity: 'P0-CRITICAL' | 'P1-HIGH' | 'P2-MEDIUM' | 'P3-LOW';
  category: string;
  headline: string;
  executiveSummary: string;
  actionChecklist: string[];
  complianceNotes: string;
  stage1Source: ResolvedInferenceSource;
  stage2Source: ResolvedInferenceSource;
  stage1LatencyMs: number;
  stage2LatencyMs: number;
  sdkModeUsed: HybridRoutingPolicy;
  cloudModelName: string;
  remoteConfigApplied: boolean;
  appCheckEnabled: boolean;
  rawPiiBlockedCount: number;
  cloudTokensSaved: number;
  traceLog: string[];
}

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  recaptchaSiteKey?: string;
}

export interface HybridCapabilityReport {
  chromeBuiltInAiDetected: boolean;
  chromeAiStatus: 'available' | 'downloadable' | 'downloading' | 'unavailable';
  navigatorOnline: boolean;
  firebaseConfigured: boolean;
  firebaseProjectId: string | null;
  appCheckActive: boolean;
  remoteConfigStatus: 'active' | 'defaults';
}

export interface TelemetryStats {
  totalRuns: number;
  onDeviceSteps: number;
  cloudSteps: number;
  localFallbackSteps: number;
  totalPiiEntitiesKeptLocal: number;
  totalCloudTokensSaved: number;
}

export interface SampleCase {
  id: string;
  title: string;
  domain: string;
  badge: string;
  recommendedOffline: boolean;
  rawText: string;
}
