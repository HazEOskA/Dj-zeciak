import './styles.css';
import { DJMixerEngine, type AudioChannelNodes } from './audio/mixer';

type Side = 'left' | 'right';
type DeckId = 1 | 2 | 3 | 4;
type PadMode = 'sample' | 'cue';
type AudioNodes = AudioChannelNodes;
interface Deck {
  id: DeckId;
  audio: HTMLAudioElement;
  url: string | null;
  title: string;
  bpm: number;
  pitch: number;
  sync: boolean;
  cue: number | null;
  hotCues: Array<number | null>;
  loopStart: number | null;
  loopEnd: number | null;
  peaks: number[];
  nodes: AudioNodes;
}
const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error('Brak elementu: ' + id);
  return node as T;
};
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const fmt = (n: number) => {
  if (!Number.isFinite(n)) return '--:--';
  const seconds = Math.floor(Math.max(0, n));
  return Math.floor(seconds / 60).toString().padStart(2, '0') + ':' + (seconds % 60).toString().padStart(2, '0');
};
const labelSafe = (t: string) => t.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch] || ch));
const Context = window.AudioContext;
const ctx: AudioContext | null = Context ? new Context() : null;
const decks = new Map<DeckId, Deck>();
const active: Record<Side, DeckId> = { left: 1, right: 2 };
const padMode: Record<Side, PadMode> = { left: 'sample', right: 'sample' };
const presetNames = ['KICK', 'SNARE', 'CLOSED HAT', 'CLAP', 'OPEN HAT', 'TOM', 'RIDE', 'FX'];
const sampleBuffers: Array<AudioBuffer | null> = Array(8).fill(null);
const sampleNames = [...presetNames];
let master: GainNode | null = null;
let masterAnalyser: AnalyserNode | null = null;
const mixer = ctx ? new DJMixerEngine(ctx) : null;
let fxEnabled = false;
let lastTap: number[] = [];
let playheadRaf = 0;
const flash = (message: string) => { $('message-text').textContent = message; };
const activeDeck = (side: Side) => decks.get(active[side]) as Deck;
const otherSide = (side: Side): Side => side === 'left' ? 'right' : 'left';
const canPlay = (d: Deck) => Boolean(d.url && Number.isFinite(d.audio.duration) && d.audio.duration > 0);

function createEngine(): void {
  if (!ctx || !mixer) {
    flash('Twoja przeglądarka nie obsługuje Web Audio API.');
    return;
  }
  master = mixer.master;
  masterAnalyser = mixer.meter;
  [1, 2, 3, 4].forEach((num) => {
    const id = num as DeckId;
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    const nodes = mixer.attachDeck(id, audio);
    const d: Deck = { id, audio, url: null, title: 'NIE WCZYTANO UTWORU', bpm: 120, pitch: 0, sync: false, cue: null, hotCues: Array(8).fill(null), loopStart: null, loopEnd: null, peaks: [], nodes };
    decks.set(id, d);
    audio.addEventListener('loadedmetadata', () => refreshDeck(id));
    audio.addEventListener('timeupdate', () => {
      if (d.loopStart !== null && d.loopEnd !== null && audio.currentTime >= d.loopEnd) audio.currentTime = d.loopStart;
      refreshDeck(id);
    });
    audio.addEventListener('ended', () => refreshDeck(id));
    audio.addEventListener('error', () => flash('Nie można odtworzyć pliku na kanale ' + id + '. Spróbuj MP3 lub WAV.'));
  });
  $('audio-label').textContent = ctx.state === 'running' ? 'SILNIK AKTYWNY' : 'KLIKNIJ PLAY';
}
async function startAudio(): Promise<boolean> {
  if (!ctx) { flash('Brak obsługi Web Audio API.'); return false; }
  if (ctx.state === 'suspended') await ctx.resume();
  $('audio-label').textContent = ctx.state === 'running' ? 'SILNIK AKTYWNY' : 'AUDIO ZABLOKOWANE';
  return ctx.state === 'running';
}
const channelPot = (index: number, kind: string, title: string, value = '0', min = '-12', max = '12') =>
  '<label class="knob-field">' + title + '<div class="knob-wrap"><div class="knob" id="knob-' + index + '-' + kind + '"></div><input aria-label="Kanał ' + index + ' ' + title + '" data-knob="' + kind + '" data-ch="' + index + '" type="range" min="' + min + '" max="' + max + '" step="1" value="' + value + '"></div></label>';
