/**
 * L2 — 사용자 본인의 Claude API 키로 브라우저에서 바로 호출하는 경로. COACH_SPEC §4.
 *
 * SDK 는 **동적 import** 로만 부릅니다. Vite 가 이 모듈을 별도 청크로 쪼개 주므로, 키를 넣지 않은
 * 대다수 사용자에게는 SDK 번들 비용이 0 입니다. 키를 넣은 사람만 [바로 물어보기]를 누르는 순간
 * 받아 갑니다.
 *
 * 이 파일이 지키는 두 가지 약속:
 *   1. 던지는 Error 의 message 는 **언제나 한국어 한 줄**입니다. 화면이 그대로 토스트에 띄웁니다.
 *      갈래는 SDK 의 타입 있는 예외로만 나눕니다 — 오류 문자열을 매칭하면 SDK 판이 바뀔 때 조용히
 *      전부 "지금은 못 받았어요"로 뭉개집니다.
 *   2. AI 가 돌려준 카드도 규칙 카드와 **똑같은 린터**를 통과해야 나갑니다. 통과가 2장 미만이면
 *      빈 배열을 돌려주고, 호출자가 L0 화면으로 되돌립니다.
 *
 * `parseCoachCards` 는 네트워크와 무관한 순수 함수로 떼어 뒀습니다. 응답 파싱이 이 기능에서 가장
 * 잘 깨지는 자리인데, 순수하면 테스트로 고정할 수 있습니다.
 */
import type AnthropicSdk from '@anthropic-ai/sdk';

import { lintCards } from './lint';
import { COACH_SYSTEM_PROMPT, buildDigestSummary } from './prompt';
import type { CoachCard, CoachDigest } from './types';

/** 동적 import 로만 받는 모듈이라 예외 클래스의 타입도 여기서 꺼내 씁니다. */
type AnthropicModule = typeof import('@anthropic-ai/sdk');

export interface AskOptions {
  apiKey: string;
  model: string;
  signal?: AbortSignal;
}

/**
 * Opus 5 는 thinking 이 기본으로 켜져 있고, 그 토큰도 max_tokens 를 함께 씁니다.
 * 짧게 잡으면 생각하다가 잘려서 JSON 이 닫히지 않고 조용히 0장이 됩니다 — 답 길이는
 * max_tokens 가 아니라 프롬프트(짧게 쓰라)와 린터가 이미 강제하므로 여유를 줍니다.
 */
const MAX_TOKENS = 8000;
/** 린트를 통과한 카드가 이보다 적으면 답을 통째로 버립니다. */
const MIN_CARDS = 2;
const TONES: ReadonlyArray<CoachCard['tone']> = ['good', 'tendency', 'focus'];

/**
 * `output_config.effort` 는 opus 계열에만 보냅니다 — haiku 는 이 필드에서 에러가 납니다.
 * 판단(축·뭉치)은 이미 로컬에서 끝났고 AI 는 그걸 말로 푸는 역할이라 low 가 맞습니다.
 */
function supportsEffort(model: string): boolean {
  return /opus/i.test(model);
}

/** SDK 의 타입 있는 예외 → 한국어 한 줄. 순서는 좁은 것부터입니다. */
function koError(e: unknown, Anthropic: AnthropicModule['default']): Error {
  if (e instanceof Anthropic.APIUserAbortError) return new Error('요청을 멈췄어요');
  if (e instanceof Anthropic.AuthenticationError) return new Error('키가 맞지 않아요');
  if (e instanceof Anthropic.RateLimitError) return new Error('잠시 뒤에 다시 해 주세요');
  if (e instanceof Anthropic.APIError) return new Error('지금은 못 받았어요');
  return new Error('지금은 못 받았어요');
}

/** 코드 펜스가 붙어 오면 벗깁니다. 언어 태그(```json)가 붙는 경우까지 같이 처리합니다. */
function stripFences(text: string): string {
  return text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
}

/**
 * 앞뒤 인사말이 붙어 와도 배열 덩어리만 잘라냅니다.
 *
 * 첫 '['를 배열 시작으로 보면 안 됩니다 — 한국어 답변 머리말에 `[요약]` 같은 대괄호가 붙는 일이
 * 드물지 않고, 그러면 이 함수가 존재하는 이유(인사말 무시)에서 정확히 실패합니다.
 * 그래서 '['마다 시도해 보고 **실제로 파싱되는 배열**을 씁니다.
 */
function sliceArray(text: string): string | null {
  const end = text.lastIndexOf(']');
  if (end < 0) return null;
  for (let i = text.indexOf('['); i >= 0 && i < end; i = text.indexOf('[', i + 1)) {
    const body = text.slice(i, end + 1);
    try {
      if (Array.isArray(JSON.parse(body))) return body;
    } catch {
      /* 이 '[' 는 배열 시작이 아니었습니다 — 다음 것을 봅니다. */
    }
  }
  return null;
}

