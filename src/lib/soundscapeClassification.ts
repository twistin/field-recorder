import type { AudioClassifier as MediaPipeAudioClassifier, AudioClassifierResult } from '@mediapipe/tasks-audio';
import type { SoundscapeClassification } from '../types/fieldSessions';

interface ClassificationFrame {
  rms: number;
  zeroCrossingRate: number;
  centroidHz: number;
  flatness: number;
  lowRatio: number;
  midRatio: number;
  highRatio: number;
}

interface AggregateFeatures {
  rms: number;
  rmsDeviation: number;
  zeroCrossingRate: number;
  centroidHz: number;
  flatness: number;
  lowRatio: number;
  midRatio: number;
  highRatio: number;
  peakFrameRatio: number;
}

const DEFAULT_DURATION_MS = 15_000;
const MEDIAPIPE_WASM_BASE_PATH = '/mediapipe/tasks-audio/wasm';
const YAMNET_MODEL_PATH = '/models/yamnet.tflite';
const YAMNET_TOPK = 8;
const YAMNET_SCORE_THRESHOLD = 0.08;

let classifierPromise: Promise<MediaPipeAudioClassifier> | null = null;

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], average = mean(values)): number {
  if (values.length === 0) {
    return 0;
  }

  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length,
  );
}

function extractFrameFeatures(
  frequencyData: Float32Array,
  timeData: Uint8Array,
  sampleRate: number,
): ClassificationFrame {
  const nyquist = sampleRate / 2;
  const binWidth = nyquist / frequencyData.length;
  let totalPower = 0;
  let weightedFrequency = 0;
  let lowPower = 0;
  let midPower = 0;
  let highPower = 0;
  let arithmeticMean = 0;
  let logarithmicMean = 0;

  for (let index = 0; index < frequencyData.length; index += 1) {
    const amplitude = Math.max(1e-6, 10 ** (frequencyData[index] / 20));
    const frequency = index * binWidth;
    totalPower += amplitude;
    weightedFrequency += amplitude * frequency;
    arithmeticMean += amplitude;
    logarithmicMean += Math.log(amplitude);

    if (frequency < 250) {
      lowPower += amplitude;
    } else if (frequency < 2500) {
      midPower += amplitude;
    } else {
      highPower += amplitude;
    }
  }

  let squaredAmplitude = 0;
  let zeroCrossings = 0;
  let previousSample = 0;

  for (let index = 0; index < timeData.length; index += 1) {
    const sample = (timeData[index] - 128) / 128;
    squaredAmplitude += sample * sample;

    if (index > 0 && (sample >= 0) !== (previousSample >= 0)) {
      zeroCrossings += 1;
    }

    previousSample = sample;
  }

  const rms = Math.sqrt(squaredAmplitude / timeData.length);
  const centroidHz = totalPower > 0 ? weightedFrequency / totalPower : 0;
  const flatness =
    arithmeticMean > 0
      ? Math.exp(logarithmicMean / frequencyData.length) / (arithmeticMean / frequencyData.length)
      : 0;

  return {
    rms,
    zeroCrossingRate: zeroCrossings / Math.max(1, timeData.length - 1),
    centroidHz,
    flatness,
    lowRatio: totalPower > 0 ? lowPower / totalPower : 0,
    midRatio: totalPower > 0 ? midPower / totalPower : 0,
    highRatio: totalPower > 0 ? highPower / totalPower : 0,
  };
}

function aggregateFrames(frames: ClassificationFrame[]): AggregateFeatures {
  const rmsValues = frames.map((frame) => frame.rms);
  const rmsAverage = mean(rmsValues);
  const rmsDeviation = standardDeviation(rmsValues, rmsAverage);
  const peakFrameRatio =
    frames.length > 0
      ? frames.filter((frame) => frame.rms >= rmsAverage + rmsDeviation).length / frames.length
      : 0;

  return {
    rms: rmsAverage,
    rmsDeviation,
    zeroCrossingRate: mean(frames.map((frame) => frame.zeroCrossingRate)),
    centroidHz: mean(frames.map((frame) => frame.centroidHz)),
    flatness: mean(frames.map((frame) => frame.flatness)),
    lowRatio: mean(frames.map((frame) => frame.lowRatio)),
    midRatio: mean(frames.map((frame) => frame.midRatio)),
    highRatio: mean(frames.map((frame) => frame.highRatio)),
    peakFrameRatio,
  };
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values));
}

