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

function buildTags(features: AggregateFeatures): string[] {
  const tags: string[] = [];

  if (features.rms < 0.028) {
    tags.push('Ambiente tranquilo');
  }

  if (features.lowRatio > 0.48 && features.flatness > 0.28 && features.centroidHz < 900) {
    tags.push('Viento suave');
  }

  if (
    features.lowRatio > 0.34 &&
    features.midRatio > 0.28 &&
    features.flatness > 0.22 &&
    features.rms > 0.035
  ) {
    tags.push('Tráfico lejano');
  }

  if (
    features.midRatio > 0.44 &&
    features.centroidHz >= 700 &&
    features.centroidHz <= 2400 &&
    features.peakFrameRatio > 0.16
  ) {
    tags.push('Voces lejanas');
  }

  if (
    features.highRatio > 0.26 &&
    features.centroidHz > 3200 &&
    features.peakFrameRatio > 0.14 &&
    features.zeroCrossingRate > 0.07
  ) {
    tags.push('Canto de aves');
  }

  if (
    features.flatness > 0.42 &&
    features.midRatio > 0.26 &&
    features.highRatio > 0.18 &&
    features.rmsDeviation < 0.018
  ) {
    tags.push('Lluvia ligera');
  }

  if (
    features.flatness > 0.3 &&
    features.midRatio > 0.3 &&
    features.highRatio > 0.16 &&
    features.centroidHz > 1500 &&
    features.rmsDeviation < 0.024
  ) {
    tags.push('Agua en movimiento');
  }

  if (tags.length === 0) {
    tags.push(features.rms > 0.05 ? 'Paisaje sonoro activo' : 'Paisaje sonoro estable');
  }

  return uniq(tags).slice(0, 4);
}

function buildSummary(tags: string[]): string {
  if (tags.length === 1) {
    return tags[0];
  }

  if (tags.length === 2) {
    return `${tags[0]} y ${tags[1]}`;
  }

  return `${tags[0]}, ${tags[1]} y ${tags.length - 2} etiquetas más`;
}

function buildDetails(features: AggregateFeatures, durationSeconds: number): string {
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

  return `Escucha pasiva de ${durationSeconds} s. ${energyLabel}, ${spectralLabel} y ${textureLabel}.`;
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
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.72;

  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);

  const frequencyData = new Float32Array(analyser.frequencyBinCount);
  const timeData = new Uint8Array(analyser.fftSize);
  const frames: ClassificationFrame[] = [];

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

    const features = aggregateFrames(frames);
    const durationSeconds = Math.max(1, Math.round(durationMs / 1000));
    const tags = buildTags(features);

    return {
      summary: buildSummary(tags),
      details: buildDetails(features, durationSeconds),
      tags,
      detectedAt: new Date().toISOString(),
      durationSeconds,
      engine: 'local-passive-v1',
    };
  } finally {
    source.disconnect();
    analyser.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    void audioContext.close();
  }
}
