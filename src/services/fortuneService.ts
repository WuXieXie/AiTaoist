import { Solar } from "lunar-javascript";
import { buildDailyShensha, buildDeterministicBazi } from "./shenshaRules";
import type { ToneMode } from "../types/toneMode";
import {
  buildCompatibilityRelationshipPrompt,
  DEFAULT_COMPATIBILITY_RELATIONSHIP,
  type CompatibilityRelationship,
} from "./compatibilityRelationship";

const defaultModel =
  process.env.OPENAI_DEFAULT_MODEL ||
  import.meta.env.VITE_OPENAI_DEFAULT_MODEL ||
  "gpt-5.4";
const ACCESS_KEY_STORAGE_KEY = "ai-taoist-access-key";
const HTML_RESPONSE_PATTERN = /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]/i;

function getAccessKey(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(ACCESS_KEY_STORAGE_KEY) || "";
}

export function setAccessKey(value: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const normalized = value.trim();
  if (!normalized) {
    window.localStorage.removeItem(ACCESS_KEY_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(ACCESS_KEY_STORAGE_KEY, normalized);
}

export function getStoredAccessKey(): string {
  return getAccessKey();
}

// Global model config defaults to gpt-5.4.
const Type = {
  OBJECT: "object",
  ARRAY: "array",
  STRING: "string",
  NUMBER: "number",
  INTEGER: "integer",
} as const;

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  description?: string;
  additionalProperties?: boolean;
};

type HexagramLine = "阳" | "阴";

const TRIGRAM_BY_PATTERN: Record<string, string> = {
  "111": "乾",
  "110": "兑",
  "101": "离",
  "100": "震",
  "011": "巽",
  "010": "坎",
  "001": "艮",
  "000": "坤",
};

const HEXAGRAM_NAME_BY_TRIGRAMS: Record<string, string> = {
  "乾/乾": "乾为天",
  "坤/坤": "坤为地",
  "坎/震": "水雷屯",
  "艮/坎": "山水蒙",
  "坎/乾": "水天需",
  "乾/坎": "天水讼",
  "坤/坎": "地水师",
  "坎/坤": "水地比",
  "巽/乾": "风天小畜",
  "乾/兑": "天泽履",
  "坤/乾": "地天泰",
  "乾/坤": "天地否",
  "乾/离": "天火同人",
  "离/乾": "火天大有",
  "坤/艮": "地山谦",
  "震/坤": "雷地豫",
  "兑/震": "泽雷随",
  "艮/巽": "山风蛊",
  "坤/兑": "地泽临",
  "巽/坤": "风地观",
  "离/震": "火雷噬嗑",
  "艮/离": "山火贲",
  "艮/坤": "山地剥",
  "坤/震": "地雷复",
  "乾/震": "天雷无妄",
  "艮/乾": "山天大畜",
  "艮/震": "山雷颐",
  "兑/巽": "泽风大过",
  "坎/坎": "坎为水",
  "离/离": "离为火",
  "兑/艮": "泽山咸",
  "震/巽": "雷风恒",
  "乾/艮": "天山遁",
  "震/乾": "雷天大壮",
  "离/坤": "火地晋",
  "坤/离": "地火明夷",
  "巽/离": "风火家人",
  "离/兑": "火泽睽",
  "坎/艮": "水山蹇",
  "震/坎": "雷水解",
  "艮/兑": "山泽损",
  "巽/震": "风雷益",
  "兑/乾": "泽天夬",
  "乾/巽": "天风姤",
  "兑/坤": "泽地萃",
  "坤/巽": "地风升",
  "兑/坎": "泽水困",
  "坎/巽": "水风井",
  "兑/离": "泽火革",
  "离/巽": "火风鼎",
  "震/震": "震为雷",
  "艮/艮": "艮为山",
  "巽/艮": "风山渐",
  "震/兑": "雷泽归妹",
  "震/离": "雷火丰",
  "离/艮": "火山旅",
  "巽/巽": "巽为风",
  "兑/兑": "兑为泽",
  "巽/坎": "风水涣",
  "坎/兑": "水泽节",
  "巽/兑": "风泽中孚",
  "震/艮": "雷山小过",
  "坎/离": "水火既济",
  "离/坎": "火水未济",
};

export type StreamRequestOptions = {
  onTextDelta?: (text: string) => void;
  signal?: AbortSignal;
};

function resolveToneMode(modeOrHarsh: ToneMode | boolean = "default"): ToneMode {
  if (typeof modeOrHarsh === "boolean") {
    return modeOrHarsh ? "harsh" : "default";
  }

  return modeOrHarsh;
}

function getTonePrompt(modeOrHarsh: ToneMode | boolean = "default"): string {
  const toneMode = resolveToneMode(modeOrHarsh);

  if (toneMode === "harsh") {
    return "【毒舌模式开启】：你的语言必须极其直白、尖锐、一针见血，不要任何委婉和安慰。";
  }

  if (toneMode === "sweet") {
    return "【甜嘴模式开启】：请尽量多讲优势、转机与值得期待之处，即使指出问题也要用温和鼓励的方式表达，避免刻薄打击。";
  }

  return "请用道家专业且慈悲的口吻进行解答。";
}

function normalizeSchema(schema: JsonSchema): JsonSchema {
  if (schema.type === Type.OBJECT) {
    const properties = Object.fromEntries(
      Object.entries(schema.properties || {}).map(([key, value]) => [key, normalizeSchema(value)])
    );

    return {
      ...schema,
      properties,
      additionalProperties: false,
    };
  }

  if (schema.type === Type.ARRAY && schema.items) {
    return {
      ...schema,
      items: normalizeSchema(schema.items),
    };
  }

  return schema;
}

function normalizeHexagramLine(line: string): HexagramLine | null {
  const normalized = line.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("阳") || normalized === "1") {
    return "阳";
  }

  if (normalized.includes("阴") || normalized === "0") {
    return "阴";
  }

  return null;
}

function normalizeHexagramLines(lines: string[] | undefined): HexagramLine[] | null {
  if (!Array.isArray(lines) || lines.length !== 6) {
    return null;
  }

  const normalized = lines
    .map((line) => normalizeHexagramLine(line))
    .filter((line): line is HexagramLine => Boolean(line));

  return normalized.length === 6 ? normalized : null;
}

function resolveHexagramName(lines: HexagramLine[] | null): string | null {
  if (!lines || lines.length !== 6) {
    return null;
  }

  const toBit = (line: HexagramLine) => (line === "阳" ? "1" : "0");
  const lowerPattern = lines.slice(0, 3).map(toBit).join("");
  const upperPattern = lines.slice(3, 6).map(toBit).join("");
  const lowerTrigram = TRIGRAM_BY_PATTERN[lowerPattern];
  const upperTrigram = TRIGRAM_BY_PATTERN[upperPattern];

  if (!lowerTrigram || !upperTrigram) {
    return null;
  }

  return HEXAGRAM_NAME_BY_TRIGRAMS[`${upperTrigram}/${lowerTrigram}`] || null;
}

function areHexagramLinesEqual(left: HexagramLine[] | null, right: HexagramLine[] | null): boolean {
  return Boolean(
    left &&
      right &&
      left.length === right.length &&
      left.every((line, index) => line === right[index])
  );
}

function normalizeLiuYaoResult(result: LiuYaoResult): LiuYaoResult {
  const benguaLines = normalizeHexagramLines(result.benguaLines);
  const bianguaLines = normalizeHexagramLines(result.bianguaLines);
  const benguaName = resolveHexagramName(benguaLines);
  const bianguaName = resolveHexagramName(bianguaLines);
  const hasBiangua =
    Boolean(bianguaName) &&
    !areHexagramLinesEqual(benguaLines, bianguaLines);

  return {
    ...result,
    bengua: benguaName || result.bengua,
    biangua: hasBiangua ? bianguaName || result.biangua : "无",
    benguaLines: benguaLines || result.benguaLines,
    bianguaLines: hasBiangua && bianguaLines ? bianguaLines : [],
  };
}

function buildHexagramInfoFromTosses(tosses: number[]) {
  if (tosses.length !== 6) {
    return null;
  }

  const benguaLines = tosses.map((toss) => (toss === 7 || toss === 9 ? "阳" : "阴")) as HexagramLine[];
  const bianguaLines = tosses.map((toss) => {
    if (toss === 6) {
      return "阳";
    }
    if (toss === 9) {
      return "阴";
    }
    return toss === 7 ? "阳" : "阴";
  }) as HexagramLine[];
  const benguaName = resolveHexagramName(benguaLines);
  const bianguaName = resolveHexagramName(bianguaLines);
  const hasBiangua =
    Boolean(bianguaName) &&
    !areHexagramLinesEqual(benguaLines, bianguaLines);

  return {
    benguaLines,
    bianguaLines,
    benguaName,
    bianguaName,
    hasBiangua,
  };
}

