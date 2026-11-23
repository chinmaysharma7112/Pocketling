(function () {
  var FAIRIES = [
    { id: "blue", name: "Blue" },
    { id: "pink", name: "Pink" },
    { id: "green", name: "Green" },
    { id: "violet", name: "Violet" }
  ];
  var HUE = { blue: 0, pink: 105, green: 255, violet: 48 };
  var current = "blue";
  var flight = null;
  var stage = document.getElementById("fairy-stage");
  var power = document.getElementById("power");
  var state = document.getElementById("power-state");
  var picker = document.getElementById("picker");
  var sheet = document.getElementById("sheet");

  function bridge() {
    return window.PocketlingAndroid || null;
  }

  function known(id) {
    if (id === "gold") id = "violet";
    return HUE[id] == null ? "blue" : id;
  }

  function saved() {
    var native = bridge();
    if (native) {
      try { return known(native.fairy()); } catch (e) {}
    }
    try { return known(localStorage.getItem("pocketling.fairy") || "blue"); } catch (e2) {}
    return "blue";
  }

  function remember(id) {
    try { localStorage.setItem("pocketling.fairy", id); } catch (e) {}
    var native = bridge();
    if (native) {
      try { native.setFairy(id); } catch (e2) {}
    }
  }

  function paint() {
    var cards = picker.querySelectorAll("button");
    for (var i = 0; i < cards.length; i++) {
      var on = cards[i].getAttribute("data-id") === current;
      cards[i].className = on ? "on" : "";
      cards[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function show(on) {
    power.setAttribute("aria-pressed", on ? "true" : "false");
    power.className = on ? "power on" : "power";
    state.textContent = on ? "On" : "Off";
    if (bridge()) {
      stage.hidden = true;
      if (flight) flight.pause();
      return;
    }
    stage.hidden = !on;
    if (!on) {
      if (flight) flight.pause();
      return;
    }
    var canvas = document.getElementById("preview-fairy");
    if (!flight && canvas && window.PocketFairy) {
      flight = window.PocketFairy.attach(canvas, { preview: true });
    }
    if (flight) {
      flight.setLook(current);
      flight.refit();
      flight.resume();
    }
  }

  function choose(id) {
    current = known(id);
    remember(current);
    paint();
    if (flight) flight.setLook(current);
  }

  function sync() {
    var native = bridge();
    if (!native) return;
    var on = false;
    try { on = !!native.overlayOn(); } catch (e) {}
    current = saved();
    paint();
    show(on);
  }

  window.pocketlingSync = sync;

  FAIRIES.forEach(function (fairy) {
    var button = document.createElement("button");
    button.type = "button";
    button.setAttribute("data-id", fairy.id);
    var img = document.createElement("img");
    img.src = "art/fairy-wing-3.png";
    img.alt = "";
    img.draggable = false;
    img.addEventListener("load", function () {
      if (img.getAttribute("data-tinted") === "1") return;
      if (!window.PocketFairy || !window.PocketFairy.tintURL) return;
      var url = window.PocketFairy.tintURL(img, fairy.id);
      if (!url) return;
      img.setAttribute("data-tinted", "1");
      img.src = url;
    });
    var label = document.createElement("span");
    label.textContent = fairy.name;
    button.appendChild(img);
    button.appendChild(label);
    button.addEventListener("click", function () { choose(fairy.id); });
    picker.appendChild(button);
  });

  power.addEventListener("click", function () {
    var native = bridge();
    var turningOn = power.getAttribute("aria-pressed") !== "true";
    if (!native) {
      show(turningOn);
      return;
    }
    if (!turningOn) {
      try { native.stopOverlay(); } catch (e) {}
      show(false);
      return;
    }
    var answer = "off";
    try { answer = native.prepareOverlay(); } catch (e2) {}
    if (answer === "ask") {
      sheet.hidden = false;
      show(false);
      return;
    }
    show(answer === "on");
  });

  document.getElementById("sheet-go").addEventListener("click", function () {
    sheet.hidden = true;
    var native = bridge();
    if (native) {
      try { native.openOverlaySettings(); } catch (e) {}
    }
  });

  sheet.addEventListener("click", function (event) {
    if (event.target === sheet) sheet.hidden = true;
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) sync();
  });

  function look() {
    return document.documentElement.classList.contains("look-light") ? "light" : "dark";
  }

  function applyLook(next) {
    var light = next === "light";
    document.documentElement.classList.toggle("look-light", light);
    document.documentElement.classList.toggle("look-dark", !light);
    try { localStorage.setItem("pocketling.look", light ? "light" : "dark"); } catch (e) {}
    var theme = document.querySelector('meta[name="theme-color"]');
    if (theme) theme.setAttribute("content", light ? "#8ec8ef" : "#0c1830");
    var toggle = document.getElementById("look-toggle");
    toggle.setAttribute("aria-pressed", light ? "false" : "true");
    toggle.setAttribute("aria-label", light ? "Light mode" : "Dark mode");
  }

  document.getElementById("look-toggle").addEventListener("click", function () {
    applyLook(look() === "light" ? "dark" : "light");
  });
  applyLook(look());

  current = saved();
  paint();
  sync();
})();
