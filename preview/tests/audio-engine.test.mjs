import test from 'node:test';
import assert from 'node:assert/strict';
import { equalPower, filterParameters, finiteClamp, normalizeEQ, normalizeVolume, safeEchoWet, syncPlaybackRate } from '../src/audio/dsp.ts';
import { DJMixerEngine } from '../src/audio/mixer.ts';

test('equal-power: endpointy odcinają przeciwległy deck', () => {
  const l = equalPower(0), r = equalPower(1), c = equalPower(.5);
  assert.ok(Math.abs(l.a - 1) < 1e-12);
  assert.ok(Math.abs(l.b) < 1e-12);
  assert.ok(Math.abs(r.a) < 1e-12);
  assert.ok(Math.abs(r.b - 1) < 1e-12);
  assert.ok(Math.abs(c.a * c.a + c.b * c.b - 1) < 1e-12);
});
test('wartości poza zakresem i NaN nie wchodzą do DSP', () => {
  assert.equal(finiteClamp(NaN, 0, 1, .5), .5);
  assert.equal(normalizeVolume(999), 1);
  assert.equal(normalizeVolume(-1), 0);
  assert.equal(normalizeEQ(40), 12);
  assert.equal(safeEchoWet(1), .55);
});
test('filtry: bypass, LPF, HPF oraz częstotliwości w paśmie', () => {
  assert.equal(filterParameters(0).type, 'allpass');
  assert.equal(filterParameters(-80).type, 'lowpass');
  assert.equal(filterParameters(80).type, 'highpass');
  for (const n of [-100, -50, 0, 50, 100]) {
    const filter = filterParameters(n);
    assert.ok(filter.frequency >= 40 && filter.frequency <= 18000);
  }
});
test('SYNC clamp zapobiega zerowej prędkości', () => {
  assert.equal(syncPlaybackRate(0,120), 1);
  assert.equal(syncPlaybackRate(120,240), 2);
  assert.equal(syncPlaybackRate(120,60), .5);
  assert.equal(syncPlaybackRate(120,120), 1);
});
class FakeParam {
  value = 0; events = [];
  setTargetAtTime(v, at, tc) { this.value = v; this.events.push({ v, at, tc }); }
}
class FakeNode {
  constructor(kind, graph) {
    this.kind = kind; this.graph = graph; this.edges = [];
    this.gain = new FakeParam(); this.frequency = new FakeParam();
    this.Q = new FakeParam(); this.threshold = new FakeParam();
    this.knee = new FakeParam(); this.ratio = new FakeParam();
    this.attack = new FakeParam(); this.release = new FakeParam();
    this.delayTime = new FakeParam();
    graph.push(this);
  }
  connect(node) { this.edges.push(node); return node; }
  disconnect() { this.edges = []; }
}
class FakeContext {
  constructor() { this.currentTime = 3; this.graph = []; this.destination = new FakeNode('speaker',this.graph); }
  make(k) { return new FakeNode(k,this.graph); }
  createGain(){return this.make('gain')}
  createAnalyser(){return this.make('analyser')}
  createBiquadFilter(){return this.make('eq')}
  createMediaElementSource(){return this.make('media')}
  createMediaStreamDestination(){const n=this.make('record');n.stream={};return n}
  createDynamicsCompressor(){return this.make('compressor')}
  createDelay(){return this.make('delay')}
}
test('4 realne osobne audio graphy z routingiem A/B, master i recorder', () => {
  const ctx = new FakeContext();
  const engine = new DJMixerEngine(ctx);
  for (const id of [1,2,3,4]) engine.attachDeck(id,{});
  const a = engine.getChannel(1), b=engine.getChannel(2);
  assert.notEqual(a.volume, b.volume);
  assert.equal(a.analyser.edges[0], engine.getChannel(3).analyser.edges[0]);
  assert.equal(b.analyser.edges[0], engine.getChannel(4).analyser.edges[0]);
  assert.notEqual(a.analyser.edges[0], b.analyser.edges[0]);
  assert.ok(ctx.graph.some(n=>n.kind==='compressor'));
  assert.ok(engine.meter.edges.includes(engine.recordingOutput));
  engine.setEQ(1,'low',-6);
  assert.equal(a.low.gain.value,-6);
  engine.setChannelVolume(1,.4);
  assert.equal(a.volume.gain.value,.4);
  engine.setFilter(1,-70);
  assert.equal(a.filter.type,'lowpass');
  engine.setCrossfader(0);
  const busA=a.analyser.edges[0], busB=b.analyser.edges[0];
  assert.equal(busA.gain.value,1);
  assert.ok(busB.gain.value<1e-12);
  engine.setCrossfader(1);
  assert.ok(busA.gain.value<1e-12);
  assert.equal(busB.gain.value,1);
  engine.setEcho(true,.3);
  assert.equal(engine.echoSend.gain.value,.3);
  engine.setEcho(false,.3);
  assert.equal(engine.echoSend.gain.value,0);
  engine.dispose();
});
