import type { PiiEntity, PiiKind, RedactionResult } from './types';

interface RuleSpec {
  kind: PiiKind;
  pattern: RegExp;
  captureGroup?: number;
}

const PII_RULES: readonly RuleSpec[] = [
  {
    kind: 'EMAIL',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    kind: 'MRN',
    pattern: /\bMRN[-:\s]?[A-Z0-9]{5,12}\b/gi,
  },
  {
    kind: 'CARD',
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  },
  {
    kind: 'SSN_ID',
    pattern: /\b(?:\d{3}-\d{2}-\d{4}|[A-Z][12]\d{8})\b/g,
  },
  {
    kind: 'IPV4',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g,
  },
  {
    kind: 'PHONE',
    pattern: /(?:\+?\d{1,3}[-\s.]?)?(?:\(\d{2,4}\)|\d{2,4})[-\s.]\d{3,4}[-\s.]\d{3,4}\b/g,
  },
  {
    kind: 'PERSON',
    pattern:
      /(?:[Pp]atient|[Cc]ustomer|[Cc]aller|[Ww]itness|(?:[Ee]mergency\s+)?[Cc]ontact|[Rr]eporter|Dr\.|Mr\.|Ms\.|Mrs\.)\s*:?\s*([A-Z][a-z]{1,20}\s+[A-Z][a-z]{1,20})/g,
    captureGroup: 1,
  },
];

interface RawSpan {
  kind: PiiKind;
  original: string;
  start: number;
  end: number;
}

export function estimateTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export function redactLocalPii(inputText: string): RedactionResult {
  const rawSpans: RawSpan[] = [];

  for (const rule of PII_RULES) {
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(inputText)) !== null) {
      if (rule.captureGroup && match[rule.captureGroup]) {
        const groupText = match[rule.captureGroup];
        const groupOffset = match[0].indexOf(groupText);
        const start = match.index + groupOffset;
        rawSpans.push({
          kind: rule.kind,
          original: groupText,
          start,
          end: start + groupText.length,
        });
      } else {
        rawSpans.push({
          kind: rule.kind,
          original: match[0],
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }
  }

  // Sort by earliest start, then longest span first so overlapping spans resolve deterministically
  rawSpans.sort((a, b) => (a.start !== b.start ? a.start - b.start : b.end - a.end));

  const nonOverlapping: RawSpan[] = [];
  let cursor = -1;
  for (const span of rawSpans) {
    if (span.start >= cursor) {
      nonOverlapping.push(span);
      cursor = span.end;
    }
  }

  const countsByKind: Record<PiiKind, number> = {
    EMAIL: 0,
    PHONE: 0,
    SSN_ID: 0,
    CARD: 0,
    MRN: 0,
    IPV4: 0,
    PERSON: 0,
  };

  // Reuse identical placeholders if the same raw value appears multiple times
  const valueToPlaceholder = new Map<string, string>();
  const entities: PiiEntity[] = [];

  let out = '';
  let lastIndex = 0;

  for (const span of nonOverlapping) {
    const cacheKey = `${span.kind}::${span.original}`;
    let placeholder = valueToPlaceholder.get(cacheKey);
    if (!placeholder) {
      countsByKind[span.kind] += 1;
      placeholder = `[${span.kind}_${countsByKind[span.kind]}]`;
      valueToPlaceholder.set(cacheKey, placeholder);
    }

    out += inputText.slice(lastIndex, span.start) + placeholder;
    lastIndex = span.end;

    entities.push({
      id: `${span.kind}-${span.start}-${span.end}`,
      kind: span.kind,
      placeholder,
      original: span.original,
      start: span.start,
      end: span.end,
    });
  }
  out += inputText.slice(lastIndex);

  const zeroLeakVerified = verifyZeroRawPiiLeak(out, entities);

  return {
    originalText: inputText,
    redactedText: out,
    entities,
    countsByKind,
    zeroLeakVerified,
    estimatedTokens: estimateTokenCount(inputText),
  };
}

export function verifyZeroRawPiiLeak(redactedText: string, entities: readonly PiiEntity[]): boolean {
  for (const entity of entities) {
    if (entity.original.length >= 4 && redactedText.includes(entity.original)) {
      return false;
    }
  }
  return true;
}

export function restorePlaceholders(redactedText: string, entities: readonly PiiEntity[]): string {
  let restored = redactedText;
  const seen = new Set<string>();
  for (const entity of entities) {
    if (seen.has(entity.placeholder)) continue;
    seen.add(entity.placeholder);
    restored = restored.split(entity.placeholder).join(entity.original);
  }
  return restored;
}