function extractTextFromResponsesPayload(payload: any): string {
  if (!Array.isArray(payload?.output)) {
    return "";
  }

  return payload.output
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .map((item: any) => (item?.type === "output_text" && typeof item.text === "string" ? item.text : ""))
    .join("");
}

function extractTextDeltaFromResponsesEvent(payload: any): string {
  if (payload?.type === "response.output_text.delta" && typeof payload.delta === "string") {
    return payload.delta;
  }

  return "";
}

function extractJsonCandidate(text: string): string | null {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = (fencedMatch?.[1] || text).trim();

  const openingChars = new Set(["{", "["]);
  const closingFor: Record<string, string> = {
    "{": "}",
    "[": "]",
  };

  for (let start = 0; start < source.length; start += 1) {
    const opener = source[start];
    if (!openingChars.has(opener)) {
      continue;
    }

    const stack: string[] = [closingFor[opener]];
    let inString = false;
    let escaping = false;

    for (let index = start + 1; index < source.length; index += 1) {
      const char = source[index];

      if (inString) {
        if (escaping) {
          escaping = false;
          continue;
        }

        if (char === "\\") {
          escaping = true;
          continue;
        }

        if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === "{" || char === "[") {
        stack.push(closingFor[char]);
        continue;
      }

      const expectedCloser = stack[stack.length - 1];
      if (char === expectedCloser) {
        stack.pop();
        if (stack.length === 0) {
          return source.slice(start, index + 1);
        }
      }
    }
  }

  return null;
}

function parseStructuredJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const candidate = extractJsonCandidate(text);

    if (candidate) {
      try {
        return JSON.parse(candidate) as T;
      } catch (candidateError) {
        console.error("Failed to parse extracted JSON candidate:", candidate);
        throw candidateError;
      }
    }

    console.error("Failed to parse JSON:", text);
    throw error;
  }
}

function parseJsonSafely<T>(rawPayload: string | null | undefined): T | null {
  if (!rawPayload) {
    return null;
  }

  try {
    return JSON.parse(rawPayload) as T;
  } catch {
    return null;
  }
}

