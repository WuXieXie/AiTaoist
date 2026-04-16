import React, { useEffect, useRef, useState } from 'react';
import BaziForm from './components/BaziForm';
import BaziResult from './components/BaziResult';
import LuRenForm from './components/LuRenForm';
import LuRenResult from './components/LuRenResult';
import LoadingTaiChi from './components/LoadingTaiChi';
import HelpFAQ from './components/HelpFAQ';
import XiaoLuRenForm from './components/XiaoLuRenForm';
import XiaoLuRenResult from './components/XiaoLuRenResult';
import LiuYaoForm from './components/LiuYaoForm';
import LiuYaoResult from './components/LiuYaoResult';
import CompatibilityForm from './components/CompatibilityForm';
import CompatibilityResult from './components/CompatibilityResult';
import { 
  calculateBasicFortune, 
  calculateLuRen, 
  calculateXiaoLuRen, 
  calculateLiuYao, 
  calculateCompatibility,
  BasicFortuneResult, 
  LuRenResult as ILuRenResult, 
  XiaoLuRenResult as IXiaoLuRenResult, 
  LiuYaoResult as ILiuYaoResult,
  CompatibilityResult as ICompatibilityResult,
  setModel,
  getModel,
  setAccessKey,
  getStoredAccessKey
} from './services/fortuneService';
import { motion, AnimatePresence } from 'motion/react';
import { HelpCircle, Cpu } from 'lucide-react';
import type { ToneMode } from './types/toneMode';
import type { CompatibilityRelationship } from './services/compatibilityRelationship';

type Tab = 'bazi' | 'compatibility' | 'luren' | 'xiaoluren' | 'liuyao';

type ModelOption = {
  id: string;
  label: string;
};

type StreamingState = Record<Tab, string>;

const PREFERRED_DEFAULT_MODEL = 'gpt-5.4';
const MODEL_FALLBACK_PRIORITY = ['gpt-5.4', 'gpt-5.2'];
const HTML_RESPONSE_PATTERN = /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]/i;

