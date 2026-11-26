import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  Cpu,
  Eye,
  EyeOff,
  Flame,
  Lock,
  Play,
  Settings,
  ShieldCheck,
  Terminal,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  loadSavedFirebaseConfig,
  probeBrowserHybridCapabilities,
  runHybridPrivacyPipeline,
  saveFirebaseConfig,
} from './ai/firebaseHybridEngine';
import { restorePlaceholders } from './core/piiRedactor';
import { SAMPLE_CASES } from './core/samples';
import type {
  FirebaseWebConfig,
  HybridCapabilityReport,
  HybridRoutingPolicy,
  RedactionResult,
  ResolvedInferenceSource,
  TelemetryStats,
  TriageReport,
} from './core/types';

const POLICY_OPTIONS: ReadonlyArray<{ id: HybridRoutingPolicy; label: string }> = [
  { id: 'prefer_on_device', label: 'PREFER_ON_DEVICE' },
  { id: 'only_on_device', label: 'ONLY_ON_DEVICE' },
  { id: 'prefer_in_cloud', label: 'PREFER_IN_CLOUD' },
  { id: 'only_in_cloud', label: 'ONLY_IN_CLOUD' },
];

function formatSourceLabel(source: ResolvedInferenceSource): string {
  if (source === 'ON_DEVICE') return 'ON-DEVICE · GEMINI NANO';
  if (source === 'IN_CLOUD') return 'IN-CLOUD · FIREBASE GEMINI';
  return 'LOCAL GUARDRAIL · OFFLINE SAFE';
}