function extractKeyErrorMessage(rawPayload: string | null | undefined, fallback: string, status?: number): string {
  const fallbackMessage = status ? `${fallback}（HTTP ${status}）` : fallback;

  if (!rawPayload) {
    return fallbackMessage;
  }

  const payload = parseJsonSafely<{ error?: { message?: string } | string; message?: string }>(rawPayload);
  const candidate =
    typeof payload?.error === "string"
      ? payload.error
      : payload?.error?.message || payload?.message || rawPayload;
  const normalized = candidate.replace(/\s+/g, " ").trim();

  if (!normalized || normalized.startsWith("<") || HTML_RESPONSE_PATTERN.test(normalized)) {
    return fallbackMessage;
  }

  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

function stripSpecificTimingInSummary(text: string): string {
  return text
    .replace(/\b(?:19|20)\d{2}\s*[-~—至到]\s*(?:19|20)\d{2}\b/g, "特定阶段")
    .replace(/\b(?:19|20)\d{2}年\b/g, "特定时期")
    .replace(/\b\d{1,2}\s*[-~—至到]\s*\d{1,2}岁\b/g, "特定年龄阶段")
    .replace(/\b\d{1,2}岁\b/g, "特定年龄阶段")
    .replace(/在特定时期(里|内|时)?/g, "在特定阶段")
    .replace(/到了特定时期/g, "到了特定阶段")
    .replace(/特定时期前后/g, "特定阶段前后")
    .replace(/特定时期左右/g, "特定阶段左右")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeWuxingRatio(
  ratio: BasicFortuneResult["wuxingRatio"]
): BasicFortuneResult["wuxingRatio"] {
  const safeValues = {
    metal: Number.isFinite(ratio?.metal) ? Math.max(0, ratio.metal) : 0,
    wood: Number.isFinite(ratio?.wood) ? Math.max(0, ratio.wood) : 0,
    water: Number.isFinite(ratio?.water) ? Math.max(0, ratio.water) : 0,
    fire: Number.isFinite(ratio?.fire) ? Math.max(0, ratio.fire) : 0,
    earth: Number.isFinite(ratio?.earth) ? Math.max(0, ratio.earth) : 0,
  };

  const total = Object.values(safeValues).reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return {
      metal: 20,
      wood: 20,
      water: 20,
      fire: 20,
      earth: 20,
    };
  }

  const normalizedEntries = Object.entries(safeValues).map(([key, value]) => [
    key,
    Number(((value / total) * 100).toFixed(1)),
  ]);

  const normalized = Object.fromEntries(normalizedEntries) as BasicFortuneResult["wuxingRatio"];
  const normalizedTotal = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  const diff = Number((100 - normalizedTotal).toFixed(1));

  if (diff !== 0) {
    const largestKey = (Object.entries(normalized) as Array<[keyof BasicFortuneResult["wuxingRatio"], number]>)
      .sort((a, b) => b[1] - a[1])[0]?.[0];

    if (largestKey) {
      normalized[largestKey] = Number((normalized[largestKey] + diff).toFixed(1));
    }
  }

  return normalized;
}

type BasicFortuneModelPayload = Omit<BasicFortuneResult, "bazi">;

function sanitizeBasicFortuneSummaries(result: BasicFortuneModelPayload): BasicFortuneModelPayload {
  return {
    ...result,
    wuxingRatio: normalizeWuxingRatio(result.wuxingRatio),
    overall: stripSpecificTimingInSummary(result.overall),
    health: stripSpecificTimingInSummary(result.health),
    character: stripSpecificTimingInSummary(result.character),
    wealthSummary: stripSpecificTimingInSummary(result.wealthSummary),
    careerSummary: stripSpecificTimingInSummary(result.careerSummary),
    emotionSummary: stripSpecificTimingInSummary(result.emotionSummary),
    familySummary: stripSpecificTimingInSummary(result.familySummary),
  };
}

async function readStreamingResponses(response: Response, onTextDelta?: (text: string) => void): Promise<string> {
  if (!response.body) {
    throw new Error("Streaming response body is missing.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let aggregatedText = "";

  const flushEvent = (eventBlock: string) => {
    const lines = eventBlock.split(/\r?\n/);

    for (const line of lines) {
      if (!line.startsWith("data:")) {
        continue;
      }

      const payloadText = line.slice(5).trim();
      if (!payloadText || payloadText === "[DONE]") {
        continue;
      }

      try {
        const payload = JSON.parse(payloadText);
        const deltaText = extractTextDeltaFromResponsesEvent(payload);

        if (deltaText) {
          aggregatedText += deltaText;
          onTextDelta?.(aggregatedText);
          continue;
        }

        if (payload?.type === "response.output_text.done" && typeof payload.text === "string" && payload.text.length >= aggregatedText.length) {
          aggregatedText = payload.text;
          onTextDelta?.(aggregatedText);
          continue;
        }

        if (payload?.type === "response.completed") {
          const completedText = extractTextFromResponsesPayload(payload.response);
          if (completedText && completedText.length >= aggregatedText.length) {
            aggregatedText = completedText;
            onTextDelta?.(aggregatedText);
          }
        }
      } catch (error) {
        console.warn("Failed to parse responses streaming chunk:", error);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let separatorMatch = buffer.match(/\r?\n\r?\n/);
    while (separatorMatch && separatorMatch.index !== undefined) {
      const separatorIndex = separatorMatch.index;
      const separatorLength = separatorMatch[0].length;
      const eventBlock = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + separatorLength);
      flushEvent(eventBlock);
      separatorMatch = buffer.match(/\r?\n\r?\n/);
    }

    if (done) {
      if (buffer.trim()) {
        flushEvent(buffer);
      }
      break;
    }
  }

  return aggregatedText;
}

async function generateStructuredOutputText({
  schemaName: _schemaName,
  model: _model,
  systemInstruction: _systemInstruction,
  prompt: _prompt,
  schema: _schema,
  onTextDelta: _onTextDelta,
  signal: _signal,
}: {
  schemaName: string;
  model?: string;
  systemInstruction: string;
  prompt: string;
  schema: JsonSchema;
  onTextDelta?: (text: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  throw new Error("Legacy OpenAI proxy path is disabled. Use /api/fortune business endpoints.");
}

async function generateStructuredOutput<T>({
  schemaName,
  model,
  systemInstruction,
  prompt,
  schema,
  onTextDelta,
  signal,
}: {
  schemaName: string;
  model?: string;
  systemInstruction: string;
  prompt: string;
  schema: JsonSchema;
  onTextDelta?: (text: string) => void;
  signal?: AbortSignal;
}): Promise<T> {
  const text = await generateStructuredOutputText({
    schemaName,
    model,
    systemInstruction,
    prompt,
    schema,
    onTextDelta,
    signal,
  });

  return parseStructuredJson<T>(text);
}

async function requestFortuneOutputText({
  kind,
  payload,
  model,
  onTextDelta,
  signal,
}: {
  kind: string;
  payload: Record<string, unknown>;
  model?: string;
  onTextDelta?: (text: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const response = await fetch("/api/fortune", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-key": getAccessKey(),
    },
    signal,
    body: JSON.stringify({
      kind,
      model: model || currentModel,
      payload,
    }),
  });

  if (!response.ok) {
    const rawPayload = await response.text();
    throw new Error(extractKeyErrorMessage(rawPayload, "请求失败，请稍后再试。", response.status));
  }

  const text = await readStreamingResponses(response, onTextDelta);
  if (!text) {
    throw new Error("No structured content returned from OpenAI.");
  }

  return text;
}

async function requestFortuneOutput<T>({
  kind,
  payload,
  onTextDelta,
  signal,
}: {
  kind: string;
  payload: Record<string, unknown>;
  onTextDelta?: (text: string) => void;
  signal?: AbortSignal;
}): Promise<T> {
  const text = await requestFortuneOutputText({
    kind,
    payload,
    onTextDelta,
    signal,
  });

  return parseStructuredJson<T>(text);
}

const ai = {
  models: {
    async generateContent({
      model,
      contents,
      config,
    }: {
      model: string;
      contents: string;
      config: {
        systemInstruction: string;
        responseMimeType?: string;
        responseSchema: JsonSchema;
        onTextDelta?: (text: string) => void;
        signal?: AbortSignal;
      };
    }) {
      const text = await generateStructuredOutputText({
        schemaName: "fortune_response",
        model,
        systemInstruction: config.systemInstruction,
        prompt: contents,
        schema: config.responseSchema,
        onTextDelta: config.onTextDelta,
        signal: config.signal,
      });

      return {
        text,
      };
    },
  },
};

let currentModel = defaultModel;

// 暴露全局设置和获取模型的方法
export const setModel = (modelName: string) => {
  currentModel = modelName;
};

export const getModel = () => currentModel;

export interface ShenshaInfo {
  name: string;
  description: string;
}

export interface PillarData {
  ganzhi: string;
  canggan: string;
  shensha: ShenshaInfo[];
}

export interface BasicFortuneResult {
  bazi: {
    year: PillarData;
    month: PillarData;
    day: PillarData;
    hour: PillarData;
  };
  yongshen: {
    xi: string;
    ji: string;
    yong: string;
  };
  wuxingRatio: {
    metal: number;
    wood: number;
    water: number;
    fire: number;
    earth: number;
  };
  wuxing: string;
  overall: string;
  health: string;
  character: string;
  wealthSummary: string;
  careerSummary: string;
  emotionSummary: string;
  familySummary: string;
}

export interface DayunPhase {
  period: string;
  ganzhi: string;
  description: string;
  wuxingPreference: string;
  wealthDescription: string;
  emotionDescription: string;
  careerDescription: string;
  familyDescription: string;
  healthDescription: string;
  score: number;
  wealthScore: number;
  emotionScore: number;
  healthScore: number;
  careerScore: number;
  familyScore: number;
  liunian: {
    year: number;
    age: number;
    ganzhi: string;
    score: number;
    wealthScore: number;
    emotionScore: number;
    healthScore: number;
    careerScore: number;
    familyScore: number;
    description: string;
    wuxingPreference: string;
    wealthDescription: string;
    emotionDescription: string;
    careerDescription: string;
    familyDescription: string;
    healthDescription: string;
  }[];
}

export interface DayunFortuneResult {
  dayun: DayunPhase[];
}

export interface CompatibilityResult {
  person1Bazi: string;
  person2Bazi: string;
  overallScore: number;
  emotionAnalysis: string;
  interactionPattern: string;
  futureDirection: string;
  suggestions: string;
}

// 基础请求：排盘与一生总运
export async function calculateBasicFortune(
  gender: string,
  birthDate: string,
  birthTime: string,
  toneMode: ToneMode | boolean = "default",
  options?: StreamRequestOptions
): Promise<BasicFortuneResult> {
  {
    const [year, month, day] = birthDate.split('-').map(Number);
    const [hour, minute] = birthTime.split(':').map(Number);
    const solar = Solar.fromYmdHms(year, month, day, hour, minute, 0);
    const lunar = solar.getLunar();
    const exactBazi = `${lunar.getEightChar().getYear()} ${lunar.getEightChar().getMonth()} ${lunar.getEightChar().getDay()} ${lunar.getEightChar().getTime()}`;
    const text = await requestFortuneOutputText({
      kind: "basicFortune",
      payload: { gender, birthDate, birthTime, toneMode: resolveToneMode(toneMode) },
      onTextDelta: options?.onTextDelta,
      signal: options?.signal,
    });

    try {
      const parsed = parseStructuredJson<BasicFortuneModelPayload>(text);
      const sanitized = sanitizeBasicFortuneSummaries(parsed);
      return {
        ...sanitized,
        bazi: buildDeterministicBazi(exactBazi),
      };
    } catch {
      throw new Error("基础信息解析失败。");
    }
  }

  const harshPrompt = getTonePrompt(toneMode);

  const [year, month, day] = birthDate.split('-').map(Number);
  const [hour, minute] = birthTime.split(':').map(Number);
  const solar = Solar.fromYmdHms(year, month, day, hour, minute, 0);
  const lunar = solar.getLunar();
  const exactBazi = `${lunar.getEightChar().getYear()} ${lunar.getEightChar().getMonth()} ${lunar.getEightChar().getDay()} ${lunar.getEightChar().getTime()}`;

  const prompt = `
你是一个深耕中国传统命理的道士，精通八字。请根据以下求测者的出生信息，进行八字排盘，并给出详细的命理测算结果。
${harshPrompt}

求测者信息：
性别：${gender}
出生日期（公历）：${birthDate}
出生时间：${birthTime}

【核心推演典籍准则（极其重要）】：
1. 根据万年历精确推算，该用户的准确四柱八字为：${exactBazi}。请务必基于此八字进行推演。
2. 神煞展示由系统按固定规则计算；你在正文中若需引用神煞，只可将其作为辅助参考，不得自创、误排或用神煞推翻旺衰格局判断。
3. 喜忌神以《渊海子平》《子平真诠》为基础，以《滴天髓阐微》为核心。
4. 整体命格(overall)以《渊海子平》《三命通会》为核心，深入剖析一生格局、层次、潜在成就与危机。
5. 性格特质(character)以《子平真诠》为核心，深层剖析其内在心性与外在表现。
6. 财运总评(wealthSummary)以《三命通会》为核心，分析一生的财富格局与机遇。
7. 事业总评(careerSummary)以《子平真诠》《滴天髓阐微》为核心，指点一生事业方向与成就。
8. 情感婚姻(emotionSummary)以《渊海子平》《神峰通考》为核心，分析婚姻本质、配偶质量及何时到来。
9. 家庭与六亲(familySummary)以《三命通会》《古代命理探源》为核心，进行六亲缘分总评。
10. 健康分析必须以《穷通宝鉴》为核心，重四时五行调候，按季节（春夏秋冬）详细分析五行寒暖燥湿对命主健康的影响。

【极其严格的字数铁律】：
针对总运分析模块中的**所有8个类别**（五行喜忌、整体命格、健康调候、性格特质、一生财运、一生事业、一生情感、一生家庭），**每一条单独的论述都必须绝对不少于 100 字！** 请彻底放开字数限制，引经据典，进行极其深度且详尽的长篇大论剖析，千万不要一笔带过！

请严格按照要求的JSON格式返回测算结果。
`;

  const concisePrompt = `${prompt}

【补充输出要求】：
1. 推演顺序必须清晰：先判断日主旺衰，再判断月令、通根、透干、扶抑与调候，再区分格局、用神、喜神、忌神，最后再展开整体命格及人生分项分析；但这些步骤只作为内部推演依据，不要在最终输出中按“第一步、第二步”逐条展开。
2. 五行喜忌(wuxing)与喜忌用神(yongshen)请简洁作答，直接说明日主旺衰、喜神、忌神、用神与判断依据，避免长篇展开，但结论必须明确。
3. “格局”“用神”“喜神”“忌神”必须严格区分，不可混用，不可用空泛套话代替判断。
4. 神煞只可作为辅助参考，不能凌驾于五行生克、旺衰、格局、调候之上，更不能用神煞推翻主判断。
5. 所有结论必须与给定四柱原局严格一致，不得擅自改动八字、藏干、十神关系、旺衰判断，也不要前后结论矛盾。
6. 整体命格(overall)保持原有分析深度，不要因为本条补充要求而缩短，并且必须建立在前面旺衰、格局、用神判断一致的基础上。
7. 健康、性格、财运、事业、情感、家庭仍保持充分展开。
8. 尤其是 overall、wealthSummary、careerSummary、emotionSummary、familySummary，要写成凝练的总结性论述，不要输出逐步推演过程本身；重点归纳命局主线、人生起伏、关键阶段，并点明在哪些特殊时期较易应重大事件。
9. 总运相关内容严禁写出具体年份、具体年龄、某年某岁发生何事，只能用青年期、中年前后、某一阶段、特定时期等概括性说法。`;

  const conciseSystemInstruction = "你是一个深耕中国传统命理的道士，精通八字。擅长引经据典，严格遵照子平、三命通会等古籍推演。语气要专业、玄妙、带有道家的人文关怀。推演时必须先定旺衰，再定格局，再定调候与用神，最后展开总论与分论，但这些步骤只作为内部推演链路，不要在最终输出里逐条展示。五行喜忌与喜忌用神写得简洁明快即可，但判断必须清楚；整体命格、健康、性格、财运、事业、情感、家庭仍按原有深度充分展开。输出时以总结性论述为主，直接归纳命局主线、阶段变化与关键时期征象，尤其要点出较易发生大事的特殊时期，但总运相关内容不得出现具体年份、具体年龄或某年某岁事件，避免“第一步、第二步、最后”式过程复述。神煞仅作辅助，不得推翻主判断。";

  const response = await ai.models.generateContent({
    model: currentModel,
    contents: concisePrompt,
    config: ((config) => ({
      ...config,
      systemInstruction: conciseSystemInstruction,
      onTextDelta: options?.onTextDelta,
      signal: options?.signal,
    }))({
      systemInstruction: "你是一个深耕中国传统命理的道士，精通八字。擅长引经据典，严格遵照子平、三命通会等古籍推演。你说话毫不吝啬字数，总运分析中的每一项评语都必须绝对不少于100字。语气要专业、玄妙、带有道家的人文关怀。内部必须完整推演，但对外不要逐条展示每一步过程，而要写成有整体感的命理论断，归纳命局主线、起伏转折与关键时期。总运内容不要出现具体年份、具体年龄和某年某岁事件。", 
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          bazi: {
            type: Type.OBJECT,
            properties: {
              year: { type: Type.OBJECT, properties: { ganzhi: { type: Type.STRING }, canggan: { type: Type.STRING }, shensha: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, description: { type: Type.STRING } }, required: ["name", "description"] } } }, required: ["ganzhi", "canggan", "shensha"] },
              month: { type: Type.OBJECT, properties: { ganzhi: { type: Type.STRING }, canggan: { type: Type.STRING }, shensha: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, description: { type: Type.STRING } }, required: ["name", "description"] } } }, required: ["ganzhi", "canggan", "shensha"] },
              day: { type: Type.OBJECT, properties: { ganzhi: { type: Type.STRING }, canggan: { type: Type.STRING }, shensha: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, description: { type: Type.STRING } }, required: ["name", "description"] } } }, required: ["ganzhi", "canggan", "shensha"] },
              hour: { type: Type.OBJECT, properties: { ganzhi: { type: Type.STRING }, canggan: { type: Type.STRING }, shensha: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, description: { type: Type.STRING } }, required: ["name", "description"] } } }, required: ["ganzhi", "canggan", "shensha"] },
            },
            required: ["year", "month", "day", "hour"],
          },
          yongshen: {
            type: Type.OBJECT,
            properties: {
              xi: { type: Type.STRING },
              ji: { type: Type.STRING },
              yong: { type: Type.STRING },
            },
            required: ["xi", "ji", "yong"],
          },
          wuxingRatio: {
            type: Type.OBJECT,
            properties: {
              metal: { type: Type.NUMBER },
              wood: { type: Type.NUMBER },
              water: { type: Type.NUMBER },
              fire: { type: Type.NUMBER },
              earth: { type: Type.NUMBER },
            },
            required: ["metal", "wood", "water", "fire", "earth"],
          },
          wuxing: { type: Type.STRING, description: "五行强弱及喜忌分析" },
          overall: { type: Type.STRING, description: "整体命格极其详尽的分析（道家口吻，深入剖析格局、层次、成就与危机）" },
          health: { type: Type.STRING, description: "健康分析（以《穷通宝鉴》为核心，重四时五行调候，按季节分析五行寒暖燥湿）" },
          character: { type: Type.STRING, description: "性格特质深层剖析" },
          wealthSummary: { type: Type.STRING, description: "一生财运总评与财富格局分析" },
          careerSummary: { type: Type.STRING, description: "一生事业总评与发展方向指导" },
          emotionSummary: { type: Type.STRING, description: "一生情感总评、婚姻本质与配偶分析" },
          familySummary: { type: Type.STRING, description: "一生家庭关系、六亲缘分总评" },
        },
        required: ["bazi", "yongshen", "wuxingRatio", "wuxing", "overall", "health", "character", "wealthSummary", "careerSummary", "emotionSummary", "familySummary"],
      },
    }),
  });

  const text = response.text;
  if (!text) throw new Error("未能获取基础测算结果，请稍后再试。");
  
  try {
    const parsed = parseStructuredJson<BasicFortuneModelPayload>(text);
    const sanitized = sanitizeBasicFortuneSummaries(parsed);
    return {
      ...sanitized,
      bazi: buildDeterministicBazi(exactBazi),
    };
  } catch (e) {
    throw new Error("基础信息解析失败。");
  }
}

