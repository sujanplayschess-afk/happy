/* =============================================
   CINEMATIC BIOGRAPHY — APP ENGINE
   ============================================= */

'use strict';

const App = (() => {

  // ——————————————————————————————
  // STATE
  // ——————————————————————————————
  let scenes = [];
  let music = [];
  let currentScene = -1;
  let sceneTimer = null;
  let progressInterval = null;
  let globalTime = 0;
  let globalTimerID = null;
  let audioCtx = null;
  let currentAudioSource = null;
  let currentGainNode = null;
  let nextTrackIndex = 0;
  let isPlaying = false;
  let audioBuffers = {};
  let subtitlePhase = 0;
  let subtitleTimer = null;

  // ——————————————————————————————
  // DOM
  // ——————————————————————————————
  const $ = id => document.getElementById(id);
  const introScreen = $('intro-screen');
  const playBtn = $('play-btn');
  const stage = $('stage');
  const progressBar = $('progress-bar');
  const progressWrap = $('progress-bar-wrap');
  const sceneCounter = $('scene-counter');
  const audioIndicator = $('audio-indicator');
  const endCard = $('end-card');

  // ——————————————————————————————
  // INIT
  // ——————————————————————————————
  async function init() {
    const data = await loadContent();
    scenes = data.scenes;
    music = data.music.sort((a, b) => a.startAt - b.startAt);

    buildScenes();

    playBtn.addEventListener('click', startExperience);
    $('replay-btn').addEventListener('click', replay);
  }

  async function loadContent() {
    try {
      const res = await fetch('content.json');
      return await res.json();
    } catch {
      // Fallback inline data if fetch fails (e.g. file:// protocol)
      return getFallbackData();
    }
  }

  // ——————————————————————————————
  // BUILD SCENES IN DOM
  // ——————————————————————————————
  function buildScenes() {
    stage.innerHTML = '';
    scenes.forEach((s, i) => {
      const div = document.createElement('div');
      div.className = 'scene';
      div.id = `scene-${i}`;

      const kenClass = {
        'zoom-in': 'ken-zoom-in',
        'zoom-out': 'ken-zoom-out',
        'pan-right': 'ken-pan-right',
        'pan-left': 'ken-pan-left'
      }[s.kenBurns] || 'ken-zoom-in';

      div.innerHTML = `
        <div class="scene-bg ${kenClass}" style="background-image:url('${s.image}')"></div>
        <div class="scene-overlay"></div>
        <div class="scene-overlay-color" style="background:${s.overlay}"></div>
        <div class="chapter-label">${s.title}</div>
        <div class="subtitle-wrap" id="subtitle-${i}">
          ${s.lines.map((line, j) => `<span class="subtitle-line" data-line="${j}">${line}</span>`).join('')}
        </div>
      `;
      stage.appendChild(div);
    });
  }

  // ——————————————————————————————
  // START EXPERIENCE
  // ——————————————————————————————
  function startExperience() {
    introScreen.classList.add('fade-out');
    progressWrap.classList.add('visible');
    sceneCounter.classList.add('visible');
    isPlaying = true;

    // Tick global timer
    globalTime = 0;
    globalTimerID = setInterval(() => {
      globalTime += 0.2;
      checkMusicSchedule();
    }, 200);

    // Start with scene 0 after intro fade
    setTimeout(() => {
      goToScene(0);
      initAudioContext();
    }, 1400);
  }

  // ——————————————————————————————
  // SCENE NAVIGATION
  // ——————————————————————————————
  function goToScene(index) {
    if (index >= scenes.length) {
      showEndCard();
      return;
    }

    // Deactivate previous
    if (currentScene >= 0) {
      const prev = $(`scene-${currentScene}`);
      if (prev) {
        hideSubtitles(currentScene);
        setTimeout(() => prev.classList.remove('active'), 1600);
      }
    }

    currentScene = index;
    const scene = scenes[index];
    const el = $(`scene-${index}`);

    // Reset Ken Burns by cloning bg
    const oldBg = el.querySelector('.scene-bg');
    const newBg = oldBg.cloneNode(true);
    oldBg.parentNode.replaceChild(newBg, oldBg);

    el.classList.add('active');
    updateCounter();

    // Animate progress bar
    animateProgress(scene.duration);

    // Show subtitles
    clearTimeout(subtitleTimer);
    subtitlePhase = 0;
    scheduleSubtitles(index);

    // Schedule next scene
    clearTimeout(sceneTimer);
    sceneTimer = setTimeout(() => {
      goToScene(currentScene + 1);
    }, scene.duration * 1000);
  }

  // ——————————————————————————————
  // SUBTITLES
  // ——————————————————————————————
  function scheduleSubtitles(sceneIdx) {
    const lines = document.querySelectorAll(`#subtitle-${sceneIdx} .subtitle-line`);
    const scene = scenes[sceneIdx];
    const totalDuration = scene.duration * 1000;
    const perLine = Math.floor(totalDuration / (lines.length + 1));

    lines.forEach((line, i) => {
      // Appear staggered
      setTimeout(() => {
        line.classList.add('visible');
      }, perLine * (i + 0.6));

      // Fade out before scene ends
      setTimeout(() => {
        line.classList.add('out');
      }, totalDuration - 1800 + i * 100);
    });
  }

  function hideSubtitles(sceneIdx) {
    const lines = document.querySelectorAll(`#subtitle-${sceneIdx} .subtitle-line`);
    lines.forEach(line => {
      line.classList.remove('visible');
      line.classList.add('out');
    });
  }

  // ——————————————————————————————
  // PROGRESS BAR
  // ——————————————————————————————
  function animateProgress(durationSeconds) {
    clearInterval(progressInterval);
    progressBar.style.transition = 'none';
    progressBar.style.width = '0%';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        progressBar.style.transition = `width ${durationSeconds}s linear`;
        progressBar.style.width = '100%';
      });
    });
  }

  // ——————————————————————————————
  // COUNTER
  // ——————————————————————————————
  function updateCounter() {
    sceneCounter.textContent = `${String(currentScene + 1).padStart(2, '0')} / ${String(scenes.length).padStart(2, '0')}`;
  }

  // ——————————————————————————————
  // AUDIO ENGINE
  // ——————————————————————————————
  function initAudioContext() {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioIndicator.classList.add('visible');
      preloadTracks();
    } catch (e) {
      console.warn('Audio context unavailable:', e);
    }
  }

  async function preloadTracks() {
    // Try to preload first track
    if (music.length > 0) {
      await loadAndPlay(music[0], true);
    }
  }

  async function loadAndPlay(track, isFirst = false) {
    if (!audioCtx || !track.url) return;

    try {
      let buffer = audioBuffers[track.id];
      if (!buffer) {
        const res = await fetch(track.url);
        if (!res.ok) throw new Error('fetch failed');
        const ab = await res.arrayBuffer();
        buffer = await audioCtx.decodeAudioData(ab);
        audioBuffers[track.id] = buffer;
      }
      playBuffer(buffer, track.volume || 0.6, isFirst ? 2 : 0);
    } catch (e) {
      // Audio unavailable — graceful fallback, no crash
    }
  }

  function playBuffer(buffer, targetVol, fadeInTime) {
    // Fade out current
    if (currentGainNode) {
      const g = currentGainNode;
      g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1.5);
      setTimeout(() => {
        try { currentAudioSource.stop(); } catch {}
      }, 1600);
    }

    const source = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    gain.connect(audioCtx.destination);
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(targetVol, audioCtx.currentTime + (fadeInTime || 1.5));
    source.start();

    currentAudioSource = source;
    currentGainNode = gain;
  }

  function checkMusicSchedule() {
    if (!audioCtx || music.length === 0) return;
    if (nextTrackIndex >= music.length) return;

    const track = music[nextTrackIndex];
    if (globalTime >= track.startAt) {
      nextTrackIndex++;
      loadAndPlay(track);
    }
  }

  // ——————————————————————————————
  // END CARD
  // ——————————————————————————————
  function showEndCard() {
    clearInterval(globalTimerID);
    progressBar.style.width = '100%';

    // Fade audio out
    if (currentGainNode) {
      currentGainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 4);
    }

    setTimeout(() => {
      endCard.classList.add('visible');
    }, 1800);
  }

  // ——————————————————————————————
  // REPLAY
  // ——————————————————————————————
  function replay() {
    endCard.classList.remove('visible');
    currentScene = -1;
    nextTrackIndex = 0;
    globalTime = 0;
    isPlaying = false;

    // Reset all scenes
    document.querySelectorAll('.scene').forEach(s => {
      s.classList.remove('active');
      s.querySelectorAll('.subtitle-line').forEach(l => {
        l.classList.remove('visible', 'out');
      });
    });

    audioBuffers = {};
    currentAudioSource = null;
    currentGainNode = null;

    setTimeout(() => {
      goToScene(0);
      initAudioContext();
    }, 600);

    isPlaying = true;
    globalTimerID = setInterval(() => {
      globalTime += 0.2;
      checkMusicSchedule();
    }, 200);
  }

  // ——————————————————————————————
  // FALLBACK DATA
  // ——————————————————————————————
  function getFallbackData() {
    return {
      scenes: [
        { id: 1, title: "Childhood", lines: ["Before anyone noticed…", "she was already becoming someone unforgettable."], image: "https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?w=1920&q=80", duration: 12, overlay: "rgba(10,5,0,0.45)", kenBurns: "zoom-in" },
        { id: 2, title: "Growing Up", lines: ["Somewhere between then and now,", "she stopped being a child — quietly."], image: "https://images.unsplash.com/photo-1504203700686-f21e703e5f1c?w=1920&q=80", duration: 12, overlay: "rgba(5,10,20,0.5)", kenBurns: "zoom-out" },
        { id: 3, title: "Personality", lines: ["She doesn't ask for attention.", "She just walks in — and the room shifts."], image: "https://images.unsplash.com/photo-1529333166437-7750a6dd5a70?w=1920&q=80", duration: 12, overlay: "rgba(0,10,15,0.5)", kenBurns: "pan-right" },
        { id: 4, title: "Shared Memories", lines: ["Some moments don't need photographs.", "They live in the pause between words."], image: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&q=80", duration: 15, overlay: "rgba(5,5,15,0.55)", kenBurns: "pan-left" },
        { id: 5, title: "Distance", lines: ["Things change.", "And yet, some people stay — in their own quiet way."], image: "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1920&q=80", duration: 15, overlay: "rgba(0,0,5,0.6)", kenBurns: "zoom-in" },
        { id: 6, title: "Present", lines: ["Today, on your birthday —", "this is for you. Just you."], image: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920&q=80", duration: 15, overlay: "rgba(5,0,10,0.5)", kenBurns: "zoom-out" }
      ],
      music: []
    };
  }

  // ——————————————————————————————
  // KEYBOARD SUPPORT
  // ——————————————————————————————
  document.addEventListener('keydown', e => {
    if (!isPlaying) return;
    if (e.key === 'ArrowRight' || e.key === ' ') {
      clearTimeout(sceneTimer);
      goToScene(currentScene + 1);
    }
  });

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