function asTone(v: unknown): CoachCard['tone'] {
  // tone 이 빠지거나 낯선 값이면 'focus' 로 둡니다 — 지적 카드가 기본값이어야 칭찬이 과장되지 않습니다.
  return typeof v === 'string' && (TONES as readonly string[]).includes(v) ? (v as CoachCard['tone']) : 'focus';
}

function asText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 한 항목을 CoachCard 로 정규화합니다. 계약을 못 채우면 null — 그 한 장만 버립니다. */
function toCard(v: unknown, index: number): CoachCard | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const title = asText(r.title);
  const evidence = asText(r.evidence);
  // 자르지 않습니다. 앞에서 slice 하면 모델이 질문을 4번째 줄에 둔 답은 질문이 사라져
  // 린터의 '마지막 줄은 질문' 규칙에 걸려 통째로 버려집니다. 줄 수 판정은 린터 한 곳에만 둡니다.
  const steps = Array.isArray(r.steps) ? r.steps.map(asText).filter((s) => s.length > 0) : [];
  if (!title || !evidence || steps.length < 2) return null;
  return { id: `ai-${index}`, tone: asTone(r.tone), title, evidence, steps, src: 'ai' };
}

/**
 * 응답 본문 → CoachCard[]. 순수 함수입니다.
 *
 * 깨진 JSON 에 예외를 던지지 않는 이유: 이 경로의 실패는 화면에서 "AI 답변이 너무 어려워서 걸렀어요"
 * 한 줄이고 L0 카드가 그대로 남습니다. 빈 배열이 그 뜻을 그대로 나타냅니다.
 */
export function parseCoachCards(text: string): CoachCard[] {
  const body = sliceArray(stripFences(text));
  if (!body) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const cards: CoachCard[] = [];
  parsed.forEach((item, i) => {
    const card = toCard(item, i);
    if (card) cards.push(card);
  });
  const passed = lintCards(cards);
  return passed.length < MIN_CARDS ? [] : passed;
}

/** 응답에서 텍스트 블록만 이어 붙입니다. thinking 블록은 파싱 대상이 아닙니다. */
function textOf(message: AnthropicSdk.Message): string {
  return message.content
    .filter((b): b is AnthropicSdk.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/**
 * 다이제스트 하나를 넣고 카드 배열 하나를 받습니다. 실패는 전부 한국어 한 줄 Error 로 나갑니다.
 *
 * `thinking` 은 보내지 않습니다 — Opus 5 는 기본이 adaptive 이고 `budget_tokens` 는 400 입니다.
 * 판단은 이미 로컬에서 끝났고 AI 는 그걸 말로 푸는 역할이라 effort 는 'low' 로 둡니다.
 */
export async function askClaude(d: CoachDigest, o: AskOptions): Promise<CoachCard[]> {
  // SDK 는 별도 청크라 여기서 처음 내려받습니다 — 네트워크가 끊겼으면 여기서 터집니다.
  // koError 는 Anthropic 모듈이 있어야 동작하므로 이 실패만 따로 잡습니다.
  let Anthropic: typeof import('@anthropic-ai/sdk').default;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    throw new Error('연결이 안 돼요');
  }

  try {
    // dangerouslyAllowBrowser 가 anthropic-dangerous-direct-browser-access 헤더를 붙입니다.
    // 이 헤더가 없으면 브라우저 직접 호출은 CORS 에서 막힙니다.
    const client = new Anthropic({ apiKey: o.apiKey, dangerouslyAllowBrowser: true });

    const params: AnthropicSdk.MessageCreateParamsNonStreaming = {
      model: o.model,
      max_tokens: MAX_TOKENS,
      system: COACH_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `# 이 사람의 기록\n\n${buildDigestSummary(d)}` }],
    };
    if (supportsEffort(o.model)) params.output_config = { effort: 'low' };

    const message = await client.messages.create(params, { signal: o.signal });
    // 길이에 걸려 잘린 답은 JSON 이 닫히지 않아 조용히 0장이 됩니다 — 그 이유를 사용자에게 말해 줍니다.
    if (message.stop_reason === 'max_tokens') throw new Error('답이 너무 길어서 잘렸어요');
    if (message.stop_reason === 'refusal') throw new Error('이 기록으로는 답하지 못했어요');
    return parseCoachCards(textOf(message));
  } catch (e) {
    // 위에서 만든 한국어 Error 는 그대로 통과시킵니다.
    if (e instanceof Error && !(e instanceof Anthropic.APIError)) throw e;
    throw koError(e, Anthropic);
  }
}