// 拆分请求二（批处理请求）：精算大运流年，强力阻止年份丢失与字数缩水
export async function calculateBatchDayunFortune(
  gender: string,
  birthDate: string,
  birthTime: string,
  exactBazi: string,
  skeleton: any[],
  toneMode: ToneMode | boolean = "default",
  includeLiunian: boolean = true,
  options?: StreamRequestOptions
): Promise<DayunPhase[]> {
  {
    const text = await requestFortuneOutputText({
      kind: "dayunBatch",
      payload: {
        gender,
        birthDate,
        birthTime,
        exactBazi,
        skeleton,
        toneMode: resolveToneMode(toneMode),
        includeLiunian,
      },
      onTextDelta: options?.onTextDelta,
      signal: options?.signal,
    });

    try {
      const parsed = parseStructuredJson<any>(text);
      const dayunResult = parsed.dayun as DayunPhase[];

      if (dayunResult.length !== skeleton.length) {
        throw new Error(`大运数量丢失 (期望 ${skeleton.length}, 实际 ${dayunResult.length})`);
      }
      if (includeLiunian) {
        for (let i = 0; i < dayunResult.length; i++) {
          const expectedLiunianCount = skeleton[i].liunian ? skeleton[i].liunian.length : 0;
          const actualLiunianCount = dayunResult[i].liunian ? dayunResult[i].liunian.length : 0;
          if (actualLiunianCount !== expectedLiunianCount) {
            throw new Error(`流年年份丢失 (大运 ${dayunResult[i].ganzhi} 期望 ${expectedLiunianCount}年, 实际返回 ${actualLiunianCount}年)`);
          }
        }
      }

      return dayunResult;
    } catch (e: any) {
      console.warn("AI输出数据不完整或解析失败，触发重试拦截:", e.message);
      throw new Error("AI偷偷省略了部分年份，触发数据补全重试。");
    }
  }

  const harshPrompt = getTonePrompt(toneMode);

  const skeletonJson = JSON.stringify(skeleton, null, 2);

  const prompt = `
你是一个深耕中国传统命理的道士，精通八字。请根据以下求测者的出生信息，为【特定批次的大运${includeLiunian ? '及其包含的流年' : ''}】进行推演。
${harshPrompt}

求测者信息：
性别：${gender}
出生日期：${birthDate} ${birthTime}
八字：${exactBazi}

【核心推演体系：四柱协同体系】：
1. **理论框架**：以“格局为纲、用神为核、调候为先、岁运互动为用”为核心。以《子平真诠》格局法与《滴天髓》岁运论为主导，结合旺衰扶抑、病药通关，按固定流程分层校验。**大运及流年的推演计算中，绝对不考虑任何神煞**，仅以五行生克制化、刑冲合害为依据。
2. **大运推演流程**：
   - 第一层（调候）：校验寒暖燥湿是否得到调和。
   - 第二层（格局）：分析大运干支对原局格局是成局、破局还是救应。
   - 第三层（用神）：考察大运对喜忌用神的生克制化（旺衰扶抑、病药通关）。
   - 第四层（互动）：详查大运与原局的刑冲合害关系。
${includeLiunian ? `3. **流年推演流程**：
   - 将流年干支与大运、原局结合，进行三者（原局、大运、流年）之间的综合作用分析。
   - 重点考察流年对大运和原局的引动（如岁运并临、天克地冲、三合三会等），断定该年具体的吉凶祸福。
4. **绝不遗漏年份（死命令）**：本次请求包含 ${skeleton.length} 个大运。请严格按照骨架中提供的流年年份进行推演。如果某个大运的骨架中没有流年（或流年数组为空），则该大运不需要推演流年；如果骨架中包含流年，则必须**逐一原样保留**骨架中的每一个流年，**绝对不能为了节省字数而跳过、省略或删减任何一个年份**！只要漏掉一年，你的测算就将被判为失败！` : ''}
${includeLiunian ? '5' : '3'}. **评分机制（0-100分）**：
   - 评分必须严格基于上述的分层校验结果。
   - 若调候到位、格局得成、用神得助，则为高分（80-100）。
   - 若格局破败、用神受克、刑冲严重，则为低分（0-40）。
   - 平常年份或吉凶参半则为中等分数（40-80）。
   - 财运、情感、事业、健康、家庭的单项评分也必须遵循此逻辑，根据五行十神的喜忌和岁运互动来独立打分。
${includeLiunian ? '6' : '4'}. **详尽描述要求**：
   - 大运和流年的整体描述（description）以及各项具体描述（财运、情感、事业、家庭、健康）必须详细具体，**每条评价至少包含30个字**，切忌空洞敷衍。

传入的待填空骨架如下（请原封不动地以此为基础填满所有字段，切勿删减元素）：
${skeletonJson}
`;

  const refinedPrompt = `${prompt}

【补充推演要求】：
1. 判断顺序必须固定：先看原局，再看大运，再看流年；先解释作用原因，再下吉凶结论，再落到财运、事业、情感、健康、家庭等分项，但这些步骤只作为内部推演顺序，不要在最终文案中逐条展开。
2. 原局是底盘，大运是阶段主气，流年是当年触发点。不得用流年结论反客为主，覆盖原局与大运的主判断。
3. 每步大运需先说明该十年属于扶身、耗身、成局、破局、调候改善、刑冲变化中的哪一种主趋势，再展开分项分析。
4. 每个流年需先说明它是如何引动原局与大运的，再说明具体容易体现在哪些领域，避免只给空泛结论。
5. 评分必须严格依附于调候是否改善、格局是否成败、用神是否得力、刑冲合害是否明显，不可只凭语气高低打分。
6. 财运、事业、情感、健康、家庭的单项评分，也必须基于对应十神、五行喜忌及岁运互动分别判断，不得机械复制总分逻辑。
7. 所有大运与流年结论都必须与原局喜忌、格局和用神判断保持一致，不得前后矛盾。
8. 神煞在大运流年中仍只可作为辅助参考，不得凌驾于五行生克、十神、调候、刑冲合害之上。
9. 流年分析要尽量写成“高概率趋势、风险点、触发条件、体现领域”，避免无依据的绝对化断语。
10. 必须完整保留输入骨架中的全部大运与流年，不得遗漏、合并、改写年份顺序或删减字段。
11. 最终输出应写成总结性论述：概括阶段主线、吉凶起伏、风险与机会，并点出哪些年份或阶段较易应事；不要把推演过程写成“先看什么、再看什么、第三看什么”的逐步记录。`;

  const refinedSystemInstruction = `你是一个深耕中国传统命理的道士。精通八字大运流年推演，以“格局为纲、用神为核、调候为先、岁运互动为用”的体系进行推演。推演时必须先看原局，再看大运，再看流年；先说明作用机制，再给结论与评分，但这些只作为内部推演链路，不要在最终输出中逐步展示。大运重在判断十年主线与阶段主气，流年重在判断具体引动与落点。评分必须有依据，不可空泛打分。最终文案要写成一段有概括力的命理总结，归纳阶段主线、现实落点与关键流年，尤其指出较易出现大事、转折、冲击或突破的时期。${includeLiunian ? '必须完整返回输入的所有年份，严禁遗漏流年数据！' : ''}必须保证每条评价（包括整体、财运、事业等）至少30个字。`;

  const dayunProperties: any = {
    period: { type: Type.STRING },
    ganzhi: { type: Type.STRING },
    description: { type: Type.STRING },
    wuxingPreference: { type: Type.STRING },
    wealthDescription: { type: Type.STRING },
    emotionDescription: { type: Type.STRING },
    careerDescription: { type: Type.STRING },
    familyDescription: { type: Type.STRING },
    healthDescription: { type: Type.STRING },
    score: { type: Type.INTEGER },
    wealthScore: { type: Type.INTEGER },
    emotionScore: { type: Type.INTEGER },
    healthScore: { type: Type.INTEGER },
    careerScore: { type: Type.INTEGER },
    familyScore: { type: Type.INTEGER },
  };

  const dayunRequired = ["period", "ganzhi", "description", "wuxingPreference", "wealthDescription", "emotionDescription", "careerDescription", "familyDescription", "healthDescription", "score", "wealthScore", "emotionScore", "healthScore", "careerScore", "familyScore"];

  if (includeLiunian) {
    dayunProperties.liunian = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          year: { type: Type.INTEGER },
          age: { type: Type.INTEGER },
          ganzhi: { type: Type.STRING },
          score: { type: Type.INTEGER },
          wealthScore: { type: Type.INTEGER },
          emotionScore: { type: Type.INTEGER },
          healthScore: { type: Type.INTEGER },
          careerScore: { type: Type.INTEGER },
          familyScore: { type: Type.INTEGER },
          description: { type: Type.STRING },
          wuxingPreference: { type: Type.STRING },
          wealthDescription: { type: Type.STRING },
          emotionDescription: { type: Type.STRING },
          careerDescription: { type: Type.STRING },
          familyDescription: { type: Type.STRING },
          healthDescription: { type: Type.STRING }
        },
        required: ["year", "age", "ganzhi", "score", "wealthScore", "emotionScore", "healthScore", "careerScore", "familyScore", "description", "wuxingPreference", "wealthDescription", "emotionDescription", "careerDescription", "familyDescription", "healthDescription"]
      }
    };
    dayunRequired.push("liunian");
  }

  const response = await ai.models.generateContent({
    model: currentModel,
    contents: refinedPrompt,
    config: {
      systemInstruction: refinedSystemInstruction,
      onTextDelta: options?.onTextDelta,
      signal: options?.signal,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          dayun: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: dayunProperties,
              required: dayunRequired
            }
          }
        },
        required: ["dayun"]
      },
    },
  });

  const text = response.text;
  if (!text) throw new Error("未能获取批次大运测算结果。");
  
  try {
    const parsed = parseStructuredJson<any>(text);
    const dayunResult = parsed.dayun as DayunPhase[];
    
    // 强制验证大模型是否私自删减了流年年份 (触发拦截以保障数据完整性)
    if (dayunResult.length !== skeleton.length) {
      throw new Error(`大运数量丢失 (期望 ${skeleton.length}, 实际 ${dayunResult.length})`);
    }
    if (includeLiunian) {
      for (let i = 0; i < dayunResult.length; i++) {
        const expectedLiunianCount = skeleton[i].liunian ? skeleton[i].liunian.length : 0;
        const actualLiunianCount = dayunResult[i].liunian ? dayunResult[i].liunian.length : 0;
        if (actualLiunianCount !== expectedLiunianCount) {
          throw new Error(`流年年份丢失 (大运 ${dayunResult[i].ganzhi} 期望 ${expectedLiunianCount}年, 实际返回 ${actualLiunianCount}年)`);
        }
      }
    }
    
    return dayunResult;
  } catch (e: any) {
    console.warn("AI输出数据不完整或解析失败，触发重试拦截:", e.message);
    throw new Error("AI偷偷省略了部分年份，触发数据补全重试。");
  }
}

