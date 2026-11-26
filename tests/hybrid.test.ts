import { describe, expect, it } from 'vitest';
import { InferenceMode } from 'firebase/ai';
import {
  buildHybridModelParams,
  DEFAULT_CLOUD_MODEL,
  mapPolicyToSdkMode,
} from '../src/ai/firebaseHybridEngine';
import { buildDeterministicTriage } from '../src/core/localTriage';
import {
  redactLocalPii,
  restorePlaceholders,
  verifyZeroRawPiiLeak,
} from '../src/core/piiRedactor';
import { SAMPLE_CASES } from '../src/core/samples';

describe('VaultRedact Hybrid — Privacy Boundary & Firebase AI Logic SDK', () => {
  it('masks all sensitive PII spans across all 4 field scenarios with zero raw leak', () => {
    for (const sample of SAMPLE_CASES) {
      const result = redactLocalPii(sample.rawText);
      expect(result.entities.length).toBeGreaterThanOrEqual(3);
      expect(result.zeroLeakVerified).toBe(true);
      expect(verifyZeroRawPiiLeak(result.redactedText, result.entities)).toBe(true);

      // Reversibility check: local vault can reconstruct the exact original text
      const restored = restorePlaceholders(result.redactedText, result.entities);
      expect(restored).toBe(sample.rawText);
    }
  });

  it('detects emails, phones, SSN/ID, cards, MRN, IPv4, and named persons accurately', () => {
    const text =
      'Patient: Elena Morales (MRN-904821A, SSN 412-88-3910) card 4532-8910-4421-9083 ip 185.220.101.47 call +1-415-890-4421 or elena@hospital.org.';
    const res = redactLocalPii(text);

    expect(res.countsByKind.PERSON).toBe(1);
    expect(res.countsByKind.MRN).toBe(1);
    expect(res.countsByKind.SSN_ID).toBe(1);
    expect(res.countsByKind.CARD).toBe(1);
    expect(res.countsByKind.IPV4).toBe(1);
    expect(res.countsByKind.PHONE).toBe(1);
    expect(res.countsByKind.EMAIL).toBe(1);
    expect(res.redactedText).not.toContain('Elena Morales');
    expect(res.redactedText).not.toContain('4532-8910-4421-9083');
    expect(res.redactedText).not.toContain('elena@hospital.org');

    // Regression check: lowercase "Emergency contact:" in ER sample must also mask both persons
    const erRes = redactLocalPii(SAMPLE_CASES[0].rawText);
    expect(erRes.countsByKind.PERSON).toBe(2);
    expect(erRes.redactedText).not.toContain('Elena Morales');
    expect(erRes.redactedText).not.toContain('Marcus Morales');
  });

  it('maps all 4 HybridRoutingPolicy modes cleanly to official Firebase AI Logic InferenceMode enums', () => {
    expect(mapPolicyToSdkMode('prefer_on_device')).toBe(InferenceMode.PREFER_ON_DEVICE);
    expect(mapPolicyToSdkMode('only_on_device')).toBe(InferenceMode.ONLY_ON_DEVICE);
    expect(mapPolicyToSdkMode('prefer_in_cloud')).toBe(InferenceMode.PREFER_IN_CLOUD);
    expect(mapPolicyToSdkMode('only_in_cloud')).toBe(InferenceMode.ONLY_IN_CLOUD);

    const hybridParams = buildHybridModelParams('prefer_on_device');
    expect(hybridParams.mode).toBe(InferenceMode.PREFER_ON_DEVICE);
    expect(hybridParams.inCloudParams?.model).toBe(DEFAULT_CLOUD_MODEL);
    expect(hybridParams.inCloudParams?.generationConfig?.responseMimeType).toBe('application/json');
    expect(hybridParams.onDeviceParams?.createOptions?.temperature).toBe(0.2);
  });

  it('produces structured P0/P1 triage output referencing only masked placeholders', () => {
    const erRedaction = redactLocalPii(SAMPLE_CASES[0].rawText);
    const erTriage = buildDeterministicTriage(erRedaction);
    expect(erTriage.severity).toBe('P0-CRITICAL');
    expect(erTriage.actionChecklist.length).toBe(3);

    const fraudRedaction = redactLocalPii(SAMPLE_CASES[1].rawText);
    const fraudTriage = buildDeterministicTriage(fraudRedaction);
    expect(fraudTriage.severity).toBe('P1-HIGH');
    expect(fraudTriage.actionChecklist[0]).toContain('[CARD_1]');
  });
});