function buildHeuristicTags(features: AggregateFeatures): string[] {
  const tags: string[] = [];

  const looksLikeBirds =
    features.highRatio > 0.26 &&
    features.centroidHz > 3200 &&
    features.peakFrameRatio > 0.14 &&
    features.zeroCrossingRate > 0.07;

  const looksLikeSpeech =
    features.midRatio > 0.44 &&
    features.centroidHz >= 700 &&
    features.centroidHz <= 2400 &&
    features.peakFrameRatio > 0.12 &&
    features.peakFrameRatio < 0.34 &&
    features.flatness < 0.38;

  const looksLikeFootsteps =
    features.lowRatio > 0.28 &&
    features.midRatio > 0.22 &&
    features.centroidHz >= 250 &&
    features.centroidHz <= 1800 &&
    features.peakFrameRatio > 0.2 &&
    features.rmsDeviation > 0.018 &&
    features.flatness < 0.28;

  const looksLikeMusic =
    features.lowRatio > 0.18 &&
    features.midRatio > 0.32 &&
    features.highRatio > 0.14 &&
    features.centroidHz >= 700 &&
    features.centroidHz <= 3200 &&
    features.rms > 0.03 &&
    features.rmsDeviation > 0.012 &&
    features.flatness < 0.32 &&
    features.peakFrameRatio >= 0.06 &&
    features.peakFrameRatio <= 0.24;

  const looksLikeWind =
    features.lowRatio > 0.48 &&
    features.flatness > 0.28 &&
    features.centroidHz < 900;

  const looksLikeTraffic =
    features.lowRatio > 0.34 &&
    features.midRatio > 0.28 &&
    features.flatness > 0.22 &&
    features.rms > 0.035;

  const looksLikeRain =
    features.flatness > 0.42 &&
    features.midRatio > 0.26 &&
    features.highRatio > 0.18 &&
    features.rmsDeviation < 0.018;

  const looksLikeRiver =
    features.flatness > 0.3 &&
    features.midRatio > 0.3 &&
    features.highRatio > 0.16 &&
    features.centroidHz > 1500 &&
    features.rmsDeviation < 0.024;

  const looksLikeSea =
    features.lowRatio > 0.4 &&
    features.midRatio > 0.22 &&
    features.flatness > 0.24 &&
    features.centroidHz >= 700 &&
    features.centroidHz <= 1800 &&
    features.rmsDeviation < 0.026;

  if (looksLikeBirds) {
    tags.push('Pájaros');
  }

  if (looksLikeSpeech) {
    tags.push('Personas hablando');
  }

  if (looksLikeFootsteps) {
    tags.push('Pasos');
  }

  if (looksLikeMusic) {
    tags.push('Música');
  }

  if (looksLikeRain) {
    tags.push('Lluvia');
  }

  if (looksLikeRiver) {
    tags.push('Río o arroyo');
  }

  if (looksLikeSea) {
    tags.push('Mar u oleaje');
  }

  if (!looksLikeRiver && !looksLikeSea && features.flatness > 0.28 && features.highRatio > 0.14) {
    tags.push('Agua en movimiento');
  }

  if (looksLikeWind) {
    tags.push('Viento');
  }

  if (looksLikeTraffic) {
    tags.push('Tráfico');
  }

  if (tags.length === 0 && features.rms < 0.028) {
    tags.push('Ambiente tranquilo');
  }

  if (tags.length === 0) {
    tags.push(features.rms > 0.05 ? 'Actividad sonora difusa' : 'Ambiente estable');
  }

  return uniq(tags).slice(0, 5);
}

function buildSummary(tags: string[]): string {
  if (tags.length === 1) {
    return tags[0];
  }

  if (tags.length === 2) {
    return `${tags[0]} y ${tags[1]}`;
  }

  return `${tags.slice(0, -1).join(', ')} y ${tags[tags.length - 1]}`;
}