// 增量式/批次异步请求大运引擎（每2个大运作为一个请求）
export async function calculateDayunFortuneWithRetry(
  gender: string,
  birthDate: string,
  birthTime: string,
  toneMode: ToneMode | boolean = "default",
  retries: number = 3,
  onProgress?: (phases: DayunPhase[], current: number, total: number) => void,
  initialOnly: boolean = true,
  options?: StreamRequestOptions
): Promise<DayunFortuneResult> {
  const [year, month, day] = birthDate.split('-').map(Number);
  const [hour, minute] = birthTime.split(':').map(Number);
  const solar = Solar.fromYmdHms(year, month, day, hour, minute, 0);
  const lunar = solar.getLunar();
  const exactBazi = `${lunar.getEightChar().getYear()} ${lunar.getEightChar().getMonth()} ${lunar.getEightChar().getDay()} ${lunar.getEightChar().getTime()}`;

  const genderCode = gender === '男' ? 1 : 0;
  const yun = lunar.getEightChar().getYun(genderCode);
  const daYunArr = yun.getDaYun();
  
  const exactDayuns = [];
  for (let i = 1; i <= 8; i++) {
    if (i < daYunArr.length) {
      const dy = daYunArr[i];
      const startYear = dy.getStartYear();
      const endYear = startYear + 9;
      const startAge = dy.getStartAge();
      const period = `${startAge}岁-${startAge + 9}岁 (${startYear}-${endYear})`;
      
      const liunians = dy.getLiuNian().slice(0, 10).map(ln => ({
        year: ln.getYear(),
        age: ln.getAge(),
        ganzhi: ln.getGanZhi()
      }));

      exactDayuns.push({
        period: period,
        ganzhi: dy.getGanZhi(),
        liunian: liunians
      });
    }
  }

  // 首次排盘：将前8个大运合并为1个请求
  // 仅计算大运，不包含流年
  if (initialOnly) {
    const combinedSkeleton = exactDayuns.slice(0, 8).map(dy => {
      const { liunian, ...rest } = dy;
      return rest;
    });

    let lastError;
    for (let r = 0; r < retries; r++) {
      try {
        const phases = await calculateBatchDayunFortune(gender, birthDate, birthTime, exactBazi, combinedSkeleton, toneMode, false, options);
        const completedDayuns = phases.map((p, idx) => ({
          ...p,
          liunian: []
        }));
        if (onProgress) {
          onProgress(completedDayuns, 8, 8);
        }
        return { dayun: completedDayuns };
      } catch (e) {
        lastError = e;
        console.warn(`首次排盘大运合并请求 第 ${r + 1} 次尝试失败，正在重试...`, e);
        await new Promise(res => setTimeout(res, 2000));
      }
    }
    throw lastError;
  }

  const batches = [];
  for (let i = 0; i < exactDayuns.length; i += 2) {
    batches.push(exactDayuns.slice(i, i + 2));
  }

  const completedDayuns: DayunPhase[] = [];
  let loadedCount = 0;
  
  for (let i = 0; i < batches.length; i++) {
    let success = false;
    let lastError;
    const includeLiunian = true;
    
    // 构造 skeleton：如果不包含流年，则去掉 liunian 字段
    const batchSkeleton = batches[i].map(dy => {
      if (includeLiunian) return dy;
      const { liunian, ...rest } = dy;
      return rest;
    });

    for (let r = 0; r < retries; r++) {
      try {
         const phases = await calculateBatchDayunFortune(gender, birthDate, birthTime, exactBazi, batchSkeleton, toneMode, includeLiunian, options);
         
         // 如果不包含流年，为了保持数据结构一致，将空的流年数组放回去
         const processedPhases = phases.map((p, idx) => ({
           ...p,
           liunian: includeLiunian ? p.liunian : []
         }));

         completedDayuns.push(...processedPhases);
         loadedCount += batches[i].length;
         
         if (onProgress) {
             onProgress(processedPhases, loadedCount, exactDayuns.length);
         }
         success = true;
         break;
      } catch(e) {
         lastError = e;
         console.warn(`大运批次 ${i+1} 第 ${r+1} 次尝试失败，正在重试...`, e);
         await new Promise(res => setTimeout(res, 2000));
      }
    }
    if (!success) {
       throw lastError; // 彻底断联抛出异常
    }
  }

  return { dayun: completedDayuns };
}