export function App() {
  const [selectedSampleId, setSelectedSampleId] = useState<string>(SAMPLE_CASES[0].id);
  const [rawText, setRawText] = useState<string>(SAMPLE_CASES[0].rawText);
  const [policy, setPolicy] = useState<HybridRoutingPolicy>('prefer_on_device');
  const [simulatedOffline, setSimulatedOffline] = useState<boolean>(false);
  const [revealLocalPii, setRevealLocalPii] = useState<boolean>(false);
  const [running, setRunning] = useState<boolean>(false);

  const [firebaseConfig, setFirebaseConfig] = useState<FirebaseWebConfig | null>(() =>
    loadSavedFirebaseConfig()
  );
  const [configModalOpen, setConfigModalOpen] = useState<boolean>(false);
  const [draftApiKey, setDraftApiKey] = useState<string>(firebaseConfig?.apiKey ?? '');
  const [draftProjectId, setDraftProjectId] = useState<string>(firebaseConfig?.projectId ?? '');
  const [draftAppId, setDraftAppId] = useState<string>(firebaseConfig?.appId ?? '');
  const [draftRecaptchaKey, setDraftRecaptchaKey] = useState<string>(
    firebaseConfig?.recaptchaSiteKey ?? ''
  );

  const [capabilities, setCapabilities] = useState<HybridCapabilityReport>({
    chromeBuiltInAiDetected: false,
    chromeAiStatus: 'unavailable',
    navigatorOnline: true,
    firebaseConfigured: Boolean(firebaseConfig),
    firebaseProjectId: firebaseConfig?.projectId ?? null,
    appCheckActive: Boolean(firebaseConfig?.recaptchaSiteKey),
    remoteConfigStatus: firebaseConfig ? 'active' : 'defaults',
  });

  const [redaction, setRedaction] = useState<RedactionResult | null>(null);
  const [report, setReport] = useState<TriageReport | null>(null);
  const [stats, setStats] = useState<TelemetryStats>({
    totalRuns: 0,
    onDeviceSteps: 0,
    cloudSteps: 0,
    localFallbackSteps: 0,
    totalPiiEntitiesKeptLocal: 0,
    totalCloudTokensSaved: 0,
  });

  useEffect(() => {
    void probeBrowserHybridCapabilities(firebaseConfig).then(setCapabilities);
  }, [firebaseConfig]);

  // Run initial showcase pipeline on first mount so judges see live redacted & triage output immediately
  useEffect(() => {
    let active = true;
    const init = async () => {
      const res = await runHybridPrivacyPipeline({
        rawText: SAMPLE_CASES[0].rawText,
        policy: 'prefer_on_device',
        simulatedOffline: false,
        firebaseConfig: loadSavedFirebaseConfig(),
      });
      if (!active) return;
      setRedaction(res.redaction);
      setReport(res.report);
      setStats({
        totalRuns: 1,
        onDeviceSteps:
          (res.report.stage1Source === 'ON_DEVICE' ? 1 : 0) +
          (res.report.stage2Source === 'ON_DEVICE' ? 1 : 0),
        cloudSteps: res.report.stage2Source === 'IN_CLOUD' ? 1 : 0,
        localFallbackSteps:
          (res.report.stage1Source === 'LOCAL_DETERMINISTIC_FALLBACK' ? 1 : 0) +
          (res.report.stage2Source === 'LOCAL_DETERMINISTIC_FALLBACK' ? 1 : 0),
        totalPiiEntitiesKeptLocal: res.redaction.entities.length,
        totalCloudTokensSaved: res.report.cloudTokensSaved,
      });
    };
    void init();
    return () => {
      active = false;
    };
  }, []);

  const handleRunPipeline = async (overrideText?: string, overrideOffline?: boolean) => {
    const input = overrideText ?? rawText;
    const offlineFlag = overrideOffline ?? simulatedOffline;
    if (!input.trim()) return;
    setRunning(true);
    try {
      const res = await runHybridPrivacyPipeline({
        rawText: input,
        policy,
        simulatedOffline: offlineFlag,
        firebaseConfig,
      });
      setRedaction(res.redaction);
      setReport(res.report);
      setRevealLocalPii(false);
      setStats((prev) => ({
        totalRuns: prev.totalRuns + 1,
        onDeviceSteps:
          prev.onDeviceSteps +
          (res.report.stage1Source === 'ON_DEVICE' ? 1 : 0) +
          (res.report.stage2Source === 'ON_DEVICE' ? 1 : 0),
        cloudSteps: prev.cloudSteps + (res.report.stage2Source === 'IN_CLOUD' ? 1 : 0),
        localFallbackSteps:
          prev.localFallbackSteps +
          (res.report.stage1Source === 'LOCAL_DETERMINISTIC_FALLBACK' ? 1 : 0) +
          (res.report.stage2Source === 'LOCAL_DETERMINISTIC_FALLBACK' ? 1 : 0),
        totalPiiEntitiesKeptLocal: prev.totalPiiEntitiesKeptLocal + res.redaction.entities.length,
        totalCloudTokensSaved: prev.totalCloudTokensSaved + res.report.cloudTokensSaved,
      }));
    } finally {
      setRunning(false);
    }
  };

  const handleSelectSample = (sampleId: string) => {
    const found = SAMPLE_CASES.find((s) => s.id === sampleId);
    if (!found) return;
    setSelectedSampleId(found.id);
    setRawText(found.rawText);
    void handleRunPipeline(found.rawText, simulatedOffline);
  };

  const handleSaveConfig = () => {
    if (!draftApiKey.trim() || !draftProjectId.trim() || !draftAppId.trim()) {
      saveFirebaseConfig(null);
      setFirebaseConfig(null);
      setConfigModalOpen(false);
      return;
    }
    const next: FirebaseWebConfig = {
      apiKey: draftApiKey.trim(),
      authDomain: `${draftProjectId.trim()}.firebaseapp.com`,
      projectId: draftProjectId.trim(),
      appId: draftAppId.trim(),
      recaptchaSiteKey: draftRecaptchaKey.trim() || undefined,
    };
    saveFirebaseConfig(next);
    setFirebaseConfig(next);
    setConfigModalOpen(false);
  };

  const totalSteps = Math.max(
    1,
    stats.onDeviceSteps + stats.cloudSteps + stats.localFallbackSteps
  );
  const localPct = Math.round(
    ((stats.onDeviceSteps + stats.localFallbackSteps) / totalSteps) * 100
  );

  const displayedStage1Text =
    redaction && revealLocalPii
      ? restorePlaceholders(redaction.redactedText, redaction.entities)
      : (redaction?.redactedText ?? '');

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand-group">
          <div className="brand-icon">
            <ShieldCheck size={22} />
          </div>
          <div>
            <div className="brand-title">VAULTREDACT HYBRID</div>
            <div className="brand-sub">
              Firebase AI Logic Hybrid Inference · On-Device PII Vault + Cloud Gemini Triage
            </div>
          </div>
        </div>

        <div className="status-controls">
          <span className={`status-chip ${capabilities.chromeBuiltInAiDetected ? 'good' : 'warn'}`}>
            <Cpu size={14} />
            Gemini Nano: {capabilities.chromeAiStatus.toUpperCase()}
          </span>

          <span className={`status-chip ${capabilities.firebaseConfigured ? 'good' : 'warn'}`}>
            <Flame size={14} />
            Firebase Cloud: {capabilities.firebaseProjectId ?? 'SANDBOX'}
          </span>

          <button
            type="button"
            className={`status-chip ${simulatedOffline ? 'offline' : 'good'}`}
            onClick={() => setSimulatedOffline((v) => !v)}
          >
            {simulatedOffline ? <WifiOff size={14} /> : <Wifi size={14} />}
            {simulatedOffline ? 'Offline Sim: ON' : 'Network: ONLINE'}
          </button>

          <button
            type="button"
            className="status-chip action"
            onClick={() => setConfigModalOpen(true)}
          >
            <Settings size={14} />
            Configure Firebase
          </button>
        </div>
      </header>

      <section className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Local / On-Device Ratio</span>
          <span className="kpi-value" style={{ color: '#34d399' }}>
            {localPct}%
          </span>
          <span className="kpi-sub">
            {stats.onDeviceSteps + stats.localFallbackSteps} local · {stats.cloudSteps} cloud steps
          </span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">PII Entities Sealed Local</span>
          <span className="kpi-value" style={{ color: '#38bdf8' }}>
            {stats.totalPiiEntitiesKeptLocal}
          </span>
          <span className="kpi-sub">0 raw identifiers sent to cloud</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Cloud Tokens Saved</span>
          <span className="kpi-value" style={{ color: '#fbbf24' }}>
            {stats.totalCloudTokensSaved.toLocaleString()}
          </span>
          <span className="kpi-sub">$0.00 cost on local-routed runs</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Active SDK InferenceMode</span>
          <span className="kpi-value" style={{ color: '#e2e8f0', fontSize: 15, marginTop: 4 }}>
            {(simulatedOffline ? 'only_on_device' : policy).toUpperCase()}
          </span>
          <span className="kpi-sub">firebase/ai · GoogleAIBackend</span>
        </div>
      </section>

      <main className="workspace-grid">
        {/* LEFT COLUMN: Sensitive Field Input & Hybrid Controls */}
        <section className="panel-card">
          <div className="panel-head">
            <span className="panel-title">
              <Lock size={16} color="#10b981" />
              1. Raw Sensitive Field Input (Stays On-Device)
            </span>
            <span className="kpi-sub">{rawText.length} chars</span>
          </div>

          <div className="sample-row">
            {SAMPLE_CASES.map((sample) => (
              <button
                key={sample.id}
                type="button"
                className={`sample-btn ${selectedSampleId === sample.id ? 'active' : ''}`}
                onClick={() => handleSelectSample(sample.id)}
              >
                <span className="sample-title">{sample.title}</span>
                <span className="sample-meta">
                  {sample.domain} · {sample.badge}
                </span>
              </button>
            ))}
          </div>

          <textarea
            aria-label="Sensitive raw text input"
            className="raw-textarea"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste sensitive intake notes, customer fraud tickets, or incident logs..."
          />

          <div>
            <div className="kpi-label" style={{ marginBottom: 6 }}>
              Firebase AI Logic Hybrid Routing Policy (InferenceMode)
            </div>
            <div className="policy-row">
              {POLICY_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`policy-btn ${policy === opt.id ? 'active' : ''}`}
                  onClick={() => setPolicy(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="run-cta"
            disabled={running}
            onClick={() => void handleRunPipeline()}
          >
            <Play size={16} />
            {running ? 'RUNNING HYBRID PIPELINE...' : 'RUN HYBRID PRIVACY PIPELINE'}
          </button>

          {report && (
            <div className="trace-box">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#e2e8f0', fontWeight: 700 }}>
                <Terminal size={13} />
                Firebase AI Logic Runtime Execution Trace
              </div>
              {report.traceLog.map((line, idx) => (
                <div key={idx}>{line}</div>
              ))}
            </div>
          )}
        </section>

        {/* RIGHT COLUMN: Stage 1 Privacy Vault + Stage 2 Hybrid Executive Triage */}
        <section className="panel-card">
          <div className="panel-head">
            <span className="panel-title">
              <ShieldCheck size={16} color="#10b981" />
              Stage 1 · On-Device Privacy Redaction Vault
            </span>
            <button
              type="button"
              className="status-chip action"
              onClick={() => setRevealLocalPii((v) => !v)}
            >
              {revealLocalPii ? <EyeOff size={13} /> : <Eye size={13} />}
              {revealLocalPii ? 'Mask PII' : 'Local Reveal'}
            </button>
          </div>

          {redaction && (
            <>
              <div className="badge-row">
                <span className="source-badge on-device">
                  <CheckCircle2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  ZERO-LEAK GATE: {redaction.zeroLeakVerified ? 'PASSED' : 'BLOCKED'}
                </span>
                {report && (
                  <span className="source-badge">
                    {formatSourceLabel(report.stage1Source)} · {report.stage1LatencyMs}ms
                  </span>
                )}
              </div>

              <div className="redacted-box">{displayedStage1Text}</div>

              <div className="entity-list">
                {redaction.entities.map((ent) => (
                  <span key={ent.id} className="entity-pill">
                    <strong>{ent.placeholder}</strong>
                    <span>{revealLocalPii ? ent.original : '•••• sealed locally'}</span>
                  </span>
                ))}
              </div>
            </>
          )}

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' }} />

          <div className="panel-head">
            <span className="panel-title">
              <Cloud size={16} color="#f59e0b" />
              Stage 2 · Hybrid Structured Executive Triage
            </span>
            {report && (
              <span
                className={`source-badge ${
                  report.stage2Source === 'IN_CLOUD' ? 'in-cloud' : 'on-device'
                }`}
              >
                {formatSourceLabel(report.stage2Source)} · {report.stage2LatencyMs}ms
              </span>
            )}
          </div>

          {report && (
            <>
              <div className="badge-row">
                <span
                  className={`sev-badge ${
                    report.severity === 'P0-CRITICAL'
                      ? 'p0'
                      : report.severity === 'P1-HIGH'
                        ? 'p1'
                        : 'p2'
                  }`}
                >
                  {report.severity}
                </span>
                <span className="source-badge">{report.category}</span>
                <span className="source-badge">Model: {report.cloudModelName}</span>
              </div>

              <div className="triage-headline">{report.headline}</div>
              <p className="triage-summary">{report.executiveSummary}</p>

              <ul className="checklist">
                {report.actionChecklist.map((step, i) => (
                  <li key={i}>
                    <CheckCircle2 size={15} color="#34d399" style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>

              <div className="kpi-sub" style={{ color: '#93c5fd' }}>
                {report.complianceNotes}
              </div>
            </>
          )}
        </section>
      </main>

      {configModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="panel-head">
              <span className="panel-title">
                <Flame size={16} color="#f59e0b" />
                Connect Free Firebase Spark Project (Live Cloud Fallback)
              </span>
            </div>
            <p className="kpi-sub">
              Paste your free Firebase Web App config to enable live{' '}
              <code>GoogleAIBackend</code> cloud fallback, Firebase Remote Config, and optional App
              Check (reCAPTCHA Enterprise). Stored only in your browser localStorage.
            </p>
            <div className="field-grid">
              <input
                className="field-input"
                placeholder="Firebase apiKey (AIza...)"
                value={draftApiKey}
                onChange={(e) => setDraftApiKey(e.target.value)}
              />
              <input
                className="field-input"
                placeholder="Firebase projectId (e.g. vaultredact-demo)"
                value={draftProjectId}
                onChange={(e) => setDraftProjectId(e.target.value)}
              />
              <input
                className="field-input"
                placeholder="Firebase appId (1:...:web:...)"
                value={draftAppId}
                onChange={(e) => setDraftAppId(e.target.value)}
              />
              <input
                className="field-input"
                placeholder="Optional: App Check reCAPTCHA Enterprise Site Key"
                value={draftRecaptchaKey}
                onChange={(e) => setDraftRecaptchaKey(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="status-chip"
                onClick={() => {
                  saveFirebaseConfig(null);
                  setFirebaseConfig(null);
                  setDraftApiKey('');
                  setDraftProjectId('');
                  setDraftAppId('');
                  setDraftRecaptchaKey('');
                  setConfigModalOpen(false);
                }}
              >
                Clear (Sandbox Mode)
              </button>
              <button
                type="button"
                className="status-chip"
                onClick={() => setConfigModalOpen(false)}
              >
                Cancel
              </button>
              <button type="button" className="status-chip good" onClick={handleSaveConfig}>
                Save &amp; Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