function renderChannels(): void {
  $('channels').innerHTML = [1,2,3,4].map(i =>
    '<section class="channel" aria-label="Kanał miksera ' + i + '"><div class="ch-name"><i class="' + ((i === 1 || i === 3) ? '' : 'ch-b') + '"></i>CH ' + i + '</div><div class="ch-assignment">DECK ' + i + ' / ' + ((i === 1 || i === 3) ? 'A' : 'B') + '</div>' +
    channelPot(i,'low','LOW') + channelPot(i,'mid','MID') + channelPot(i,'high','HIGH') +
    channelPot(i,'filter','FILTER','0','-100','100') +
    '<div class="ch-vu" aria-label="Wskaźnik poziomu kanału ' + i + '"><span id="vu-' + i + '-l"></span><span id="vu-' + i + '-r"></span></div>' +
    '<div class="vertical-fader-wrap"><input class="fader" data-channel-volume="' + i + '" type="range" min="0" max="1" step=".01" value=".8" aria-label="Fader głośności kanału ' + i + '"></div><div class="ch-footer"><span>MIN</span><span>MAX</span></div></section>'
  ).join('');
}
const deckTemplate = (side: Side): string => {
  const d = activeDeck(side);
  const ids = side === 'left' ? [1, 3] : [2, 4];
  const filename = labelSafe(d.title);
  const pads = Array.from({length: 8}, (_, i) => '<button class="pad" type="button" data-act="pad" data-pad="' + i + '" title="Pad ' + (i+1) + '"><span>' + labelSafe(padMode[side] === 'sample' ? sampleNames[i] : ('CUE ' + (i+1))) + '</span><small>' + (i+1) + '</small></button>').join('');
  return '<div class="deck-header"><div class="deck-label">DECK <span class="deck-number">' + d.id + '</span><small>' + (side === 'left' ? 'CONTROL L' : 'CONTROL R') + '</small></div><div class="layer-toggle"><span>LAYER</span>' + ids.map(id => '<button type="button" data-act="layer" data-layer="' + id + '" class="' + (d.id === id ? 'active' : '') + '" aria-pressed="' + (d.id === id) + '">' + id + '</button>').join('') + '</div></div>' +
    '<div class="deck-display"><div class="file-row"><strong class="track-title" id="title-' + side + '" title="' + filename + '">' + filename + '</strong><button class="load-btn" data-act="load" type="button">+ WCZYTAJ UTWÓR</button><input class="deck-file" id="file-' + side + '" type="file" accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac"></div><div class="deck-meta"><span id="bpm-' + side + '">120.0 BPM / MANUAL</span><span class="muted" id="status-' + side + '">BRAK TRACKU</span></div><canvas width="720" height="110" class="waveform" id="wave-' + side + '" aria-label="Waveform — kliknij aby przewinąć"></canvas><div class="time-line"><strong id="clock-' + side + '">00:00</strong><span id="duration-' + side + '">--:--</span></div></div>' +
    '<div class="deck-working"><div class="jog-region"><div class="jog-shell" data-act="jog" role="slider" tabindex="0" aria-label="Jog wheel — obróć lub przeciągnij aby przewinąć"><div class="jog-plate"></div><div class="jog-ring"></div><div class="jog-screen"><small>DECK ' + d.id + '</small><b id="jog-bpm-' + side + '">' + d.bpm + '</b><small>BPM</small></div><div class="jog-tick" id="jog-tick-' + side + '"></div></div><div class="jog-note">JOG WHEEL / SCRUB · SCROLL</div></div><div class="side-controls"><div class="side-title"><span>TEMPO / PITCH</span><b id="pitch-' + side + '">+0.0%</b></div><input aria-label="Pitch dla Deck ' + d.id + '" class="tempo-range" type="range" min="-8" max="8" step=".1" value="' + d.pitch + '" data-pitch><div class="field-label"><span>BPM MANUAL</span><strong>TAP / SYNC</strong></div><input class="tempo-bpm" type="number" min="40" max="240" step=".1" value="' + d.bpm + '" data-bpm aria-label="Ręczne BPM"><div class="small-actions"><button class="small-btn" data-act="tap" type="button">TAP BPM</button><button class="small-btn ' + (d.sync ? 'on' : '') + '" data-act="sync" type="button" aria-pressed="' + d.sync + '">SYNC</button></div><div class="tempo-text">DOSTOSUJ TEMPO</div></div></div>' +
    '<div class="transport"><button class="cue-btn" type="button" data-act="cue">◉ CUE</button><button class="play-btn ' + (!d.audio.paused ? 'is-playing' : '') + '" type="button" data-act="play" id="play-' + side + '">' + (d.audio.paused ? '▶ PLAY' : 'Ⅱ PAUZA') + '</button><button type="button" data-act="setcue">SET CUE</button><button type="button" data-act="loop" class="loop-btn ' + (d.loopStart !== null ? 'on' : '') + '">⟲ 4 BEAT</button></div>' +
    '<div class="pad-header"><strong>PERFORMANCE PADS</strong><div class="pad-mode"><button data-act="mode" data-mode="cue" class="' + (padMode[side] === 'cue' ? 'active' : '') + '" aria-pressed="' + (padMode[side] === 'cue') + '" type="button">HOT CUE</button><button data-act="mode" data-mode="sample" class="' + (padMode[side] === 'sample' ? 'active' : '') + '" aria-pressed="' + (padMode[side] === 'sample') + '" type="button">SAMPLER</button></div></div><div class="pad-grid">' + pads + '</div><div class="sample-action"><span>8 × PERFORMANCE PADS</span><button type="button" data-act="samples">+ WŁASNE SAMPLE</button><input class="deck-file" type="file" id="sample-file-' + side + '" accept="audio/*,.mp3,.wav,.ogg" multiple></div>';
};
function renderDeck(side: Side): void {
  $('deck-' + side).innerHTML = deckTemplate(side);
  const d = activeDeck(side);
  if (d.hotCues.some(x => x !== null)) updatePads(side);
  drawWaveform(side);
  refreshDeck(d.id);
}
function refreshDeck(id: DeckId): void {
  const side: Side = id === 1 || id === 3 ? 'left' : 'right';
  if (active[side] !== id) return;
  const d = decks.get(id)!;
  const t = d.audio.currentTime || 0;
  const status = $('status-' + side);
  const play = $('play-' + side);
  $('clock-' + side).textContent = fmt(t);
  $('duration-' + side).textContent = fmt(d.audio.duration);
  $('bpm-' + side).textContent = (d.bpm * d.audio.playbackRate).toFixed(1) + ' BPM / ' + (d.sync ? 'SYNC' : 'MANUAL');
  $('jog-bpm-' + side).textContent = (d.bpm * d.audio.playbackRate).toFixed(0);
  $('pitch-' + side).textContent = (d.pitch >= 0 ? '+' : '') + d.pitch.toFixed(1) + '%';
  status.textContent = !d.url ? 'BRAK TRACKU' : !canPlay(d) ? 'ŁADOWANIE' : d.audio.paused ? 'PAUZA' : '● ON AIR';
  status.style.color = !d.audio.paused ? '#75eed4' : '#8394a6';
  play.textContent = d.audio.paused ? '▶ PLAY' : 'Ⅱ PAUZA';
  play.classList.toggle('is-playing', !d.audio.paused);
  $('jog-tick-' + side).style.transform = 'rotate(' + ((t * (d.bpm / 60) * 8) % 360).toFixed(1) + 'deg)';
  drawWaveform(side);
}
function drawWaveform(side: Side): void {
  const canvas = $('wave-' + side) as HTMLCanvasElement;
  if (!canvas) return;
  const g = canvas.getContext('2d');
  if (!g) return;
  const d = activeDeck(side);
  const w = canvas.width, h = canvas.height, mid = h/2;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#0b1823'; g.fillRect(0,0,w,h);
  g.strokeStyle = '#274051'; g.beginPath(); g.moveTo(0,mid); g.lineTo(w,mid); g.stroke();
  if (!d.peaks.length) {
    g.font = '17px monospace'; g.textAlign = 'center'; g.fillStyle = '#587184';
    g.fillText('ZAŁADUJ AUDIO, ABY ZOBACZYĆ WAVEFORM',w/2,h/2+5);
    return;
  }
  const ratio = d.audio.duration ? clamp(d.audio.currentTime / d.audio.duration,0,1) : 0;
  const played = ratio * w;
  const barWidth = w / d.peaks.length;
  d.peaks.forEach((a,i) => {
    const height = Math.max(2, a * (h-10));
    g.fillStyle = i*barWidth <= played ? '#74e6d0' : '#2d6c87';
    g.fillRect(i*barWidth,mid-height/2,Math.max(1,barWidth-1),height);
  });
  d.hotCues.forEach((cue, i) => {
    if (cue === null || !d.audio.duration) return;
    const x = cue / d.audio.duration * w;
    g.fillStyle = '#eeb4b7'; g.fillRect(x,0,2,h);
    g.font = '12px monospace';g.fillText(String(i+1),x+3,11);
  });
  if (d.loopStart !== null && d.loopEnd !== null && d.audio.duration) {
    g.fillStyle = '#fff3a013';
    g.fillRect(d.loopStart/d.audio.duration*w,0,(d.loopEnd-d.loopStart)/d.audio.duration*w,h);
  }
  g.fillStyle = '#f8f8e5'; g.fillRect(played,0,2,h);
}
async function loadTrack(side: Side, file: File): Promise<void> {
  const d = activeDeck(side);
  if (!(file.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(file.name))) { flash('Niedozwolony format. Wybierz plik audio.'); return; }
  if (file.size > 100 * 1024 * 1024) { flash('Limit pliku w preview: 100 MB.'); return; }
  d.audio.pause();
  if (d.url) URL.revokeObjectURL(d.url);
  d.url = URL.createObjectURL(file);
  d.audio.src = d.url; d.audio.load();
  d.title = file.name.replace(/\.[^.]+$/, '').slice(0,64);
  d.cue = null;d.hotCues.fill(null);d.loopStart = null;d.loopEnd = null;d.peaks = [];
  renderDeck(side);
  flash('Wczytano ' + file.name + ' na Deck ' + d.id + '. Analiza waveform…');
  if (ctx) {
    try {
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      const samples = buffer.getChannelData(0);
      const buckets = 240;
      const step = Math.max(1,Math.floor(samples.length/buckets));
      d.peaks = Array.from({length:buckets}, (_,i) => {
        let max = 0;
        for (let j=i*step;j<Math.min((i+1)*step,samples.length);j+=Math.max(1,Math.floor(step/160))) max=Math.max(max,Math.abs(samples[j]));
        return Math.max(.05,Math.min(1,max));
      });
      if (active[side] === d.id) drawWaveform(side);
      flash('Deck ' + d.id + ': ' + file.name + ' gotowy. Naciśnij PLAY.');
    } catch {
      flash('Plik wczytany, ale nie udało się wyświetlić waveform. Odtwarzanie może działać.');
    }
  }
}
async function togglePlay(side: Side): Promise<void> {
  const d = activeDeck(side);
  if (!canPlay(d)) { flash('Najpierw kliknij + WCZYTAJ UTWÓR dla Deck ' + d.id + '.'); return; }
  if (d.audio.paused) {
    if (!(await startAudio())) return;
    try { await d.audio.play(); flash('Deck ' + d.id + ' — odtwarzanie.'); }
    catch { flash('Odtwarzanie nie powiodło się. Sprawdź plik i uprawnienia przeglądarki.'); }
  } else { d.audio.pause();flash('Deck ' + d.id + ' — pauza.'); }
  refreshDeck(d.id);
}
function seek(d: Deck, time: number): void {
  if (!canPlay(d)) return;
  d.audio.currentTime = clamp(time,0,d.audio.duration-.01);
  refreshDeck(d.id);
}
function rate(d: Deck): void {
  const other = activeDeck(otherSide(d.id===1||d.id===3?'left':'right'));
  const target = d.sync ? other.bpm * (1+other.pitch/100) : d.bpm * (1+d.pitch/100);
  d.audio.playbackRate = clamp(target / Math.max(1,d.bpm),.5,2);
}
function setCrossfade(x: number): void {
  mixer?.setCrossfader(x);
}
function updatePads(side: Side): void {
  const d = activeDeck(side);
  const root = $('deck-' + side);
  root.querySelectorAll<HTMLButtonElement>('.pad').forEach((button,i) => {
    button.classList.toggle('filled',padMode[side]==='cue' && d.hotCues[i] !== null);
    const title = button.querySelector('span');
    if (title) title.textContent = padMode[side]==='sample' ? sampleNames[i] : 'CUE ' + (i+1);
  });
}
function triggerPreset(index: number): void {
  if (!ctx || !master) return;
  const now=ctx.currentTime;
  const output=ctx.createGain();
  output.connect(master);
  const noise = index===1||index===2||index===3||index===4||index===6;
  if (noise) {
    const len=Math.floor(ctx.sampleRate*(index===4? .38:.19));
    const buffer=ctx.createBuffer(1,len,ctx.sampleRate);
    const data=buffer.getChannelData(0);
    for(let j=0;j<len;j++)data[j]=Math.random()*2-1;
    const src=ctx.createBufferSource();src.buffer=buffer;
    const filter=ctx.createBiquadFilter();filter.type=index===2||index===4||index===6?'highpass':'bandpass';filter.frequency.value=index===2?6500:index===4?5000:1800;
    const gain=ctx.createGain();gain.gain.setValueAtTime(.2,now);gain.gain.exponentialRampToValueAtTime(.001,now+len/ctx.sampleRate);
    src.connect(filter).connect(gain).connect(output);src.start(now);src.stop(now+len/ctx.sampleRate);
  } else {
    const osc=ctx.createOscillator();const gain=ctx.createGain();
    osc.type=index===7?'sawtooth':'sine';
    const initial=[150,0,0,0,0,230,0,700][index]||120;
    osc.frequency.setValueAtTime(initial,now);
    osc.frequency.exponentialRampToValueAtTime(index===7?75:42,now+(index===7?.37:.22));
    gain.gain.setValueAtTime(.5,now);gain.gain.exponentialRampToValueAtTime(.001,now+(index===7?.38:.24));
    osc.connect(gain).connect(output);osc.start(now);osc.stop(now+.4);
  }
}
async function triggerSample(index: number): Promise<void> {
  if (!(await startAudio()) || !ctx || !master) return;
  const sample=sampleBuffers[index];
  if (sample) {
    const src=ctx.createBufferSource();src.buffer=sample;
    const gain=ctx.createGain();gain.gain.value=.85;
    src.connect(gain).connect(master);src.start();
  } else triggerPreset(index);
  flash('Sampler — pad ' + (index+1) + ': ' + sampleNames[index] + '.');
}
async function usePad(side: Side, index: number, clear: boolean): Promise<void> {
  const d=activeDeck(side);
  if (padMode[side]==='sample') { await triggerSample(index);return; }
  if (!canPlay(d)) { flash('Wczytaj utwór przed ustawieniem HOT CUE.'); return; }
  if(clear) { d.hotCues[index]=null;flash('HOT CUE ' + (index+1) + ' usunięty.'); }
  else if(d.hotCues[index]===null) {d.hotCues[index]=d.audio.currentTime;flash('Zapisano HOT CUE ' + (index+1) + ' na ' + fmt(d.audio.currentTime) + '.');}
  else {seek(d,d.hotCues[index]!);flash('Przejście do HOT CUE ' + (index+1) + '.');}
  updatePads(side);drawWaveform(side);
}
async function loadSamples(files: FileList): Promise<void> {
  if (!ctx) return;
  let loaded=0;
  const batch=Array.from(files).slice(0,8);
  for(let i=0;i<batch.length;i++){
    const file=batch[i];
    if(file.size>15*1024*1024){continue;}
    try {
      sampleBuffers[i]=await ctx.decodeAudioData(await file.arrayBuffer());
      sampleNames[i]=file.name.replace(/\.[^.]+$/,'').slice(0,16).toUpperCase();
      loaded++;
    }catch{continue;}
  }
  updatePads('left'); updatePads('right');
  flash('Sampler: wczytano ' + loaded + ' / ' + batch.length + ' plików.');
}
async function command(side: Side, action: string, button: HTMLElement, ev: MouseEvent): Promise<void> {
  const d=activeDeck(side);
  switch(action){
    case 'layer': active[side]=Number(button.dataset.layer) as DeckId;renderDeck(side);flash('Przełączono na Deck ' + active[side] + '.');break;
    case 'load': ($('file-'+side) as HTMLInputElement).click();break;
    case 'samples': ($('sample-file-'+side) as HTMLInputElement).click();break;
    case 'play': await togglePlay(side);break;
    case 'cue': if(canPlay(d)){d.audio.pause();seek(d,d.cue??0);flash('CUE — Deck '+d.id);}else flash('Wczytaj utwór przed użyciem CUE.');break;
    case 'setcue': if(canPlay(d)){d.cue=d.audio.currentTime;flash('CUE ustawiony na ' + fmt(d.cue) + '.');}else flash('Wczytaj utwór przed ustawieniem CUE.');break;
    case 'loop':
      if(!canPlay(d)){flash('Wczytaj utwór przed ustawieniem pętli.');break;}
      if(d.loopStart!==null){d.loopStart=null;d.loopEnd=null;flash('Pętla wyłączona — Deck '+d.id);}
      else {d.loopStart=d.audio.currentTime;d.loopEnd=Math.min(d.audio.duration,d.loopStart+240/(d.bpm*d.audio.playbackRate));flash('Pętla 4 beat aktywna — Deck '+d.id);}
      renderDeck(side);break;
    case 'tap': {
      const t=performance.now();lastTap=lastTap.filter(x=>t-x<2300);lastTap.push(t);
      if(lastTap.length>=2){const interval=(lastTap[lastTap.length-1]-lastTap[0])/(lastTap.length-1);d.bpm=clamp(Math.round(60000/interval*10)/10,40,240);rate(d);renderDeck(side);}
      flash('TAP BPM: ' + d.bpm.toFixed(1) + ' · stuknij kilka razy równym rytmem.');break;
    }
    case 'sync':d.sync=!d.sync;rate(d);renderDeck(side);flash('SYNC Deck '+d.id+(d.sync?' włączony.':' wyłączony.'));break;
    case 'mode':padMode[side]=button.dataset.mode as PadMode;renderDeck(side);break;
    case 'pad': await usePad(side,Number(button.dataset.pad),ev.shiftKey);button.classList.add('flash');setTimeout(()=>button.classList.remove('flash'),140);break;
  }
}
function bindDeck(side: Side): void {
  const root=$('deck-'+side);
  root.addEventListener('click',ev=>{
    const target=(ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if(!target || target.dataset.act==='jog')return;
    void command(side,target.dataset.act!,target,ev as MouseEvent);
  });
  root.addEventListener('change',ev=>{
    const input=ev.target as HTMLInputElement;
    if(input.id==='file-'+side && input.files?.[0])void loadTrack(side,input.files[0]);
    if(input.id==='sample-file-'+side && input.files)void loadSamples(input.files);
    if(input.dataset.bpm!==undefined){
      const d=activeDeck(side);d.bpm=clamp(Number(input.value)||120,40,240);rate(d);refreshDeck(d.id);
      flash('BPM Deck '+d.id+' ustawione ręcznie na '+d.bpm.toFixed(1)+'.');
    }
  });
  root.addEventListener('input',ev=>{
    const input=ev.target as HTMLInputElement;
    if(input.dataset.pitch!==undefined){const d=activeDeck(side);d.pitch=Number(input.value);rate(d);refreshDeck(d.id);}
  });
  root.addEventListener('click',ev=>{
    const target=ev.target as HTMLElement;
    if(target.classList.contains('waveform')){
      const canvas=target as HTMLCanvasElement,d=activeDeck(side);
      seek(d,((ev as MouseEvent).clientX-canvas.getBoundingClientRect().left)/canvas.getBoundingClientRect().width*d.audio.duration);
    }
  });
  root.addEventListener('wheel',ev=>{
    const jog=(ev.target as HTMLElement).closest('.jog-shell');
    if(!jog)return;
    ev.preventDefault(); const d=activeDeck(side);
    seek(d,d.audio.currentTime+((ev as WheelEvent).deltaY>0?1:-1)*.6);
  },{passive:false});
  let x: number | null=null;
  root.addEventListener('pointerdown',ev=>{
    const jog=(ev.target as HTMLElement).closest<HTMLElement>('.jog-shell');
    if(!jog)return;
    x=(ev as PointerEvent).clientX;jog.setPointerCapture((ev as PointerEvent).pointerId);
  });
  root.addEventListener('pointermove',ev=>{
    if(x===null)return;
    const px=(ev as PointerEvent).clientX, d=activeDeck(side);
    if(canPlay(d))seek(d,d.audio.currentTime+(px-x)*.04);
    x=px;
  });
  root.addEventListener('pointerup',()=>{x=null;});
  root.addEventListener('pointercancel',()=>{x=null;});
  root.addEventListener('keydown',ev=>{
    if(!(ev.target as HTMLElement).closest('.jog-shell'))return;
    if(ev.key==='ArrowRight'||ev.key==='ArrowLeft'){ev.preventDefault();const d=activeDeck(side);seek(d,d.audio.currentTime+(ev.key==='ArrowRight'?1:-1));}
  });
}
function bindMixer(): void {
  $('channels').addEventListener('input',ev=>{
    const input=ev.target as HTMLInputElement;
    const index=Number(input.dataset.ch||input.dataset.channelVolume) as DeckId;
    const d=decks.get(index);
    if(!d)return;
    if(input.dataset.channelVolume!==undefined){mixer?.setChannelVolume(index, Number(input.value));return;}
    const kind=input.dataset.knob;
    const value=Number(input.value);
    if(kind==='filter'){
      mixer?.setFilter(index, value);
    }else if(kind==='low'||kind==='mid'||kind==='high'){
      mixer?.setEQ(index, kind, value);
    }
    const knob=$('knob-'+index+'-'+kind);
    knob.style.setProperty('--rot',String(kind==='filter'?value*1.25:value*10.4)+'deg');
  });
  $('crossfader').addEventListener('input',()=>{
    setCrossfade(Number(($('crossfader') as HTMLInputElement).value));
  });
  $('master').addEventListener('input',()=>{
    const value=Number(($('master') as HTMLInputElement).value);
    mixer?.setMasterVolume(value);
    $('master-level').textContent=Math.round(value*100)+'%';
  });
  $('fx-wet').addEventListener('input',()=>{
    const value=Number(($('fx-wet') as HTMLInputElement).value);
    $('fx-val').textContent=Math.round(value*100)+'%';
    mixer?.setEcho(fxEnabled, value);
  });
  $('fx-toggle').addEventListener('click',()=>{
    fxEnabled=!fxEnabled;
    const b=$('fx-toggle');
    b.classList.toggle('on',fxEnabled);
    b.textContent=fxEnabled?'FX ON':'FX OFF';
    b.setAttribute('aria-pressed',String(fxEnabled));
    mixer?.setEcho(fxEnabled, Number(($('fx-wet') as HTMLInputElement).value));
    flash('Echo FX '+(fxEnabled?'włączony.':'wyłączony.'));
  });
}
function measure(analyser: AnalyserNode): number {
  const data=new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sq=0;
  for(let i=0;i<data.length;i++){const v=(data[i]-128)/128;sq+=v*v;}
  return Math.min(1,Math.sqrt(sq/data.length)*4.5);
}
function animateMeters(): void {
  decks.forEach(d=>{
    const v=d.audio.paused?0:measure(d.nodes.analyser);
    const height=Math.max(4,Math.round(v*100));
    const l=document.getElementById('vu-'+d.id+'-l');
    const r=document.getElementById('vu-'+d.id+'-r');
    if(l)l.style.height=height+'%';
    if(r)r.style.height=Math.max(4,height-4)+'%';
  });
  if(masterAnalyser){
    const value=measure(masterAnalyser);
    const lit=Math.floor(value*12);
    document.querySelectorAll<HTMLElement>('#master-meter span').forEach((el,i)=>{
      el.classList.toggle('lit',i<lit);
      el.classList.toggle('hot',i>=9&&i<lit);
    });
  }
  playheadRaf=requestAnimationFrame(animateMeters);
}
function bindKeys(): void {
  document.addEventListener('keydown',ev=>{
    const target=ev.target as HTMLElement;
    if(target.matches('input, textarea')||ev.ctrlKey||ev.altKey||ev.metaKey)return;
    if(ev.code==='Space'){ev.preventDefault();void togglePlay('left');}
    else if(ev.key.toLowerCase()==='q'){void togglePlay('right');}
    else if(/^[1-8]$/.test(ev.key)){void usePad('left',Number(ev.key)-1,ev.shiftKey);}
  });
}
 function bindRecording(): void {
  const button = $('rec-button') as HTMLButtonElement;
  button.addEventListener('click', async () => {
    if (!mixer) { flash('Audio engine nie jest dostępny.'); return; }
    button.disabled = true;
    try {
      if (mixer.isRecording) {
        const blob = await mixer.stopRecording();
        const extension = blob.type.includes('mp4') ? 'm4a' : 'webm';
        const objectUrl = URL.createObjectURL(blob);
        const download = document.createElement('a');
        download.href = objectUrl;
        download.download = 'DJ-ZET-MIX-' + new Date().toISOString().replace(/[:.]/g, '-') + '.' + extension;
        document.body.append(download);
        download.click();
        download.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
        button.classList.remove('is-recording');
        button.setAttribute('aria-pressed', 'false');
        button.textContent = '● REC MIX';
        flash('Nagranie miksu gotowe: ' + Math.round(blob.size / 1024) + ' kB. Plik został przygotowany do pobrania.');
      } else {
        if (!(await startAudio())) return;
        mixer.startRecording();
        button.classList.add('is-recording');
        button.setAttribute('aria-pressed', 'true');
        button.textContent = '■ STOP REC';
        flash('Nagrywanie miksu jest aktywne. Ponownie kliknij STOP REC, aby zapisać.');
      }
    } catch (error) {
      flash('Nagrywanie: ' + (error instanceof Error ? error.message : 'nieznany błąd'));
    } finally {
      button.disabled = false;
    }
  });
}

function boot(): void {
  createEngine();
  renderChannels();
  renderDeck('left');
  renderDeck('right');
  bindDeck('left');bindDeck('right');bindMixer();bindKeys();bindRecording();
  $('help-button').addEventListener('click',()=>{
    const guide=$('guide');
    guide.toggleAttribute('hidden');
    $('help-button').setAttribute('aria-expanded',String(!guide.hasAttribute('hidden')));
  });
  if(ctx)playheadRaf=requestAnimationFrame(animateMeters);
}
window.addEventListener('pagehide',()=>{
  cancelAnimationFrame(playheadRaf);
  decks.forEach(d=>{d.audio.pause();if(d.url)URL.revokeObjectURL(d.url);});
  mixer?.dispose();
});
boot();