// 专门用于手动推演某个大运的流年
export async function calculateSingleDayunLiunian(
  gender: string,
  birthDate: string,
  birthTime: string,
  toneMode: ToneMode | boolean = "default",
  dayunIndex: number,
  retries: number = 3,
  options?: StreamRequestOptions
): Promise<DayunPhase> {
  const [year, month, day] = birthDate.split('-').map(Number);
  const [hour, minute] = birthTime.split(':').map(Number);
  const solar = Solar.fromYmdHms(year, month, day, hour, minute, 0);
  const lunar = solar.getLunar();
  const exactBazi = `${lunar.getEightChar().getYear()} ${lunar.getEightChar().getMonth()} ${lunar.getEightChar().getDay()} ${lunar.getEightChar().getTime()}`;

  const genderCode = gender === '男' ? 1 : 0;
  const yun = lunar.getEightChar().getYun(genderCode);
  const daYunArr = yun.getDaYun();
  
  // dayunIndex 是从 0 开始的，对应 daYunArr 的 1 到 8
  const dy = daYunArr[dayunIndex + 1];
  if (!dy) throw new Error("找不到对应的大运");

  const startYear = dy.getStartYear();
  const endYear = startYear + 9;
  const startAge = dy.getStartAge();
  const period = `${startAge}岁-${startAge + 9}岁 (${startYear}-${endYear})`;
  
  const liunians = dy.getLiuNian().slice(0, 10).map(ln => ({
    year: ln.getYear(),
    age: ln.getAge(),
    ganzhi: ln.getGanZhi()
  }));

  const skeleton = [{
    period: period,
    ganzhi: dy.getGanZhi(),
    liunian: liunians
  }];

  let lastError;
  for (let r = 0; r < retries; r++) {
    try {
      const phases = await calculateBatchDayunFortune(gender, birthDate, birthTime, exactBazi, skeleton, toneMode, true, options);
      return phases[0];
    } catch (e) {
      lastError = e;
      console.warn(`单大运流年推演 第 ${r+1} 次尝试失败，正在重试...`, e);
      await new Promise(res => setTimeout(res, 2000));
    }
  }
  throw lastError;
}

// ---------------- 以下为各类起卦推演功能（保持不变） ----------------
export interface LuRenResult {
  sike: string[];
  sanchuan: string[];
  tianpan: string;
  overall: string;
  advice: string;
}

export interface DailyFortuneResult {
  date: string;
  period: {
    dayun: string;
    liunian: string;
    liuyue: string;
    liuri: string;
  };
  score: number;
  summary: string;
  auspicious: string;
  inauspicious: string;
  shensha: ShenshaInfo[];
}

export async function calculateLuRen(
  question: string,
  date: string,
  time: string,
  toneMode: ToneMode | boolean = "default",
  options?: StreamRequestOptions
): Promise<LuRenResult> {
  return requestFortuneOutput<LuRenResult>({
    kind: "luren",
    payload: { question, date, time, toneMode: resolveToneMode(toneMode) },
    onTextDelta: options?.onTextDelta,
    signal: options?.signal,
  });

  const harshPrompt = getTonePrompt(toneMode);

  const prompt = `
你是一个深耕中国传统命理的道士，精通大六壬。请根据以下起卦时间与所问之事，排演大六壬神课，并给出详细的断语。
${harshPrompt}

起卦信息：
所问之事：${question}
起卦日期（公历）：${date}
起卦时间：${time}

请严格按照要求的JSON格式返回测算结果。
`;

  const refinedPrompt = `${prompt}

【补充推演要求】：
1. 先排盘，再断事。先明确四课、三传、天盘，再说明课体主旨，最后落到吉凶趋势与可执行建议。
2. 结论必须建立在课体结构、四课三传生克、天将地神关系之上，不得只给空泛结论。
3. 若存在关键矛盾点、阻滞点或反复之象，要明确指出触发原因与主要落点。
4. 建议(advice)要与整体判断保持一致，避免前面说凶、后面给泛泛乐观建议。`;

  const refinedSystemInstruction = "你是一个深耕中国传统命理的道士，精通大六壬。擅长排演四课三传，并根据课体结构、天神地将、生克制化进行断事。语气要专业、玄妙、带有道家的人文关怀。必须先排盘，再断课体，再给吉凶与建议，前后结论保持一致。";

  const response = await ai.models.generateContent({
    model: currentModel,
    contents: refinedPrompt,
    config: ((config) => ({
      ...config,
      systemInstruction: refinedSystemInstruction,
      onTextDelta: options?.onTextDelta,
      signal: options?.signal,
    }))({
      systemInstruction: "你是一个深耕中国传统命理的道士，精通大六壬。擅长排演四课三传，并根据天神地将进行断事。语气要专业、玄妙、带有道家的人文关怀。",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          sike: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "四课排盘结果，必须是4个字符串，每个字符串严格为2个汉字"
          },
          sanchuan: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "三传排盘结果，必须是3个字符串，每个字符串严格为2个汉字"
          },
          tianpan: { type: Type.STRING, description: "天盘/月将加时简述" },
          overall: { type: Type.STRING, description: "整体课体断语" },
          advice: { type: Type.STRING, description: "具体建议与吉凶判断" },
        },
        required: ["sike", "sanchuan", "tianpan", "overall", "advice"],
      },
    }),
  });

  const text = response.text;
  if (!text) throw new Error("未能获取测算结果，请稍后再试。");
  return parseStructuredJson<LuRenResult>(text);
}

export interface XiaoLuRenResult {
  gongwei: string[];
  overall: string;
  advice: string;
}

export interface LiuYaoResult {
  bengua: string;
  biangua: string;
  benguaLines: string[];
  bianguaLines: string[];
  shiying: string;
  yongshen: string;
  liuqin: string;
  yaoci: string[];
  overall: string;
  detailedAnalysis: string;
  advice: string;
}

