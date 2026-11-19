export type PromptGuardrailResult =
  | { ok: true; prompt: string }
  | { ok: false; reason: string };

const MIN_PROMPT_LEN = 10;
const MAX_PROMPT_LEN = 280;

const HARMFUL_PATTERN =
  /\b(die|death|dead|kill|killed|assassinate|assassination|murder|suicide|bombing|terrorist|overdose)\b/i;

const SELF_MANIPULATION_PATTERNS = [
  /\bwill\s+i\s+(tweet|post|publish|delete|say|write|stream|buy|sell|send|upload|release)\b/i,
  /\bwill\s+my\s+(repo|repository|account|channel|post|tweet|video|site|app|blog|stream)\b/i,
];

const INJECTION_PATTERN =
  /\b(ignore\s+(all\s+)?(previous|prior|above|system)\s+(instructions|rules)|reveal\s+(your\s+)?system\s+prompt|jailbreak)\b/i;

export function sanitizeAndCheckPrompt(rawPrompt: string): PromptGuardrailResult {
  const cleaned = rawPrompt
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < MIN_PROMPT_LEN) {
    return { ok: false, reason: `Prompt is too short (minimum ${MIN_PROMPT_LEN} characters).` };
  }
  if (cleaned.length > MAX_PROMPT_LEN) {
    return { ok: false, reason: `Prompt exceeds ${MAX_PROMPT_LEN} characters.` };
  }

  if (INJECTION_PATTERN.test(cleaned)) {
    return { ok: false, reason: "Prompt contains disallowed instruction-override language." };
  }
  if (HARMFUL_PATTERN.test(cleaned)) {
    return { ok: false, reason: "Markets about death, violence, or harm to people are not permitted." };
  }
  for (const pat of SELF_MANIPULATION_PATTERNS) {
    if (pat.test(cleaned)) {
      return { ok: false, reason: "Markets whose outcome you directly control are not permitted." };
    }
  }

  return { ok: true, prompt: cleaned };
}
