import { equalPower, filterParameters, normalizeEQ, normalizeVolume, safeEchoWet } from './dsp.ts';

export type DeckId = 1 | 2 | 3 | 4;
export type EQBand = 'low' | 'mid' | 'high';
export interface AudioChannelNodes {
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  filter: BiquadFilterNode;
  volume: GainNode;
  analyser: AnalyserNode;
}
/**
 * The local real-time audio graph. Never routes live audio through the backend.
 * A/B buses are shared: decks 1/3 -> A, decks 2/4 -> B.
 *
 * MediaElement playback retains codec support and streaming of large local files.
 * This class does NOT currently implement vinyl scratch, key-lock or STEMS.
 */
export class DJMixerEngine {
  readonly master: GainNode;
  readonly meter: AnalyserNode;
  readonly echoSend: GainNode;
  readonly recordingOutput: MediaStreamAudioDestinationNode;
  private readonly aBus: GainNode;
  private readonly bBus: GainNode;
  private readonly channels = new Map<DeckId, AudioChannelNodes>();
  private recorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  private readonly context: AudioContext;

  constructor(context: AudioContext) {
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = 0.85;
    this.aBus = context.createGain();
    this.bBus = context.createGain();
    this.aBus.connect(this.master);
    this.bBus.connect(this.master);

    // A gentle output safety compressor; clipping avoidance is not guaranteed
    // under all input and recording-device conditions.
    const protection = context.createDynamicsCompressor();
    protection.threshold.value = -3;
    protection.knee.value = 3;
    protection.ratio.value = 12;
    protection.attack.value = 0.003;
    protection.release.value = 0.15;
    this.meter = context.createAnalyser();
    this.meter.fftSize = 512;
    this.recordingOutput = context.createMediaStreamDestination();
    this.master.connect(protection);
    protection.connect(this.meter);
    this.meter.connect(context.destination);
    this.meter.connect(this.recordingOutput);

    // Bounded echo feedback. Wet=0 is an actual silent send.
    const delay = context.createDelay(1);
    delay.delayTime.value = 0.285;
    const feedback = context.createGain();
    feedback.gain.value = 0.29;
    this.echoSend = context.createGain();
    this.echoSend.gain.value = 0;
    this.aBus.connect(this.echoSend);
    this.bBus.connect(this.echoSend);
    this.echoSend.connect(delay);
    delay.connect(this.master);
    delay.connect(feedback);
    feedback.connect(delay);
    this.setCrossfader(0.5);
  }

  attachDeck(id: DeckId, element: HTMLAudioElement): AudioChannelNodes {
    if (this.channels.has(id)) throw new Error('Kanał ' + id + ' jest już podłączony');
    const ctx = this.context;
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf'; low.frequency.value = 220;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking'; mid.frequency.value = 1100; mid.Q.value = 1;
    const high = ctx.createBiquadFilter();
    high.type = 'highshelf'; high.frequency.value = 4500;
    const filter = ctx.createBiquadFilter();
    filter.type = 'allpass';
    const volume = ctx.createGain();
    volume.gain.value = 0.8;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const source = ctx.createMediaElementSource(element);
    source.connect(low);
    low.connect(mid);
    mid.connect(high);
    high.connect(filter);
    filter.connect(volume);
    volume.connect(analyser);
    analyser.connect(id === 1 || id === 3 ? this.aBus : this.bBus);
    const nodes = { low, mid, high, filter, volume, analyser };
    this.channels.set(id, nodes);
    return nodes;
  }

  getChannel(id: DeckId): AudioChannelNodes {
    const channel = this.channels.get(id);
    if (!channel) throw new Error('Kanał ' + id + ' nie jest podłączony');
    return channel;
  }

  setEQ(id: DeckId, band: EQBand, gainDb: number): void {
    this.getChannel(id)[band].gain.setTargetAtTime(normalizeEQ(gainDb), this.context.currentTime, 0.012);
  }
  setFilter(id: DeckId, position: number): void {
    const { type, frequency } = filterParameters(position);
    const node = this.getChannel(id).filter;
    node.type = type;
    node.frequency.setTargetAtTime(frequency, this.context.currentTime, 0.012);
    node.Q.value = 0.9;
  }
  setChannelVolume(id: DeckId, value: number): void {
    this.getChannel(id).volume.gain.setTargetAtTime(normalizeVolume(value), this.context.currentTime, 0.012);
  }
  setCrossfader(position: number): void {
    const { a, b } = equalPower(position);
    this.aBus.gain.setTargetAtTime(a, this.context.currentTime, 0.012);
    this.bBus.gain.setTargetAtTime(b, this.context.currentTime, 0.012);
  }
  setMasterVolume(value: number): void {
    this.master.gain.setTargetAtTime(normalizeVolume(value), this.context.currentTime, 0.012);
  }
  setEcho(enabled: boolean, wet: number): void {
    this.echoSend.gain.setTargetAtTime(enabled ? safeEchoWet(wet) : 0, this.context.currentTime, 0.018);
  }

  get isRecording(): boolean { return this.recorder?.state === 'recording'; }
  startRecording(): void {
    if (this.isRecording) throw new Error('Nagrywanie już trwa');
    if (typeof MediaRecorder === 'undefined') throw new Error('Ta przeglądarka nie obsługuje nagrywania');
    const candidateTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mimeType = candidateTypes.find(type => MediaRecorder.isTypeSupported(type));
    const recorder = mimeType
      ? new MediaRecorder(this.recordingOutput.stream, { mimeType })
      : new MediaRecorder(this.recordingOutput.stream);
    this.recordedChunks = [];
    recorder.addEventListener('dataavailable', event => {
      if (event.data.size > 0) this.recordedChunks.push(event.data);
    });
    recorder.start(1000);
    this.recorder = recorder;
  }
  stopRecording(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder || recorder.state !== 'recording') return Promise.reject(new Error('Nagrywanie nie jest aktywne'));
    return new Promise((resolve, reject) => {
      recorder.addEventListener('stop', () => {
        this.recorder = null;
        const blob = new Blob(this.recordedChunks, { type: recorder.mimeType || 'audio/webm' });
        this.recordedChunks = [];
        blob.size > 0 ? resolve(blob) : reject(new Error('Nagranie jest puste'));
      }, { once: true });
      recorder.addEventListener('error', () => reject(new Error('Błąd MediaRecorder')), { once: true });
      recorder.stop();
    });
  }
  dispose(): void {
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.channels.clear();
    this.recordingOutput.disconnect();
    this.echoSend.disconnect();
    this.aBus.disconnect();
    this.bBus.disconnect();
    this.master.disconnect();
    this.meter.disconnect();
  }
}
