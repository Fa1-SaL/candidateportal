/* global Runner */
(() => {
  // Shared by Chromium's error-page UI and its runner touch controls.
  window.HIDDEN_CLASS = "hidden";
  const status = document.getElementById("game-status");
  const jump = document.getElementById("jump");
  const jumpIcon = document.getElementById("jump-icon");
  const pause = document.getElementById("pause");
  const restart = document.getElementById("restart");
  const strings = {
    dinoGameA11yAriaLabel: "Dinosaur runner. Space or Up to jump; Down to duck.",
    dinoGameA11yDescription: "Press Space or tap Play to start.",
    dinoGameA11yGameOver: "Game over. Score $1.",
    dinoGameA11yHighScore: "High score $1.",
    dinoGameA11yJump: "Jump",
    dinoGameA11yStartGame: "Game started.",
    dinoGameA11ySpeedToggle: "Slower speed",
  };
  window.loadTimeData = {
    valueExists: key => Object.hasOwn(strings, key),
    getString: key => strings[key] ?? "",
  };
  if (typeof Runner === "undefined") {
    status.textContent = "Game unavailable.";
    return;
  }

  // Chromium's built-in audio resources are not part of this quiet embed.
  Runner.prototype.loadSounds = function () {};
  let game;
  try {
    game = new Runner(".interstitial-wrapper");
  } catch {
    status.textContent = "Game unavailable.";
    return;
  }

  function startOrJump() {
    if (!game.containerEl) return;
    game.containerEl.focus({ preventScroll: true });
    if (game.crashed) game.restart();
    else if (game.paused) game.play();
    else game.onKeyDown({ keyCode: 32, type: "keydown", target: game.containerEl, preventDefault() {} });
  }

  // Keep controls separate from the engine's document-level pointer handlers.
  document.querySelector(".controls").addEventListener("pointerdown", event => event.stopPropagation());
  document.querySelector(".controls").addEventListener("pointerup", event => event.stopPropagation());
  document.querySelector(".controls").addEventListener("keydown", event => event.stopPropagation());
  document.querySelector(".controls").addEventListener("keyup", event => event.stopPropagation());
  jump.addEventListener("click", startOrJump);
  pause.addEventListener("click", () => {
    if (game.paused) {
      game.containerEl.focus({ preventScroll: true });
      game.play();
    } else game.stop();
  });
  restart.addEventListener("click", () => {
    game.containerEl.focus({ preventScroll: true });
    // The original restart method requires a completed run and game-over panel.
    if (!game.crashed) game.gameOver();
    game.restart();
  });

  let boundCanvas = false;
  const timer = window.setInterval(() => {
    if (!game.containerEl) return;
    if (!boundCanvas) {
      game.containerEl.setAttribute("aria-label", strings.dinoGameA11yAriaLabel);
      game.canvas.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse") startOrJump();
      });
      boundCanvas = true;
    }
    const state = game.crashed ? "Game over" : game.paused ? "Paused" : game.playing ? "Running" : "Ready";
    if (status.textContent !== state) status.textContent = state;
    const label = game.crashed ? "Restart" : game.paused ? "Resume" : game.playing ? "Jump" : "Play";
    if (jump.getAttribute("aria-label") !== label) {
      jump.setAttribute("aria-label", label);
      jump.title = label;
      jumpIcon.src = label === "Jump" ? "./arrow-up.svg" : label === "Restart" ? "./rotate-ccw.svg" : "./play.svg";
    }
    jump.disabled = false;
    pause.disabled = !game.activated || game.crashed;
    pause.setAttribute("aria-pressed", String(game.paused && !game.crashed));
    pause.setAttribute("aria-label", game.paused ? "Resume game" : "Pause");
    pause.title = game.paused ? "Resume game" : "Pause";
    restart.disabled = !game.activated;
  }, 150);
  window.addEventListener("pagehide", () => window.clearInterval(timer), { once: true });
})();