function buildHeuristicDetails(features: AggregateFeatures, durationSeconds: number, tags: string[]): string {
  const energyLabel =
    features.rms < 0.03 ? 'baja energía' : features.rms < 0.055 ? 'energía media' : 'energía alta';
  const spectralLabel =
    features.centroidHz < 900
      ? 'predominio grave'
      : features.centroidHz < 2600
        ? 'predominio medio'
        : 'predominio agudo';
  const textureLabel =
    features.flatness > 0.42
      ? 'textura continua'
      : features.flatness > 0.26
        ? 'mezcla difusa'
        : 'eventos definidos';

  const detectionLabel =
    tags.length > 0
      ? `Detección local aproximada: ${buildSummary(tags)}.`
      : 'No se detectaron elementos dominantes claros.';

  return `${detectionLabel} Escucha pasiva de ${durationSeconds} s con ${energyLabel}, ${spectralLabel} y ${textureLabel}.`;
}

function concatFloat32Chunks(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;

  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });

  return merged;
}

function mapYamnetCategory(categoryName: string): string | null {
  const normalized = categoryName.toLowerCase();

  if (
    normalized.includes('speech') ||
    normalized.includes('conversation') ||
    normalized.includes('narration') ||
    normalized.includes('babbling') ||
    normalized.includes('whisper')
  ) {
    return 'Personas hablando';
  }

  if (
    normalized.includes('music') ||
    normalized.includes('singing') ||
    normalized.includes('choir') ||
    normalized.includes('musical instrument')
  ) {
    return 'Música';
  }

  if (normalized.includes('bird') || normalized.includes('chirp') || normalized.includes('tweet')) {
    return 'Pájaros';
  }

  if (normalized.includes('footsteps') || normalized.includes('walk, footsteps') || normalized.includes('run')) {
    return 'Pasos';
  }

  if (normalized.includes('stream') || normalized.includes('waterfall') || normalized.includes('gurgling')) {
    return 'Río o arroyo';
  }

  if (normalized.includes('ocean') || normalized.includes('waves') || normalized.includes('surf')) {
    return 'Mar u oleaje';
  }

  if (normalized.includes('rain') || normalized.includes('thunderstorm')) {
    return 'Lluvia';
  }

  if (normalized.includes('wind') || normalized.includes('rustling leaves')) {
    return 'Viento';
  }

  if (
    normalized.includes('traffic') ||
    normalized.includes('vehicle') ||
    normalized.includes('car') ||
    normalized.includes('motorcycle') ||
    normalized.includes('truck') ||
    normalized.includes('bus')
  ) {
    return 'Tráfico';
  }

  return null;
}

async function getAudioClassifier(): Promise<MediaPipeAudioClassifier> {
  if (!classifierPromise) {
    classifierPromise = (async () => {
      const { AudioClassifier, FilesetResolver } = await import('@mediapipe/tasks-audio');
      const wasmFileset = await FilesetResolver.forAudioTasks(MEDIAPIPE_WASM_BASE_PATH);

      return AudioClassifier.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath: YAMNET_MODEL_PATH,
          delegate: 'CPU',
        },
        displayNamesLocale: 'en',
        maxResults: YAMNET_TOPK,
        scoreThreshold: YAMNET_SCORE_THRESHOLD,
      });
    })().catch((error) => {
      classifierPromise = null;
      throw error;
    });
  }

  return classifierPromise;
}

