import type { SampleCase } from './types';

export const SAMPLE_CASES: readonly SampleCase[] = [
  {
    id: 'er-ambulance',
    title: 'ER Paramedic Field Intake',
    domain: 'Healthcare / Offline Zone',
    badge: 'HIPAA-Sensitive',
    recommendedOffline: true,
    rawText:
      'Field Unit 14 offline intake (tunnel dead-zone). Patient: Elena Morales (MRN-904821A, SSN 412-88-3910) presented with acute chest tightness and SpO2 dropping to 91%. Emergency contact: Marcus Morales at +1-415-890-4421 or marcus.morales@bayhealth.org. Allergic to penicillin. Request immediate cardiology bay prep and ECG upon arrival at ER Bay 3.',
  },
  {
    id: 'fintech-fraud',
    title: 'Wire & Card Fraud Escalation',
    domain: 'FinTech Compliance',
    badge: 'PCI-DSS',
    recommendedOffline: false,
    rawText:
      'Urgent dispute ticket! Customer: David Chen called from 408-555-0194 (email: d.chen.finance@protonmail.com) reporting unauthorized international charges totaling $14,820 on card 4532-8910-4421-9083 originating from IP 185.220.101.47 within 6 minutes. Customer confirmed card is still in possession. Freeze card immediately, issue chargeback dossier, and alert AML desk.',
  },
  {
    id: 'secops-breach',
    title: 'P0 Production SecOps Alert',
    domain: 'Cloud Security',
    badge: 'Zero-Trust',
    recommendedOffline: false,
    rawText:
      'P0 Incident detected at 02:14 UTC. Reporter: Priya Nair (priya.nair@acme-infra.io, mobile +1-650-712-8830) observed anomalous SSH lateral movement from 10.42.19.88 to database bastion 10.42.99.14 using a rotated CI service token. Active egress spike of 2.4 GB detected. Need immediate token revocation, bastion isolation, and board-ready incident summary.',
  },
  {
    id: 'hr-whistleblower',
    title: 'Confidential Ethics Hotline',
    domain: 'Legal / HR Vault',
    badge: 'Strict Local',
    recommendedOffline: true,
    rawText:
      'Confidential report submitted by Witness: Hannah Brooks (hannah.brooks.priv@gmail.com, tel 212-555-0148, ID A128493021). Observed vendor kickback invoices approved without dual-signoff in Q3 procurement batch #449. Witness requested complete anonymity before escalating sanitized facts to the Audit Committee.',
  },
];