export async function calculateXiaoLuRen(
  question: string,
  date: string,
  time: string,
  toneMode: ToneMode | boolean = "default",
  options?: StreamRequestOptions
): Promise<XiaoLuRenResult> {
  return requestFortuneOutput<XiaoLuRenResult>({
    kind: "xiaoluren",
    payload: { question, date, time, toneMode: resolveToneMode(toneMode) },
    onTextDelta: options?.onTextDelta,
    signal: options?.signal,
  });

  const harshPrompt = getTonePrompt(toneMode);

  const prompt = `
你是一个深耕中国传统命理的道士，精通小六壬。请根据以下起卦时间与所问之事，排演小六壬，并给出详细的断语。
${harshPrompt}

起卦信息：
所问之事：${question}
起卦日期（公历）：${date}
起卦时间：${time}

请严格按照要求的JSON格式返回测算结果。
`;

  const refinedPrompt = `${prompt}

【补充推演要求】：
1. 先判断宫位排布，再归纳整体卦象主旨，最后给出结果倾向与建议。
2. 断语要紧扣宫位组合与主象，不要只写套话。
3. 若问题存在拖延、反复、口舌、空耗、转机等重点信号，要明确点出。`;

  const refinedSystemInstruction = "你是一个深耕中国传统命理的道士，精通小六壬（大安、留连、速喜、赤口、小吉、空亡）。必须先看宫位组合，再定主象，再给断语与建议。结论要简洁明确，但依据要清楚。";

  const response = await ai.models.generateContent({
    model: currentModel,
    contents: refinedPrompt,
    config: ((config) => ({
      ...config,
      systemInstruction: refinedSystemInstruction,
      onTextDelta: options?.onTextDelta,
      signal: options?.signal,
    }))({
      systemInstruction: "你是一个深耕中国传统命理的道士，精通小六壬（大安、留连、速喜、赤口、小吉、空亡）。",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          gongwei: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "小六壬排盘结果，必须是3个字符串"
          },
          overall: { type: Type.STRING, description: "整体断语（道家口吻）" },
          advice: { type: Type.STRING, description: "具体建议与吉凶判断" },
        },
        required: ["gongwei", "overall", "advice"],
      },
    }),
  });

  const text = response.text;
  if (!text) throw new Error("未能获取测算结果，请稍后再试。");
  return parseStructuredJson<XiaoLuRenResult>(text);
}

export async function calculateLiuYao(
  question: string,
  date: string,
  time: string,
  toneMode: ToneMode | boolean = "default",
  method: 'time' | 'coin' = 'time',
  tosses?: number[],
  options?: StreamRequestOptions
): Promise<LiuYaoResult> {
  const result = await requestFortuneOutput<LiuYaoResult>({
    kind: "liuyao",
    payload: { question, date, time, toneMode: resolveToneMode(toneMode), method, tosses },
    onTextDelta: options?.onTextDelta,
    signal: options?.signal,
  });
  return normalizeLiuYaoResult(result);

  const harshPrompt = getTonePrompt(toneMode);

  let methodPrompt = "";
  if (method === 'coin' && tosses && tosses.length === 6) {
    const localHexagramInfo = buildHexagramInfoFromTosses(tosses);
    const benguaLinesText = localHexagramInfo?.benguaLines.join("、") || "未知";
    const bianguaLinesText = localHexagramInfo?.hasBiangua ? localHexagramInfo.bianguaLines.join("、") : "无";
    const benguaNameText = localHexagramInfo?.benguaName || "未知";
    const bianguaNameText = localHexagramInfo?.hasBiangua ? localHexagramInfo?.bianguaName || "未知" : "无";

    methodPrompt = `用户使用了铜钱摇卦法，从初爻到上爻的 tosses 结果分别是：[${tosses.join(', ')}]。
本地排卦核对结果如下：
- 本卦六爻（初爻到上爻）：[${benguaLinesText}]
- 本卦卦名：${benguaNameText}
- 变卦六爻（初爻到上爻）：[${bianguaLinesText}]
- 变卦卦名：${bianguaNameText}
【极其重要】：你必须严格以以上 tosses 与本地核对出的卦名/卦象作为排演依据，不得自行改卦或改名。`;
  } else {
    methodPrompt = `用户使用了时间起卦法，时间是：${date} ${time}。`;
  }

  const prompt = `
你是一个深耕中国传统命理的道士，精通六爻八卦。请根据以下起卦信息与所问之事，排演六爻，并给出详细的断语。
${harshPrompt}

起卦信息：
所问之事：${question}
起卦日期（公历）：${date}
起卦时间：${time}
起卦方式：${methodPrompt}

请严格按照要求的JSON格式返回测算结果。
`;

  const refinedPrompt = `${prompt}

【补充推演要求】：
1. 必须先确定本卦、变卦、动爻、世应、用神、六亲，再展开整体判断。
2. 若是铜钱起卦，必须严格以给定摇卦结果排卦，不得自行改卦。
3. 你返回的 bengua、biangua 必须与 benguaLines、bianguaLines 严格一一对应，先根据六爻阴阳结构核对卦名后再输出，禁止出现卦象与卦名不一致。
4. 若 bianguaLines 与 benguaLines 完全相同，则 biangua 必须返回“无”。
5. 详细分析(detailedAnalysis)要说明关键爻位、世应关系、用神旺衰与动变逻辑，不要只给结果。
6. 建议(advice)必须针对问事场景，说明宜主动、宜等待、宜回避还是宜观察。`;

  const refinedSystemInstruction = "你是一个深耕中国传统命理的道士，精通六爻预测。擅长排演本卦、变卦，并根据动爻、世应、用神、六亲进行断事。必须先定卦象结构，再逐条核对卦象与卦名是否一致，然后再讲作用逻辑，再下结论与建议，避免空泛断语。";

  const response = await ai.models.generateContent({
    model: currentModel,
    contents: refinedPrompt,
    config: ((config) => ({
      ...config,
      systemInstruction: refinedSystemInstruction,
      onTextDelta: options?.onTextDelta,
      signal: options?.signal,
    }))({
      systemInstruction: "你是一个深耕中国传统命理的道士，精通六爻预测。擅长排演本卦、变卦，并根据爻辞、世应、六亲进行断事。",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          bengua: { type: Type.STRING },
          biangua: { type: Type.STRING },
          benguaLines: { type: Type.ARRAY, items: { type: Type.STRING } },
          bianguaLines: { type: Type.ARRAY, items: { type: Type.STRING } },
          shiying: { type: Type.STRING },
          yongshen: { type: Type.STRING },
          liuqin: { type: Type.STRING },
          yaoci: { type: Type.ARRAY, items: { type: Type.STRING } },
          overall: { type: Type.STRING },
          detailedAnalysis: { type: Type.STRING },
          advice: { type: Type.STRING },
        },
        required: ["bengua", "biangua", "benguaLines", "bianguaLines", "shiying", "yongshen", "liuqin", "yaoci", "overall", "detailedAnalysis", "advice"],
      },
    }),
  });

  const text = response.text;
  if (!text) throw new Error("未能获取测算结果，请稍后再试。");
  return normalizeLiuYaoResult(parseStructuredJson<LiuYaoResult>(text));
}

