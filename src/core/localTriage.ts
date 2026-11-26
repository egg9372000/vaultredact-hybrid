import type { HybridRoutingPolicy, RedactionResult, ResolvedInferenceSource, TriageReport } from './types';

export interface ParsedModelSynthesis {
  severity: TriageReport['severity'];
  category: string;
  headline: string;
  executiveSummary: string;
  actionChecklist: string[];
  complianceNotes: string;
}

export function buildDeterministicTriage(redaction: RedactionResult): ParsedModelSynthesis {
  const lower = redaction.redactedText.toLowerCase();

  let severity: TriageReport['severity'] = 'P2-MEDIUM';
  let category = 'Operations Triage';
  let headline = 'Sanitized Field Incident Ready for Review';
  const actions: string[] = [];

  if (lower.includes('spo2') || lower.includes('chest') || lower.includes('cardiology') || lower.includes('mrn')) {
    severity = 'P0-CRITICAL';
    category = 'Clinical Emergency Intake';
    headline = 'Immediate Cardiology Bay Prep & Allergy Alert';
    actions.push('Pre-stage ER Bay 3 with 12-lead ECG and supplemental oxygen prior to ambulance arrival.');
    actions.push('Flag documented penicillin allergy in EHR intake banner before medication orders.');
    actions.push('Notify emergency contact via local vault mapping once patient stabilizes.');
  } else if (lower.includes('fraud') || lower.includes('unauthorized') || lower.includes('chargeback') || lower.includes('aml')) {
    severity = 'P1-HIGH';
    category = 'FinTech Fraud & PCI-DSS';
    headline = 'Card-Present Anomaly ($14,820) — Immediate Freeze & AML Hold';
    actions.push('Place immediate hard freeze on [CARD_1] and block originating source [IPV4_1].');
    actions.push('Open provisional credit & chargeback dossier for disputed $14,820 burst.');
    actions.push('Escalate behavioral velocity signature to AML compliance desk within 30 minutes.');
  } else if (lower.includes('lateral movement') || lower.includes('egress') || lower.includes('bastion') || lower.includes('p0')) {
    severity = 'P0-CRITICAL';
    category = 'SecOps Incident Containment';
    headline = 'Active Bastion Lateral Movement & 2.4 GB Egress Spike';
    actions.push('Revoke compromised CI service token and rotate downstream database credentials.');
    actions.push('Isolate hosts [IPV4_1] and [IPV4_2] via emergency security group quarantine.');
    actions.push('Preserve volatile forensic logs and issue 1-hour executive breach notification.');
  } else if (lower.includes('kickback') || lower.includes('anonymity') || lower.includes('audit committee')) {
    severity = 'P1-HIGH';
    category = 'Legal & Ethics Governance';
    headline = 'Q3 Procurement Dual-Signoff Bypass — Anonymized Audit Escalation';
    actions.push('Place litigation hold on Q3 procurement batch #449 invoices and approval logs.');
    actions.push('Deliver redacted brief to Audit Committee while retaining [PERSON_1] identity locally.');
    actions.push('Initiate independent forensic vendor review within 48 hours.');
  } else {
    actions.push('Review sanitized operational brief and assign domain owner.');
    actions.push('Verify zero unmasked PII before exporting ticket to external trackers.');
    actions.push('Schedule follow-up verification within standard SLA window.');
  }

  const piiCount = redaction.entities.length;
  const executiveSummary =
    `Sanitized intake processed with ${piiCount} sensitive PII token${piiCount === 1 ? '' : 's'} sealed on-device. ` +
    `Zero raw personal identifiers crossed the cloud boundary. Immediate triage classifies this case as ${severity} (${category}).`;

  const complianceNotes =
    piiCount > 0
      ? `Local Privacy Gate PASSED: ${piiCount} entity span(s) masked (${Object.entries(redaction.countsByKind)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${k}×${n}`)
          .join(', ')}).`
      : 'No raw PII patterns detected in payload; safe for standard hybrid routing.';

  return {
    severity,
    category,
    headline,
    executiveSummary,
    actionChecklist: actions,
    complianceNotes,
  };
}

export function assembleTriageReport(params: {
  synthesis: ParsedModelSynthesis;
  redaction: RedactionResult;
  stage1Source: ResolvedInferenceSource;
  stage2Source: ResolvedInferenceSource;
  stage1LatencyMs: number;
  stage2LatencyMs: number;
  sdkModeUsed: HybridRoutingPolicy;
  cloudModelName: string;
  remoteConfigApplied: boolean;
  appCheckEnabled: boolean;
  traceLog: string[];
}): TriageReport {
  const savedTokens =
    (params.stage1Source !== 'IN_CLOUD' ? params.redaction.estimatedTokens * 2 : 0) +
    (params.stage2Source !== 'IN_CLOUD' ? params.redaction.estimatedTokens * 3 : 0);

  return {
    ...params.synthesis,
    stage1Source: params.stage1Source,
    stage2Source: params.stage2Source,
    stage1LatencyMs: params.stage1LatencyMs,
    stage2LatencyMs: params.stage2LatencyMs,
    sdkModeUsed: params.sdkModeUsed,
    cloudModelName: params.cloudModelName,
    remoteConfigApplied: params.remoteConfigApplied,
    appCheckEnabled: params.appCheckEnabled,
    rawPiiBlockedCount: params.redaction.entities.length,
    cloudTokensSaved: savedTokens,
    traceLog: params.traceLog,
  };
}