function buildModelClassification(
  results: AudioClassifierResult[],
  durationSeconds: number,
): SoundscapeClassification | null {
  const scoreByLabel = new Map<string, number>();
  const rawByLabel = new Map<string, Set<string>>();

  results.forEach((result) => {
    result.classifications.forEach((head) => {
      head.categories.forEach((category) => {
        const mappedLabel = mapYamnetCategory(category.categoryName || category.displayName);
        if (!mappedLabel) {
          return;
        }

        scoreByLabel.set(mappedLabel, (scoreByLabel.get(mappedLabel) ?? 0) + category.score);
        const rawLabels = rawByLabel.get(mappedLabel) ?? new Set<string>();
        rawLabels.add(category.categoryName || category.displayName);
        rawByLabel.set(mappedLabel, rawLabels);
      });
    });
  });

  const windowCount = Math.max(1, results.length);
  const ranked = Array.from(scoreByLabel.entries())
    .map(([label, score]) => ({
      label,
      score: score / windowCount,
      raw: Array.from(rawByLabel.get(label) ?? []),
    }))
    .sort((left, right) => right.score - left.score);

  const selected = ranked.filter((entry) => entry.score >= 0.12).slice(0, 5);
  const fallbackSelection = selected.length > 0 ? selected : ranked.filter((entry) => entry.score >= 0.08).slice(0, 3);

  if (fallbackSelection.length === 0) {
    return null;
  }

  const tags = fallbackSelection.map((entry) => entry.label);
  const detailLines = fallbackSelection
    .slice(0, 3)
    .map((entry) => `${entry.label} ${Math.round(entry.score * 100)}%`)
    .join(' · ');

  return {
    summary: buildSummary(tags),
    details: `YAMNet local detectó: ${detailLines}. Escucha de ${durationSeconds} s sin guardar audio.`,
    tags,
    detectedAt: new Date().toISOString(),
    durationSeconds,
    engine: 'yamnet-mediapipe-v1',
  };
}

async function captureWaveformAndFeatures(
  stream: MediaStream,
  audioContext: AudioContext,
  durationMs: number,
): Promise<{ waveform: Float32Array; frames: ClassificationFrame[] }> {
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.72;

  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const sink = audioContext.createGain();
  sink.gain.value = 0;

  source.connect(analyser);
  source.connect(processor);
  processor.connect(sink);
  sink.connect(audioContext.destination);

  const frequencyData = new Float32Array(analyser.frequencyBinCount);
  const timeData = new Uint8Array(analyser.fftSize);
  const frames: ClassificationFrame[] = [];
  const waveformChunks: Float32Array[] = [];

  processor.onaudioprocess = (event) => {
    const channelData = event.inputBuffer.getChannelData(0);
    waveformChunks.push(new Float32Array(channelData));
  };

  try {
    const startedAt = performance.now();

    await new Promise<void>((resolve) => {
      const sampleFrame = () => {
        analyser.getFloatFrequencyData(frequencyData);
        analyser.getByteTimeDomainData(timeData);
        frames.push(extractFrameFeatures(frequencyData, timeData, audioContext.sampleRate));

        if (performance.now() - startedAt >= durationMs) {
          resolve();
          return;
        }

        window.requestAnimationFrame(sampleFrame);
      };

      sampleFrame();
    });

    return {
      waveform: concatFloat32Chunks(waveformChunks),
      frames,
    };
  } finally {
    processor.onaudioprocess = null;
    source.disconnect();
    analyser.disconnect();
    processor.disconnect();
    sink.disconnect();
  }
}

export async function captureSoundscapeClassification(
  options?: { durationMs?: number },
): Promise<SoundscapeClassification> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador no permite escuchar el micro para clasificar el paisaje sonoro.');
  }

  const durationMs = options?.durationMs ?? DEFAULT_DURATION_MS;
  const AudioContextCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextCtor) {
    throw new Error('AudioContext no está disponible en este navegador.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  const audioContext = new AudioContextCtor();
  await audioContext.resume();

  try {
    const { waveform, frames } = await captureWaveformAndFeatures(stream, audioContext, durationMs);
    const durationSeconds = Math.max(1, Math.round(durationMs / 1000));

    try {
      const classifier = await getAudioClassifier();
      const modelClassification = buildModelClassification(
        classifier.classify(waveform, audioContext.sampleRate),
        durationSeconds,
      );

      if (modelClassification) {
        return modelClassification;
      }
    } catch (error) {
      console.warn('YAMNet audio classification unavailable, falling back to heuristic classifier.', error);
    }

    const features = aggregateFrames(frames);
    const tags = buildHeuristicTags(features);

    return {
      summary: buildSummary(tags),
      details: buildHeuristicDetails(features, durationSeconds, tags),
      tags,
      detectedAt: new Date().toISOString(),
      durationSeconds,
      engine: 'local-passive-v2',
    };
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    void audioContext.close();
  }
}