export async function calculateDailyFortune(
  gender: string,
  birthDate: string,
  birthTime: string,
  targetDate: string,
  options?: StreamRequestOptions
): Promise<DailyFortuneResult> {
  const dailyResult = await requestFortuneOutput<DailyFortuneResult>({
    kind: "dailyFortune",
    payload: { gender, birthDate, birthTime, targetDate },
    onTextDelta: options?.onTextDelta,
    signal: options?.signal,
  });
  return {
    ...dailyResult,
    shensha: buildDailyShensha(targetDate),
  };

  const [year, month, day] = birthDate.split('-').map(Number);
  const [hour, minute] = birthTime.split(':').map(Number);
  const solar = Solar.fromYmdHms(year, month, day, hour, minute, 0);
  const lunar = solar.getLunar();
  const exactBazi = `${lunar.getEightChar().getYear()} ${lunar.getEightChar().getMonth()} ${lunar.getEightChar().getDay()} ${lunar.getEightChar().getTime()}`;

  const prompt = `
你是一个深耕中国传统命理的道士。请根据求测者的八字，结合目标日期（流日），给出当天的运势简报。

求测者信息：
性别：${gender}
出生日期：${birthDate} ${birthTime}
准确八字：${exactBazi}

目标查询日期（公历）：${targetDate}

【核心推演法则】：
1. **理论依据**：流日推演必须以《渊海子平》的生克制化理论为基础。
2. **核心技法**：
   - 重点考察流日干支与原局八字（特别是日柱）的刑冲合害关系。
   - 分析流日干支对原局喜忌用神的损益。
   - 结合流日神煞（如天乙贵人、羊刃、驿马等）辅助判断当天的吉凶祸福。
3. 给出当天的综合运势评分（0-100分）。
4. 详细分析当天的整体运势、宜忌事项。

请严格按照要求的JSON格式返回测算结果。
`;

  const refinedPrompt = `${prompt}

【补充推演要求】：
1. 先看原局喜忌，再看当下所处大运、流年、流月、流日，最后综合判断当天运势。
2. score 必须与当天干支对原局喜忌、冲合刑害、扶抑得失保持一致，不可只凭语气给分。
3. summary 先概括主趋势，再说明主要风险点或顺势点。
4. auspicious 与 inauspicious 要具体到行为倾向或注意事项，不要写空泛吉凶词。
5. 输出时不要逐条展示当天推演的中间步骤，只需用总结性的语气概括当天主趋势、容易应在何事、宜忌重点与需要留心的触发点。`;

  const refinedSystemInstruction = "你是一个深耕中国传统命理的道士。擅长推算每日运势。必须先看原局，再看大运流年流月流日的层层作用，最后给出当天评分与宜忌，但这些步骤只作为内部推演依据，不要在输出中逐条展开。语气要专业、玄妙，但判断必须有依据。最终用总结性的表述概括当天走势、应事方向、宜忌重点与需要警惕的触发点。";

  const response = await ai.models.generateContent({
    model: currentModel,
    contents: refinedPrompt,
    config: ((config) => ({
      ...config,
      systemInstruction: refinedSystemInstruction,
      onTextDelta: options?.onTextDelta,
      signal: options?.signal,
    }))({
      systemInstruction: "你是一个深耕中国传统命理的道士。擅长推算每日运势。语气要专业、玄妙。",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING },
          period: {
            type: Type.OBJECT,
            properties: {
              dayun: { type: Type.STRING },
              liunian: { type: Type.STRING },
              liuyue: { type: Type.STRING },
              liuri: { type: Type.STRING },
            },
            required: ["dayun", "liunian", "liuyue", "liuri"]
          },
          score: { type: Type.NUMBER },
          summary: { type: Type.STRING },
          auspicious: { type: Type.STRING },
          inauspicious: { type: Type.STRING },
          shensha: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                description: { type: Type.STRING },
              },
              required: ["name", "description"],
            },
          },
        },
        required: ["date", "period", "score", "summary", "auspicious", "inauspicious", "shensha"],
      },
    }),
  });

  const text = response.text;
  if (!text) throw new Error("未能获取测算结果，请稍后再试。");
  const parsed = parseStructuredJson<DailyFortuneResult>(text);
  return {
    ...parsed,
    shensha: buildDailyShensha(targetDate),
  };
}

export async function calculateCompatibility(
  gender1: string,
  birthDate1: string,
  birthTime1: string,
  gender2: string,
  birthDate2: string,
  birthTime2: string,
  toneMode: ToneMode | boolean = "default",
  relationship: CompatibilityRelationship = DEFAULT_COMPATIBILITY_RELATIONSHIP,
  options?: StreamRequestOptions
): Promise<CompatibilityResult> {
  return requestFortuneOutput<CompatibilityResult>({
    kind: "compatibility",
    payload: {
      gender1,
      birthDate1,
      birthTime1,
      gender2,
      birthDate2,
      birthTime2,
      toneMode: resolveToneMode(toneMode),
      relationship,
    },
    onTextDelta: options?.onTextDelta,
    signal: options?.signal,
  });

  const [year1, month1, day1] = birthDate1.split('-').map(Number);
  const [hour1, minute1] = birthTime1.split(':').map(Number);
  const solar1 = Solar.fromYmdHms(year1, month1, day1, hour1, minute1, 0);
  const lunar1 = solar1.getLunar();
  const exactBazi1 = `${lunar1.getEightChar().getYear()} ${lunar1.getEightChar().getMonth()} ${lunar1.getEightChar().getDay()} ${lunar1.getEightChar().getTime()}`;

  const [year2, month2, day2] = birthDate2.split('-').map(Number);
  const [hour2, minute2] = birthTime2.split(':').map(Number);
  const solar2 = Solar.fromYmdHms(year2, month2, day2, hour2, minute2, 0);
  const lunar2 = solar2.getLunar();
  const exactBazi2 = `${lunar2.getEightChar().getYear()} ${lunar2.getEightChar().getMonth()} ${lunar2.getEightChar().getDay()} ${lunar2.getEightChar().getTime()}`;

  const resolvedToneMode = resolveToneMode(toneMode);
  const harshPrompt = resolvedToneMode === "harsh"
    ? "请使用极其严厉、直白、甚至有些毒舌的语气，不要有任何安慰，直接指出两人关系中最致命的问题和隐患。"
    : resolvedToneMode === "sweet"
      ? "请尽量多讲两人关系中的优势、默契、可修复空间与正向潜力；即使指出问题，也请以鼓励、温和、给人信心的方式表达。"
      : "请使用温和、客观、专业的语气进行分析。";
  const relationshipPrompt = buildCompatibilityRelationshipPrompt(relationship);

  const prompt = `
你是一个深耕中国传统命理的道士，精通八字关系合盘。请根据以下两人的八字信息，进行详细的合盘推演。
${harshPrompt}
${relationshipPrompt}

第一方（主测人）：
性别：${gender1}
出生日期：${birthDate1} ${birthTime1}
准确八字：${exactBazi1}

第二方（合测人）：
性别：${gender2}
出生日期：${birthDate2} ${birthTime2}
准确八字：${exactBazi2}

【核心推演法则】：
1. **理论依据**：合盘推演必须以《渊海子平》《三命通会》的生克合冲理论为基础，结合《滴天髓阐微》的五行气象进行综合评判；若关系类型为亲密关系，再重点参考合婚理论。
2. **核心技法**：
   - 重点考察两人日柱干支的生克合化关系（如天合地合、天克地冲）。
   - 分析两人八字五行喜忌的互补性（如一方的旺神是否为另一方的用神）。
   - 若为亲密关系，结合男女命局中的配偶星（男看财，女看官杀）与配偶宫（日支）的相互作用；若为友情或合作，不要强行套用婚恋断语。
   - 辅助参考神煞（如桃花、孤辰寡宿、天乙贵人等）对两人关系的影响。
3. 给出两人在当前关系类型下的匹配总分（0-100分）。
4. 按当前关系类型详细分析两人的连接基础、相处/协作模式、未来发展方向，并给出中肯的建议。每项分析不少于100字。

请严格按照要求的JSON格式返回测算结果。
`;

  const refinedPrompt = `${prompt}

【补充推演要求】：
1. 先分别判断双方命局特征，再看两人之间的生克、合冲、五行互补与配偶信息匹配，最后再下整体结论。
2. 不得只看“合”或“冲”就草率定论，必须结合双方原局喜忌、日柱关系与当前关系类型综合判断。
3. overallScore 必须与实际分析一致，不可出现文字偏凶但分数偏高，或文字偏合但分数过低的矛盾。
4. emotionAnalysis、interactionPattern、futureDirection、suggestions 要分别承担不同作用，避免内容重复。
5. 对风险要说明触发条件和主要矛盾点，对优势要说明为什么能互补。避免无依据的绝对化断语。
6. 输出时不要把合盘过程写成逐步推演记录，而要写成总结性的关系判断，归纳两人的缘分性质、相处主线、易起波澜的阶段，以及未来较可能应验的大事方向。
7. 必须围绕“${relationshipPrompt}”来措辞，不要偏离用户选择的关系类型。`;

  const refinedSystemInstruction = "你是一个深耕中国传统命理的道士，精通八字关系合盘。擅长分析两人的五行生克、干支合化，并按亲密、友情或合作等不同关系类型判断相处之道。必须先分别看双方命局，再看彼此互动，再下契合度与关系走向结论，但这些步骤只作为内部推演顺序，不要在输出中逐步复述。判断要综合、克制、前后一致，避免只凭单一合冲下结论。最终以总结性论述呈现两人的关系主线、相合与相冲之处、关键阶段与未来较易应验的大事方向。";

  const response = await ai.models.generateContent({
    model: currentModel,
    contents: refinedPrompt,
    config: ((config) => ({
      ...config,
      systemInstruction: refinedSystemInstruction,
      onTextDelta: options?.onTextDelta,
      signal: options?.signal,
    }))({
      systemInstruction: "你是一个深耕中国传统命理的道士，精通八字关系合盘。擅长分析两人的五行生克、干支合化，洞悉关系中的相合相冲与相处之道。",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          person1Bazi: { type: Type.STRING, description: "第一方的八字" },
          person2Bazi: { type: Type.STRING, description: "第二方的八字" },
          overallScore: { type: Type.NUMBER, description: "综合契合度评分，0-100" },
          emotionAnalysis: { type: Type.STRING, description: "情感深层分析" },
          interactionPattern: { type: Type.STRING, description: "相处模式分析" },
          futureDirection: { type: Type.STRING, description: "未来发展方向" },
          suggestions: { type: Type.STRING, description: "改善建议" },
        },
        required: ["person1Bazi", "person2Bazi", "overallScore", "emotionAnalysis", "interactionPattern", "futureDirection", "suggestions"],
      },
    }),
  });

  const text = response.text;
  if (!text) throw new Error("未能获取合盘结果，请稍后再试。");
  return parseStructuredJson<CompatibilityResult>(text);
}