const FALLBACK_MODEL_OPTIONS: ModelOption[] = [
  { id: 'gpt-5.4', label: 'gpt-5.4' },
  { id: 'gpt-5.2', label: 'gpt-5.2' },
  { id: 'gpt-5.2-codex', label: 'gpt-5.2-codex' },
  { id: 'gpt-5', label: 'gpt-5' },
  { id: 'gpt-5-codex', label: 'gpt-5-codex' },
  { id: 'gpt-5.1', label: 'gpt-5.1' },
  { id: 'gpt-5.1-codex-max', label: 'gpt-5.1-codex-max' },
  { id: 'gpt-5.3-codex-spark', label: 'gpt-5.3-codex-spark' },
  { id: 'gpt-5-codex-mini', label: 'gpt-5-codex-mini' },
  { id: 'gpt-5.1-codex', label: 'gpt-5.1-codex' },
  { id: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini' },
];

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
    typeof payload?.error === 'string'
      ? payload.error
      : payload?.error?.message || payload?.message || rawPayload;
  const normalized = candidate.replace(/\s+/g, ' ').trim();

  if (!normalized || normalized.startsWith('<') || HTML_RESPONSE_PATTERN.test(normalized)) {
    return fallbackMessage;
  }

  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

function pickPreferredModel(options: ModelOption[]): string {
  return (
    MODEL_FALLBACK_PRIORITY.find((modelId) => options.some((option) => option.id === modelId)) ||
    options[0]?.id ||
    PREFERRED_DEFAULT_MODEL
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('bazi');
  const [streamingText, setStreamingText] = useState<StreamingState>({
    bazi: '',
    compatibility: '',
    luren: '',
    xiaoluren: '',
    liuyao: '',
  });
  const requestControllersRef = useRef<Partial<Record<Tab, AbortController>>>({});
  
  // Model State
  const [selectedModel, setSelectedModel] = useState(() => getModel() || PREFERRED_DEFAULT_MODEL);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>(FALLBACK_MODEL_OPTIONS);
  const [accessKeyInput, setAccessKeyInput] = useState(() => getStoredAccessKey());
  const [isAccessGranted, setIsAccessGranted] = useState(false);
  const [isAccessReady, setIsAccessReady] = useState(false);
  const [accessKeyError, setAccessKeyError] = useState<string | null>(null);
  const [isAccessChecking, setIsAccessChecking] = useState(false);

  // Bazi State
  const [baziLoading, setBaziLoading] = useState(false);
  const [baziResult, setBaziResult] = useState<BasicFortuneResult | null>(null);
  const [baziError, setBaziError] = useState<string | null>(null);
  const [birthInfo, setBirthInfo] = useState<{ gender: string; birthDate: string; birthTime: string; toneMode: ToneMode; isHarshMode: boolean; calendarType?: string; isLeapMonth?: boolean } | null>(null);

  // Compatibility State
  const [compatibilityLoading, setCompatibilityLoading] = useState(false);
  const [compatibilityResult, setCompatibilityResult] = useState<ICompatibilityResult | null>(null);
  const [compatibilityError, setCompatibilityError] = useState<string | null>(null);
  const [compatibilityInfo, setCompatibilityInfo] = useState<{ gender1: string; birthDate1: string; birthTime1: string; calendarType1?: string; isLeapMonth1?: boolean; gender2: string; birthDate2: string; birthTime2: string; calendarType2?: string; isLeapMonth2?: boolean; relationship: CompatibilityRelationship; toneMode: ToneMode; isHarshMode: boolean } | null>(null);

  // LuRen State
  const [lurenLoading, setLurenLoading] = useState(false);
  const [lurenResult, setLurenResult] = useState<ILuRenResult | null>(null);
  const [lurenError, setLurenError] = useState<string | null>(null);

  // XiaoLuRen State
  const [xiaoLurenLoading, setXiaoLurenLoading] = useState(false);
  const [xiaoLurenResult, setXiaoLurenResult] = useState<IXiaoLuRenResult | null>(null);
  const [xiaoLurenError, setXiaoLurenError] = useState<string | null>(null);

  // LiuYao State
  const [liuyaoLoading, setLiuyaoLoading] = useState(false);
  const [liuyaoResult, setLiuyaoResult] = useState<ILiuYaoResult | null>(null);
  const [liuyaoError, setLiuyaoError] = useState<string | null>(null);

  // Help Modal State
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadModels = async () => {
      try {
        const storedAccessKey = getStoredAccessKey();
        const response = await fetch('/api/models', {
          headers: storedAccessKey
            ? {
                'x-access-key': storedAccessKey,
              }
            : {},
        });
        const rawPayload = await response.text();
        const payload = parseJsonSafely<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(rawPayload);

        if (!response.ok) {
          if (response.status === 401) {
            setAccessKey('');
            if (!cancelled) {
              setIsAccessGranted(false);
              setAccessKeyError(extractKeyErrorMessage(rawPayload, '访问密钥校验失败', response.status));
            }
            return;
          }

          throw new Error(extractKeyErrorMessage(rawPayload, '模型列表加载失败，请稍后再试。', response.status));
        }

        const remoteOptions = Array.isArray(payload?.data)
          ? payload.data
              .map((item: { id?: string }) => item?.id)
              .filter((id: string | undefined): id is string => Boolean(id))
              .map((id: string) => ({ id, label: id }))
          : [];

        const fallbackModel = PREFERRED_DEFAULT_MODEL;
        const fallbackOptions = FALLBACK_MODEL_OPTIONS.some((option) => option.id === fallbackModel)
          ? FALLBACK_MODEL_OPTIONS
          : [{ id: fallbackModel, label: fallbackModel }, ...FALLBACK_MODEL_OPTIONS];
        const nextOptions = remoteOptions.length > 0 ? remoteOptions : fallbackOptions;
        const nextSelectedModel = pickPreferredModel(nextOptions);

        if (!cancelled) {
          setModelOptions(nextOptions);
          setSelectedModel(nextSelectedModel);
          setModel(nextSelectedModel);
          setIsAccessGranted(true);
          setAccessKeyError(null);
        }
      } catch (error) {
        console.error('Failed to load model list:', error);
        if (!cancelled) {
          const fallbackModel = PREFERRED_DEFAULT_MODEL;
          const fallbackOptions = FALLBACK_MODEL_OPTIONS.some((option) => option.id === fallbackModel)
            ? FALLBACK_MODEL_OPTIONS
            : [{ id: fallbackModel, label: fallbackModel }, ...FALLBACK_MODEL_OPTIONS];
          setModelOptions(fallbackOptions);
          const nextSelectedModel = pickPreferredModel(fallbackOptions);
          setSelectedModel(nextSelectedModel);
          setModel(nextSelectedModel);
          setIsAccessGranted(true);
          setAccessKeyError(null);
        }
      } finally {
        if (!cancelled) {
          setIsAccessReady(true);
        }
      }
    };

    loadModels();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleAccessSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = accessKeyInput.trim();

    if (!normalized) {
      setAccessKeyError('请输入访问密钥');
      return;
    }

    setIsAccessChecking(true);
    setAccessKeyError(null);
    setAccessKey(normalized);

    try {
      const response = await fetch('/api/models', {
        headers: {
          'x-access-key': normalized,
        },
      });
      const rawPayload = await response.text();

      if (!response.ok) {
        throw new Error(extractKeyErrorMessage(rawPayload, '访问密钥校验失败', response.status));
      }

      setIsAccessGranted(true);
    } catch (error) {
      setAccessKey('');
      setIsAccessGranted(false);
      setAccessKeyError(error instanceof Error ? error.message : '访问密钥校验失败');
    } finally {
      setIsAccessChecking(false);
    }
  };

  useEffect(() => {
    return () => {
      const controllers = Object.values(requestControllersRef.current) as AbortController[];
      controllers.forEach((controller) => controller.abort());
    };
  }, []);

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    setSelectedModel(newModel);
    setModel(newModel); // Update global service state
  };

  const updateStreamingText = (tab: Tab, text: string) => {
    setStreamingText((prev) => ({ ...prev, [tab]: text }));
  };

  const beginStreamRequest = (tab: Tab) => {
    requestControllersRef.current[tab]?.abort();
    const controller = new AbortController();
    requestControllersRef.current[tab] = controller;
    return controller;
  };

  const clearStreamRequest = (tab: Tab, controller: AbortController) => {
    if (requestControllersRef.current[tab] === controller) {
      delete requestControllersRef.current[tab];
    }
  };

  const isAbortError = (error: unknown) =>
    error instanceof DOMException && error.name === 'AbortError';

  const handleBaziCalculate = async (data: { gender: string; birthDate: string; birthTime: string; toneMode: ToneMode; isHarshMode: boolean; calendarType: string; isLeapMonth: boolean }) => {
    const controller = beginStreamRequest('bazi');
    setBaziLoading(true);
    setBaziError(null);
    updateStreamingText('bazi', '');
    setBirthInfo(data); // Save for calendar & dayun integration
    try {
      const res = await calculateBasicFortune(data.gender, data.birthDate, data.birthTime, data.toneMode, {
        onTextDelta: (text) => updateStreamingText('bazi', text),
        signal: controller.signal,
      });
      setBaziResult(res);
    } catch (err: any) {
      if (isAbortError(err)) {
        return;
      }
      setBaziError(err.message || '推演过程中发生未知错误，请稍后再试。');
    } finally {
      clearStreamRequest('bazi', controller);
      setBaziLoading(false);
    }
  };

  const handleCompatibilityCalculate = async (data: { gender1: string; birthDate1: string; birthTime1: string; calendarType1: string; isLeapMonth1: boolean; gender2: string; birthDate2: string; birthTime2: string; calendarType2: string; isLeapMonth2: boolean; relationship: CompatibilityRelationship; toneMode: ToneMode; isHarshMode: boolean }) => {
    const controller = beginStreamRequest('compatibility');
    setCompatibilityLoading(true);
    setCompatibilityError(null);
    updateStreamingText('compatibility', '');
    setCompatibilityInfo(data);
    try {
      const res = await calculateCompatibility(data.gender1, data.birthDate1, data.birthTime1, data.gender2, data.birthDate2, data.birthTime2, data.toneMode, data.relationship, {
        onTextDelta: (text) => updateStreamingText('compatibility', text),
        signal: controller.signal,
      });
      setCompatibilityResult(res);
    } catch (err: any) {
      if (isAbortError(err)) {
        return;
      }
      setCompatibilityError(err.message || '合盘推演过程中发生未知错误，请稍后再试。');
    } finally {
      clearStreamRequest('compatibility', controller);
      setCompatibilityLoading(false);
    }
  };

  const handleLuRenCalculate = async (data: { question: string; date: string; time: string; toneMode: ToneMode; isHarshMode: boolean }) => {
    const controller = beginStreamRequest('luren');
    setLurenLoading(true);
    setLurenError(null);
    updateStreamingText('luren', '');
    try {
      const res = await calculateLuRen(data.question, data.date, data.time, data.toneMode, {
        onTextDelta: (text) => updateStreamingText('luren', text),
        signal: controller.signal,
      });
      setLurenResult(res);
    } catch (err: any) {
      if (isAbortError(err)) {
        return;
      }
      setLurenError(err.message || '起课过程中发生未知错误，请稍后再试。');
    } finally {
      clearStreamRequest('luren', controller);
      setLurenLoading(false);
    }
  };

  const handleXiaoLuRenCalculate = async (data: { question: string; date: string; time: string; toneMode: ToneMode; isHarshMode: boolean }) => {
    const controller = beginStreamRequest('xiaoluren');
    setXiaoLurenLoading(true);
    setXiaoLurenError(null);
    updateStreamingText('xiaoluren', '');
    try {
      const res = await calculateXiaoLuRen(data.question, data.date, data.time, data.toneMode, {
        onTextDelta: (text) => updateStreamingText('xiaoluren', text),
        signal: controller.signal,
      });
      setXiaoLurenResult(res);
    } catch (err: any) {
      if (isAbortError(err)) {
        return;
      }
      setXiaoLurenError(err.message || '起卦过程中发生未知错误，请稍后再试。');
    } finally {
      clearStreamRequest('xiaoluren', controller);
      setXiaoLurenLoading(false);
    }
  };

  const handleLiuYaoCalculate = async (data: { question: string; date: string; time: string; toneMode: ToneMode; isHarshMode: boolean; method: 'time' | 'coin'; tosses?: number[] }) => {
    const controller = beginStreamRequest('liuyao');
    setLiuyaoLoading(true);
    setLiuyaoError(null);
    updateStreamingText('liuyao', '');
    try {
      const res = await calculateLiuYao(data.question, data.date, data.time, data.toneMode, data.method, data.tosses, {
        onTextDelta: (text) => updateStreamingText('liuyao', text),
        signal: controller.signal,
      });
      setLiuyaoResult(res);
    } catch (err: any) {
      if (isAbortError(err)) {
        return;
      }
      setLiuyaoError(err.message || '起卦过程中发生未知错误，请稍后再试。');
    } finally {
      clearStreamRequest('liuyao', controller);
      setLiuyaoLoading(false);
    }
  };

  return (
    <div className="min-h-screen py-12 px-4 sm:px-6 lg:px-8 relative">
      {/* Decorative background elements */}
      <div className="fixed top-0 left-0 w-full h-2 bg-gradient-to-r from-transparent via-gold to-transparent opacity-50"></div>
      <div className="fixed top-0 left-0 w-2 h-full bg-gradient-to-b from-transparent via-gold to-transparent opacity-20"></div>
      <div className="fixed top-0 right-0 w-2 h-full bg-gradient-to-b from-transparent via-gold to-transparent opacity-20"></div>

      <div className="max-w-7xl mx-auto">
        <header className="text-center mb-12 relative flex flex-col items-center justify-center">
          
          {/* Model Selector (Left) */}
          <div className="absolute left-0 top-0 md:top-2 flex items-center gap-2 p-2 bg-white/50 rounded-full hover:bg-white transition-all">
            <Cpu className="w-5 h-5 text-ink/40 ml-1" />
            <select
              value={selectedModel}
              onChange={handleModelChange}
              className="bg-transparent text-xs md:text-sm font-bold tracking-widest text-ink/60 hover:text-ink focus:outline-none cursor-pointer pr-2 appearance-none"
              title="切换AI模型"
            >
              {modelOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <motion.h1 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-5xl font-bold text-ink tracking-[0.3em] mb-4 mt-12 md:mt-0"
          >
            玄门命理
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-ink/60 tracking-widest"
          >
            知命而行，顺势而为
          </motion.p>
          
          {/* Help Button (Right) */}
          <button
            onClick={() => setIsHelpOpen(true)}
            className="absolute right-0 top-0 md:top-2 p-2 text-ink/40 hover:text-ink bg-white/50 hover:bg-white rounded-full transition-all flex items-center gap-2"
            title="帮助与说明"
          >
            <HelpCircle className="w-6 h-6" />
            <span className="hidden md:inline text-sm font-bold tracking-widest">玄门指南</span>
          </button>
        </header>

        {/* Navigation Tabs */}
        <div className="flex justify-center mb-16">
          <div className="bg-white/60 backdrop-blur-md p-1.5 rounded-full border border-black/5 inline-flex shadow-sm flex-wrap justify-center gap-1">
            {[
              { id: 'bazi', label: '八字排盘' },
              { id: 'compatibility', label: '八字合盘' },
              { id: 'luren', label: '大六壬' },
              { id: 'xiaoluren', label: '小六壬' },
              { id: 'liuyao', label: '六爻' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as Tab)}
                className={`px-6 md:px-10 py-2 md:py-3 rounded-full text-xs md:text-sm font-bold tracking-widest transition-all duration-300 ${
                  activeTab === tab.id 
                    ? 'bg-ink text-paper shadow-md scale-105' 
                    : 'text-ink/60 hover:text-ink hover:bg-white/50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <main>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: activeTab === 'bazi' ? 1 : 0, y: activeTab === 'bazi' ? 0 : 10 }}
            className={activeTab === 'bazi' ? '' : 'hidden'}
          >
            {baziLoading ? (
              <LoadingTaiChi streamText={streamingText.bazi} />
            ) : baziResult && birthInfo ? (
              <BaziResult result={baziResult} birthInfo={birthInfo} onReset={() => setBaziResult(null)} />
            ) : (
              <>
                {baziError && (
                  <div className="max-w-md mx-auto mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-center">
                    {baziError}
                  </div>
                )}
                <BaziForm onSubmit={handleBaziCalculate} isLoading={baziLoading} />
              </>
            )}
          </motion.div>

          <AnimatePresence mode="wait">
            {activeTab === 'compatibility' && (
              <motion.div key="compatibility" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                {compatibilityLoading ? (
                  <LoadingTaiChi streamText={streamingText.compatibility} />
                ) : compatibilityResult && compatibilityInfo ? (
                  <CompatibilityResult result={compatibilityResult} compatibilityInfo={compatibilityInfo} onReset={() => setCompatibilityResult(null)} />
                ) : (
                  <>
                    {compatibilityError && (
                      <div className="max-w-md mx-auto mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-center">
                        {compatibilityError}
                      </div>
                    )}
                    <CompatibilityForm onSubmit={handleCompatibilityCalculate} isLoading={compatibilityLoading} />
                  </>
                )}
              </motion.div>
            )}

            {activeTab === 'luren' && (
              <motion.div key="luren" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                {lurenLoading ? (
                  <LoadingTaiChi streamText={streamingText.luren} />
                ) : lurenResult ? (
                  <LuRenResult result={lurenResult} onReset={() => setLurenResult(null)} />
                ) : (
                  <>
                    {lurenError && (
                      <div className="max-w-md mx-auto mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-center">
                        {lurenError}
                      </div>
                    )}
                    <LuRenForm onSubmit={handleLuRenCalculate} isLoading={lurenLoading} />
                  </>
                )}
              </motion.div>
            )}

            {activeTab === 'xiaoluren' && (
              <motion.div key="xiaoluren" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                {xiaoLurenLoading ? (
                  <LoadingTaiChi streamText={streamingText.xiaoluren} />
                ) : xiaoLurenResult ? (
                  <XiaoLuRenResult result={xiaoLurenResult} onReset={() => setXiaoLurenResult(null)} />
                ) : (
                  <>
                    {xiaoLurenError && (
                      <div className="max-w-md mx-auto mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-center">
                        {xiaoLurenError}
                      </div>
                    )}
                    <XiaoLuRenForm onSubmit={handleXiaoLuRenCalculate} isLoading={xiaoLurenLoading} />
                  </>
                )}
              </motion.div>
            )}

            {activeTab === 'liuyao' && (
              <motion.div key="liuyao" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                {liuyaoLoading ? (
                  <LoadingTaiChi streamText={streamingText.liuyao} />
                ) : liuyaoResult ? (
                  <LiuYaoResult result={liuyaoResult} onReset={() => setLiuyaoResult(null)} />
                ) : (
                  <>
                    {liuyaoError && (
                      <div className="max-w-md mx-auto mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-center">
                        {liuyaoError}
                      </div>
                    )}
                    <LiuYaoForm onSubmit={handleLiuYaoCalculate} isLoading={liuyaoLoading} />
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
        
        <footer className="mt-20 text-center text-ink/40 text-sm tracking-widest">
          <p>仅供娱乐与文化参考，命运掌握在自己手中</p>
        </footer>
      </div>

      <HelpFAQ isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />

      <AnimatePresence>
        {isAccessReady && !isAccessGranted && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-white/18 px-4 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.form
              onSubmit={handleAccessSubmit}
              className="w-full max-w-md rounded-3xl border border-white/70 bg-white/92 p-6 text-slate-900 shadow-[0_24px_80px_rgba(15,23,42,0.22)] backdrop-blur-xl"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
            >
              <h2 className="text-xl font-semibold text-slate-900">请输入访问密钥</h2>
              <p className="mt-2 text-sm text-slate-600">验证通过后才可继续访问与调用接口</p>
              <input
                type="password"
                value={accessKeyInput}
                onChange={(event) => setAccessKeyInput(event.target.value)}
                className="mt-5 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                placeholder="请输入访问密钥"
                autoFocus
              />
              {accessKeyError && <p className="mt-3 text-sm text-rose-500">{accessKeyError}</p>}
              <button
                type="submit"
                disabled={isAccessChecking}
                className="mt-5 w-full rounded-2xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAccessChecking ? '验证中...' : '确认进入'}
              </button>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
