import './styles.css';

type DeckKey = 'A' | 'B';

const byId = <T extends HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error('Missing element: ' + id);
  return element as T;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const writeWav = (frequency: number, bpm: number) => {
  const sampleRate = 44100;
  const seconds = 4;
  const length = sampleRate * seconds;
  const data = new Int16Array(length);
  const beat = 60 / bpm;

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const phase = t % beat;
    const kickEnv = Math.exp(-phase * 22);
    const kick =
      Math.sin(2 * Math.PI * (frequency * 0.55 + 45 * kickEnv) * t) * kickEnv;
    const hatPhase = t % (beat / 2);
    const hatEnv = Math.exp(-hatPhase * 90);
    const noise =
      ((((i * 16807) % 2147483647) / 2147483647) * 2 - 1) * hatEnv * 0.16;
    const bass = Math.sin(2 * Math.PI * frequency * t) * 0.14;
    const sample = Math.max(-1, Math.min(1, kick * 0.62 + bass + noise));
    data[i] = Math.round(sample * 32767);
  }

  const buffer = new ArrayBuffer(44 + data.byteLength);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1)
      view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + data.byteLength, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, data.byteLength, true);
  new Int16Array(buffer, 44).set(data);
  return new Blob([buffer], { type: 'audio/wav' });
};

const AudioContextClass =
  window.AudioContext ||
  (
    window as Window &
      typeof globalThis & { webkitAudioContext?: typeof AudioContext }
  ).webkitAudioContext;
if (!AudioContextClass) throw new Error('Web Audio API unavailable');

const context = new AudioContextClass();
const audioA = new Audio(URL.createObjectURL(writeWav(110, 88)));
const audioB = new Audio(URL.createObjectURL(writeWav(146.83, 96)));
audioA.loop = true;
audioB.loop = true;
audioA.preload = 'auto';
audioB.preload = 'auto';

const sourceA = context.createMediaElementSource(audioA);
const sourceB = context.createMediaElementSource(audioB);
const gainNodeA = context.createGain();
const gainNodeB = context.createGain();
const masterNode = context.createGain();
sourceA.connect(gainNodeA).connect(masterNode).connect(context.destination);
sourceB.connect(gainNodeB).connect(masterNode);

const crossfader = byId<HTMLInputElement>('crossfader');
const master = byId<HTMLInputElement>('master');
const engineState = byId<HTMLDivElement>('engineState');
const mixState = byId<HTMLParagraphElement>('mixState');
const masterState = byId<HTMLSpanElement>('masterState');

const smooth = (node: GainNode, value: number) => {
  const now = context.currentTime;
  node.gain.cancelScheduledValues(now);
  node.gain.setTargetAtTime(value, now, 0.015);
};

const updateCrossfader = () => {
  const x = clamp01(Number(crossfader.value));
  const a = Math.cos(x * Math.PI * 0.5);
  const b = Math.sin(x * Math.PI * 0.5);
  smooth(gainNodeA, a);
  smooth(gainNodeB, b);
  byId<HTMLElement>('gainA').textContent = a.toFixed(3);
  byId<HTMLElement>('gainB').textContent = b.toFixed(3);
  byId<HTMLElement>('meterA').style.height = Math.max(4, a * 100) + '%';
  byId<HTMLElement>('meterB').style.height = Math.max(4, b * 100) + '%';
  mixState.textContent =
    x < 0.08
      ? 'DECK A / FULL'
      : x > 0.92
        ? 'DECK B / FULL'
        : Math.abs(x - 0.5) < 0.03
          ? 'A + B / CENTER'
          : x < 0.5
            ? 'A > B / MIX'
            : 'B > A / MIX';
};

const updateMaster = () => {
  const value = clamp01(Number(master.value));
  smooth(masterNode, value);
  byId<HTMLOutputElement>('masterOut').value = String(Math.round(value * 100));
  masterState.textContent =
    value === 0 ? 'MASTER MUTE' : 'MASTER ' + Math.round(value * 100) + '%';
};

const formatTime = (value: number) => {
  const seconds = Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
};

const wireDeck = (key: DeckKey, audio: HTMLAudioElement) => {
  const button = byId<HTMLButtonElement>('play' + key);
  const led = byId<HTMLElement>('led' + key);
  const status = byId<HTMLElement>('status' + key);
  const platter = document.querySelector(
    key === 'A' ? '.vinyl:not(.vinyl-b)' : '.vinyl-b'
  );
  const refresh = () => {
    const playing = !audio.paused;
    button.classList.toggle('active', playing);
    led.classList.toggle('live', playing);
    platter?.classList.toggle('spin', playing);
    button.querySelector('b')!.textContent = playing ? 'Ⅱ' : '▶';
    button.querySelector('span')!.textContent = playing
      ? 'PAUSE ' + key
      : 'PLAY ' + key;
    status.textContent = playing ? 'GRA' : 'PAUZA';
  };

  button.addEventListener('click', async () => {
    if (context.state === 'suspended') await context.resume();
    if (audio.paused) await audio.play();
    else audio.pause();
    engineState.classList.add('ready');
    engineState.querySelector('span')!.textContent = 'AUDIO ENGINE READY';
    refresh();
  });

  audio.addEventListener('play', refresh);
  audio.addEventListener('pause', refresh);
  refresh();
};

wireDeck('A', audioA);
wireDeck('B', audioB);
crossfader.addEventListener('input', updateCrossfader);
master.addEventListener('input', updateMaster);
updateCrossfader();
updateMaster();

window.setInterval(() => {
  byId<HTMLElement>('timeA').textContent = formatTime(audioA.currentTime);
  byId<HTMLElement>('timeB').textContent = formatTime(audioB.currentTime);
}, 250);
