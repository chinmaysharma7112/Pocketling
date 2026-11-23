(function (root) {
  var WING = ["art/fairy-wing-1.png", "art/fairy-wing-2.png", "art/fairy-wing-3.png"];
  // Opaque-pixel center of each drawing, so a wing change does not shove her body.
  var ANCHOR = [
    { x: 0.521, y: 0.506 },
    { x: 0.524, y: 0.473 },
    { x: 0.498, y: 0.458 }
  ];
  var HUE = { blue: 0, pink: 105, green: 255, violet: 48 };
  var images = [];

  // One place for flight feel. Speeds are CSS px/s at scale 1 (a 360 dp-wide phone).
  // Wing art is three stills, so the beat stays slow enough for 30 fps to crossfade.
  // bodyStyle "upright" matches the standing front-facing fairy. "side" noses along the path.
  var FLIGHT = {
    cruiseSpeed: 84,
    turnRate: 1.7,
    flapHzFly: 1.7,
    flapHzHover: 0.9,
    speedPulse: 0.08,
    liftPulsePx: 2.2,
    diveBoost: 0.15,
    maxPitchDown: 40,
    maxPitchUp: 35,
    maxPitchVertical: 50,
    pitchSmoothing: 5,
    swayAmount: 14,
    swayHz: 0.7,
    flipThreshold: 18,
    flipMs: 180,
    leanDeg: 16,
    bankDeg: 8,
    arrivalRadius: 74,
    bodyStyle: "upright"
  };

  WING.forEach(function (src, index) {
    var img = new Image();
    img.src = src;
    images[index] = img;
  });

  var tintCache = {};

  function hsvToRgb(h, s, v) {
    var i = Math.floor(h * 6);
    var f = h * 6 - i;
    var p = v * (1 - s);
    var q = v * (1 - f * s);
    var t = v * (1 - (1 - f) * s);
    var r = v;
    var g = t;
    var b = p;
    switch (i % 6) {
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
      default: break;
    }
    return [r * 255, g * 255, b * 255];
  }

  function hsvOf(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    var max = r > g ? (r > b ? r : b) : (g > b ? g : b);
    var min = r < g ? (r < b ? r : b) : (g < b ? g : b);
    var d = max - min;
    var h = 0;
    if (d > 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, max === 0 ? 0 : d / max, max];
  }

  function paintSkin(p, i, v) {
    var tone = Math.pow(Math.max(0, Math.min(1, v)), 0.85);
    var shadow = [214, 156, 142];
    var base = [245, 214, 198];
    var light = [255, 238, 228];
    var from = tone < 0.5 ? shadow : base;
    var to = tone < 0.5 ? base : light;
    var u = tone < 0.5 ? tone / 0.5 : (tone - 0.5) / 0.5;
    p[i] = from[0] + (to[0] - from[0]) * u;
    p[i + 1] = from[1] + (to[1] - from[1]) * u;
    p[i + 2] = from[2] + (to[2] - from[2]) * u;
  }

  function lineMask(p, w, h) {
    var line = new Uint8Array(w * h);
    var vals = new Float32Array(w * h);
    var i, x, y, o, samples, n, s, k, nx, ny, mid, v;
    var step = [5, 0, -5, 0, 0, 5, 0, -5, 4, 4, -4, 4, 4, -4, -4, -4];
    for (i = 0, o = 0; i < w * h; i++, o += 4) {
      vals[i] = p[o + 3] < 40 ? -1 : Math.max(p[o], p[o + 1], p[o + 2]) / 255;
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        v = vals[i];
        if (v < 0) continue;
        o = i * 4;
        s = hsvOf(p[o], p[o + 1], p[o + 2])[1];
        if (s >= 0.42) continue;
        samples = [];
        for (k = 0; k < step.length; k += 2) {
          nx = x + step[k];
          ny = y + step[k + 1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (vals[ny * w + nx] >= 0) samples.push(vals[ny * w + nx]);
        }
        if (samples.length < 3) {
          if (v < 0.58) line[i] = 1;
          continue;
        }
        samples.sort(function (a, b) { return a - b; });
        mid = samples[samples.length >> 1];
        if (v < 0.5 || v < mid - 0.04) line[i] = 1;
      }
    }
    return line;
  }

  function bodyMask(p, w, h) {
    var seen = new Uint8Array(w * h);
    var mask = new Uint8Array(w * h);
    var queue = new Int32Array(w * h);
    var pts = new Int32Array(w * h);
    var y, x, i, pix, head, tail, n, k, cx, cy, nx, ny, j, t;
    function skinAt(o) {
      if (p[o + 3] < 80) return false;
      var hsv = hsvOf(p[o], p[o + 1], p[o + 2]);
      return (hsv[0] < 48 || hsv[0] > 250) && hsv[1] > 0.04 && hsv[1] < 0.45 && hsv[2] > 0.45;
    }
    function barrierAt(o) {
      if (p[o + 3] < 40) return true;
      return hsvOf(p[o], p[o + 1], p[o + 2])[2] < 0.42;
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        if (seen[i]) continue;
        pix = i * 4;
        if (!skinAt(pix)) { seen[i] = 1; continue; }
        head = 0;
        tail = 0;
        n = 0;
        queue[tail++] = i;
        seen[i] = 1;
        while (head < tail) {
          k = queue[head++];
          pts[n++] = k;
          cy = (k / w) | 0;
          cx = k - cy * w;
          if (cx > 0) {
            j = k - 1;
            if (!seen[j]) {
              seen[j] = 1;
              if (!barrierAt(j * 4) && skinAt(j * 4)) queue[tail++] = j;
            }
          }
          if (cx + 1 < w) {
            j = k + 1;
            if (!seen[j]) {
              seen[j] = 1;
              if (!barrierAt(j * 4) && skinAt(j * 4)) queue[tail++] = j;
            }
          }
          if (cy > 0) {
            j = k - w;
            if (!seen[j]) {
              seen[j] = 1;
              if (!barrierAt(j * 4) && skinAt(j * 4)) queue[tail++] = j;
            }
          }
          if (cy + 1 < h) {
            j = k + w;
            if (!seen[j]) {
              seen[j] = 1;
              if (!barrierAt(j * 4) && skinAt(j * 4)) queue[tail++] = j;
            }
          }
        }
        if (n > 700) {
          for (t = 0; t < n; t++) mask[pts[t]] = 1;
        }
      }
    }
    return mask;
  }

  function renderDress(img, deg) {
    var w = img.naturalWidth;
    var h = img.naturalHeight;
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    var image = g.getImageData(0, 0, w, h);
    var p = image.data;
    var body = bodyMask(p, w, h);
    var lines = lineMask(p, w, h);
    var a = deg * Math.PI / 180;
    var co = Math.cos(a);
    var si = Math.sin(a);
    var m0 = 0.213 + co * 0.787 - si * 0.213;
    var m1 = 0.715 - co * 0.715 - si * 0.715;
    var m2 = 0.072 - co * 0.072 + si * 0.928;
    var m3 = 0.213 - co * 0.213 + si * 0.143;
    var m4 = 0.715 + co * 0.285 + si * 0.140;
    var m5 = 0.072 - co * 0.072 - si * 0.283;
    var m6 = 0.213 - co * 0.213 - si * 0.787;
    var m7 = 0.715 - co * 0.715 + si * 0.715;
    var m8 = 0.072 + co * 0.928 + si * 0.072;
    var i, x, y, r, gg, b, hsv, H, s, v, skin;
    for (y = 0, i = 0; y < h; y++) {
      for (x = 0; x < w; x++, i += 4) {
        if (p[i + 3] < 30) continue;
        r = p[i];
        gg = p[i + 1];
        b = p[i + 2];
        hsv = hsvOf(r, gg, b);
        H = hsv[0];
        s = hsv[1];
        v = hsv[2];
        if (lines[y * w + x]) continue;
        if (body[y * w + x]) {
          paintSkin(p, i, v);
          continue;
        }
        skin = (H < 48 || H > 268) && s >= 0.05 && v >= 0.5;
        if (deg && ((H >= 165 && H <= 270 && s >= 0.05) || skin)) {
          var rr = m0 * r + m1 * gg + m2 * b;
          var rg = m3 * r + m4 * gg + m5 * b;
          var rb = m6 * r + m7 * gg + m8 * b;
          if (s < 0.45 && v > 0.55) {
            var shifted = hsvOf(rr, rg, rb);
            var rgb = hsvToRgb(shifted[0] / 360, Math.max(shifted[1], 0.42), Math.min(shifted[2], 0.9));
            rr = rgb[0];
            rg = rgb[1];
            rb = rgb[2];
          }
          p[i] = Math.max(0, Math.min(255, rr));
          p[i + 1] = Math.max(0, Math.min(255, rg));
          p[i + 2] = Math.max(0, Math.min(255, rb));
        }
      }
    }
    g.putImageData(image, 0, 0);
    return c.toDataURL("image/png");
  }

  function tintURL(img, id) {
    if (!HUE[id] || !ready(img)) return "";
    var key = id + "@lines@" + (img.src || "");
    if (tintCache[key]) return tintCache[key];
    tintCache[key] = renderDress(img, HUE[id] || 0);
    return tintCache[key];
  }

  function ready(img) {
    return img && img.complete && img.naturalWidth;
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function wrap(a) {
    var pi = Math.PI;
    while (a > pi) a -= pi * 2;
    while (a < -pi) a += pi * 2;
    return a;
  }

  function deg(n) {
    return n * Math.PI / 180;
  }

  function approach(current, target, rate, dt) {
    return current + (target - current) * Math.min(1, rate * dt);
  }

  function attach(canvas, options) {
    var preview = !!(options && options.preview);
    var ctx = canvas.getContext("2d");
    var parent = canvas.parentNode;
    var running = false;
    var rafId = 0;
    var timer = 0;
    var last = 0;
    var pausedAt = 0;
    var GLOW = {
      blue: [168, 214, 255],
      pink: [255, 176, 214],
      green: [166, 228, 184],
      violet: [204, 176, 255]
    };
    var motes = [];
    var moteCursor = 0;
    var lastMote = 0;
    var i;
    for (i = 0; i < 12; i++) motes.push({ on: false, x: 0, y: 0, life: 0, max: 1, size: 2, soft: false });

    var flyer = {
      x: -1,
      y: -1,
      heading: 0,
      speed: 0,
      flapPhase: 0,
      pitch: 0,
      facing: 1,
      faceScale: 1,
      flip: null,
      tx: 0,
      ty: 0,
      mode: "wander",
      until: 0,
      turn: 0,
      descend: 0,
      bodyScale: 1,
      lean: 0,
      bank: 0,
      drawX: -1,
      drawY: -1,
      edging: false
    };

    if (parent && root.getComputedStyle(parent).position === "static") parent.style.position = "relative";

    var rig = document.createElement("div");
    var outer = document.createElement("div");
    var inner = document.createElement("div");
    var frames = [];
    rig.style.cssText = "position:absolute;inset:0;overflow:visible;pointer-events:none;z-index:2;";
    outer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;opacity:1;";
    inner.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;";
    for (i = 0; i < WING.length; i++) {
      var el = document.createElement("img");
      el.src = WING[i];
      el.alt = "";
      el.draggable = false;
      el.style.cssText = "position:absolute;left:0;top:0;height:68px;width:auto;opacity:0;visibility:hidden;pointer-events:none;";
      frames.push(el);
      inner.appendChild(el);
    }
    outer.appendChild(inner);
    rig.appendChild(outer);
    if (parent) parent.appendChild(rig);

    var look = "blue";
    function knownLook(id) {
      if (id === "gold") id = "violet";
      return HUE[id] == null ? "blue" : id;
    }
    function readLook() {
      try {
        if (!preview && root.PocketlingOverlay && root.PocketlingOverlay.fairy) {
          return knownLook(root.PocketlingOverlay.fairy());
        }
      } catch (e) {}
      try {
        return knownLook(root.localStorage.getItem("pocketling.fairy") || "blue");
      } catch (e2) {}
      return "blue";
    }
    function paintLook() {
      outer.style.filter = "none";
      var token = look;
      for (var n = 0; n < frames.length; n++) {
        (function (n) {
          function apply() {
            if (look !== token) return;
            if (!HUE[token]) {
              frames[n].src = WING[n];
              return;
            }
            var url = tintURL(images[n], token);
            if (url) frames[n].src = url;
          }
          if (ready(images[n])) apply();
          else images[n].addEventListener("load", apply);
        })(n);
      }
    }
    function setLook(id) {
      look = knownLook(id);
      paintLook();
    }
    look = readLook();
    paintLook();

    function metrics() {
      var w = canvas.clientWidth || 360;
      var h = canvas.clientHeight || 640;
      if (preview) {
        return {
          widthDp: 360,
          heightDp: h > 0 ? 360 * (h / w) : 800,
          density: 1,
          insetTop: 28,
          insetBottom: 18,
          insetLeft: 0,
          insetRight: 0
        };
      }
      var box = {
        widthDp: root.innerWidth || w,
        heightDp: root.innerHeight || h,
        density: 1,
        insetTop: 0,
        insetBottom: 0,
        insetLeft: 0,
        insetRight: 0
      };
      try {
        if (root.PocketlingOverlay && root.PocketlingOverlay.metrics) {
          var raw = JSON.parse(root.PocketlingOverlay.metrics());
          if (raw && typeof raw.widthDp === "number") return raw;
        }
      } catch (e) {}
      return box;
    }

    function fit() {
      var dpr = Math.min(root.devicePixelRatio || 1, 2);
      var w = canvas.clientWidth || (preview ? 0 : root.innerWidth) || 0;
      var h = canvas.clientHeight || (preview ? 0 : root.innerHeight) || 0;
      if (w < 2 || h < 2) return false;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    }

    function area(m, w, h, sprite) {
      var sx = m.widthDp ? w / m.widthDp : 1;
      var top = (m.insetTop || 0) * sx + 18 * sx;
      var bottom = h - (m.insetBottom || 0) * sx - 22 * sx;
      var left = (m.insetLeft || 0) * sx + sprite * 0.55;
      var right = w - (m.insetRight || 0) * sx - sprite * 0.55;
      top += sprite * 0.35;
      bottom -= sprite * 0.45;
      if (bottom < top + sprite) bottom = top + sprite;
      if (right < left + sprite) right = left + sprite;
      return { left: left, top: top, right: right, bottom: bottom };
    }

    function pickTarget(box) {
      var spanX = Math.max(1, box.right - box.left);
      var spanY = Math.max(1, box.bottom - box.top);
      var tx = box.left + Math.random() * spanX;
      var ty = box.top + Math.random() * spanY;
      if (Math.hypot(tx - flyer.x, ty - flyer.y) < Math.min(spanX, spanY) * 0.28) {
        tx = tx < (box.left + box.right) / 2 ? box.right - spanX * 0.2 : box.left + spanX * 0.2;
      }
      flyer.tx = tx;
      flyer.ty = ty;
      flyer.mode = "wander";
    }

    function noise(now, dist, arrival) {
      var fade = clamp(dist / (arrival * 3), 0, 1);
      var n = Math.sin(now * 0.41) * 0.1 + Math.sin(now * 0.73 + 1.4) * 0.06 + Math.sin(now * 0.23 + 2.2) * 0.04;
      return n * fade;
    }

    function steer(dt, box, now, scale) {
      if (flyer.x < 0) {
        flyer.x = (box.left + box.right) / 2;
        flyer.y = (box.top + box.bottom) / 2;
        flyer.speed = FLIGHT.cruiseSpeed * scale * 0.6;
        pickTarget(box);
      }
      if (flyer.tx < box.left || flyer.tx > box.right || flyer.ty < box.top || flyer.ty > box.bottom) pickTarget(box);

      var dx = flyer.tx - flyer.x;
      var dy = flyer.ty - flyer.y;
      var dist = Math.hypot(dx, dy) || 1;
      var arrival = FLIGHT.arrivalRadius * scale;
      var cruise = FLIGHT.cruiseSpeed * scale * (0.9 + 0.07 * Math.sin(now * 0.53) + 0.04 * Math.sin(now * 0.91 + 2));
      var climbNow = clamp(-Math.sin(flyer.heading), 0, 1);
      var diveNow = clamp(Math.sin(flyer.heading), 0, 1);
      var hz = flyer.mode === "hover" ? FLIGHT.flapHzHover : FLIGHT.flapHzFly;
      if (climbNow > 0.25) hz *= 1 + climbNow * 0.55;
      else if (diveNow > 0.35) hz *= 0.7;
      flyer.flapPhase += hz * dt;
      var wing = Math.sin(flyer.flapPhase * Math.PI * 2);
      var push = wing > 0 ? wing * wing : 0;

      if (flyer.mode === "hover") {
        flyer.heading = wrap(flyer.heading + noise(now, arrival, arrival) * dt);
        flyer.turn = approach(flyer.turn, 0, 6, dt);
        flyer.speed += (cruise * 0.4 * push - flyer.speed * 3.4) * dt;
        if (now > flyer.until) pickTarget(box);
      } else {
        var desired = Math.atan2(dy, dx) + noise(now, dist, arrival);
        var diff = wrap(desired - flyer.heading);
        var sp = cruise > 1 ? flyer.speed / cruise : 0;
        var rate = FLIGHT.turnRate * (1.05 - 0.42 * clamp(sp, 0, 1.35));
        var step = clamp(diff, -rate * dt, rate * dt);
        flyer.heading = wrap(flyer.heading + step);
        flyer.turn = dt > 0 ? step / dt : 0;

        var down = clamp(Math.sin(flyer.heading), 0, 1);
        var up = clamp(-Math.sin(flyer.heading), 0, 1);
        var flare = dist < arrival ? 1 - dist / arrival : 0;
        var thrust = cruise * 4.6 * push * (1 - flare);
        thrust *= 1 + 0.35 * up - 0.45 * down;
        flyer.speed += (thrust - flyer.speed * 1.45) * dt;
        if (down > 0) flyer.speed += cruise * 0.5 * down * (1 - push) * dt;
        flyer.speed = clamp(flyer.speed, 0, cruise * 1.2);
        if (dist < arrival * 0.42) {
          flyer.mode = "hover";
          flyer.until = now + 0.85 + Math.random() * 1.5;
        }
      }

      flyer.x += Math.cos(flyer.heading) * Math.max(0, flyer.speed) * dt;
      flyer.y += Math.sin(flyer.heading) * Math.max(0, flyer.speed) * dt;

      var pinned = flyer.x < box.left || flyer.x > box.right || flyer.y < box.top || flyer.y > box.bottom;
      if (pinned) {
        flyer.x = clamp(flyer.x, box.left, box.right);
        flyer.y = clamp(flyer.y, box.top, box.bottom);
        var inward = Math.atan2((box.top + box.bottom) / 2 - flyer.y, (box.left + box.right) / 2 - flyer.x);
        var turnIn = clamp(wrap(inward - flyer.heading), -FLIGHT.turnRate * dt, FLIGHT.turnRate * dt);
        flyer.heading = wrap(flyer.heading + turnIn);
        if (!flyer.edging) pickTarget(box);
        flyer.edging = true;
      } else {
        flyer.edging = false;
      }
    }

    function pose(dt, scale, now) {
      var vx = Math.cos(flyer.heading) * flyer.speed;
      var vy = Math.sin(flyer.heading) * flyer.speed;
      var slope = Math.atan2(vy, Math.abs(vx));
      var vertical = Math.abs(vx) < Math.abs(vy) * 0.18;
      var maxDown = deg(vertical ? FLIGHT.maxPitchVertical : FLIGHT.maxPitchDown);
      var maxUp = deg(vertical ? FLIGHT.maxPitchVertical : FLIGHT.maxPitchUp);
      var targetPitch = clamp(slope, -maxUp, maxDown);
      var arrival = FLIGHT.arrivalRadius * scale;
      var dist = Math.hypot(flyer.tx - flyer.x, flyer.ty - flyer.y);
      var flare = flyer.mode === "wander" && dist < arrival ? 1 - dist / arrival : 0;
      if (flare > 0) targetPitch = targetPitch * (1 - flare) - deg(FLIGHT.maxPitchUp) * flare;
      flyer.pitch = approach(flyer.pitch, targetPitch, FLIGHT.pitchSmoothing, dt);

      var cruise = Math.max(1, FLIGHT.cruiseSpeed * scale);
      var dive = clamp(vy / cruise, 0, 1);
      var climb = clamp(-vy / cruise, 0, 1);
      if (dive > 0.45 && flyer.mode === "wander") flyer.descend = Math.min(1.2, flyer.descend + dt);
      else flyer.descend = Math.max(0, flyer.descend - dt * 1.4);

      var thresh = FLIGHT.flipThreshold * scale;
      var next = flyer.facing;
      if (vx > thresh) next = 1;
      else if (vx < -thresh) next = -1;
      if (next !== flyer.facing) {
        flyer.flip = { from: flyer.faceScale, to: next, start: now };
        flyer.facing = next;
      }
      if (flyer.flip) {
        var t = (now - flyer.flip.start) / (FLIGHT.flipMs / 1000);
        var from = flyer.flip.from;
        var to = flyer.flip.to;
        if (t >= 1) {
          flyer.faceScale = to;
          flyer.flip = null;
        } else {
          var s = t * t * (3 - 2 * t);
          var mid = 0.55;
          if (s < 0.5) {
            var u = s / 0.5;
            var squash = mid * (from < 0 ? -1 : 1);
            flyer.faceScale = from + (squash - from) * u;
          } else {
            var v = (s - 0.5) / 0.5;
            var open = mid * (to < 0 ? -1 : 1);
            flyer.faceScale = open + (to - open) * v;
          }
        }
      } else {
        flyer.faceScale = flyer.facing;
      }

      var bankTarget = clamp(flyer.turn / Math.max(0.4, FLIGHT.turnRate), -1, 1) * deg(FLIGHT.bankDeg);
      flyer.bank = approach(flyer.bank, bankTarget, 4, dt);
      var bank = flyer.bank;
      var upright = FLIGHT.bodyStyle !== "side";
      var targetLean = upright ? clamp(vx / cruise, -1, 1) * deg(FLIGHT.leanDeg) : 0;
      flyer.lean = approach(flyer.lean, targetLean, FLIGHT.pitchSmoothing, dt);
      var targetScale = 1 + 0.06 * dive - 0.04 * climb;
      if (flare > 0) targetScale = targetScale * (1 - flare) + 0.96 * flare;
      flyer.bodyScale = approach(flyer.bodyScale, upright ? targetScale : 1, FLIGHT.pitchSmoothing, dt);

      var swayBlend = clamp((flyer.descend - 0.45) / 0.7, 0, 1);
      var sway = Math.sin(now * Math.PI * 2 * FLIGHT.swayHz) * FLIGHT.swayAmount * scale * swayBlend;
      var downstroke = Math.sin(flyer.flapPhase * Math.PI * 2);
      var lift = (downstroke > 0 ? downstroke * downstroke : 0) * FLIGHT.liftPulsePx * scale;
      var aimX = flyer.x + sway;
      var aimY = flyer.y - lift;
      if (flyer.drawX < 0) {
        flyer.drawX = aimX;
        flyer.drawY = aimY;
      } else {
        flyer.drawX = approach(flyer.drawX, aimX, 20, dt);
        flyer.drawY = approach(flyer.drawY, aimY, 20, dt);
      }
      return { vx: vx, vy: vy, climb: climb, bank: bank, flare: flare };
    }

    var lookSprites = {};
    function spriteImage(index) {
      var base = images[index];
      if (!base || !base.naturalWidth) return null;
      if (look === "blue" || !HUE[look]) return base;
      var key = look + "#" + index;
      var cached = lookSprites[key];
      if (cached) return cached.naturalWidth ? cached : null;
      var url = tintURL(base, look);
      if (!url) return base;
      var im = new Image();
      im.src = url;
      lookSprites[key] = im;
      return null;
    }

    function place(sprite, motion) {
      var localBank = motion.bank * (flyer.facing < 0 ? -1 : 1);
      var rot;
      if (FLIGHT.bodyStyle === "side") rot = flyer.pitch + localBank;
      else rot = flyer.lean * (flyer.facing < 0 ? -1 : 1) + localBank;

      var beat = [0, 1, 2, 1];
      var step = Math.floor((flyer.flapPhase % 1) * beat.length);
      if (step < 0) step = 0;
      var poseFrame = beat[step % beat.length];
      var img = spriteImage(poseFrame);
      if (!img) return;
      var height = Math.max(1, Math.round(sprite));
      var aspect = img.naturalWidth / img.naturalHeight;
      var width = Math.max(1, Math.round(height * aspect));
      var anchor = ANCHOR[poseFrame];
      var dpr = Math.min(root.devicePixelRatio || 1, 2);
      function snap(v) { return Math.round(v * dpr) / dpr; }
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.globalAlpha = 1;
      ctx.translate(snap(flyer.drawX), snap(flyer.drawY));
      ctx.scale(flyer.faceScale, 1);
      ctx.rotate(rot);
      ctx.drawImage(
        img,
        Math.round(-width * anchor.x),
        Math.round(-height * anchor.y),
        width,
        height
      );
      ctx.restore();
    }

    function wash(rgb, x, y, rad, alpha) {
      var color = rgb[0] + "," + rgb[1] + "," + rgb[2];
      var glow = ctx.createRadialGradient(x, y, rad * 0.08, x, y, rad);
      glow.addColorStop(0, "rgba(" + color + "," + alpha.toFixed(3) + ")");
      glow.addColorStop(0.45, "rgba(" + color + "," + (alpha * 0.35).toFixed(3) + ")");
      glow.addColorStop(1, "rgba(" + color + ",0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawShine(sprite, scale, dt, nowMs) {
      var rgb = GLOW[look] || GLOW.blue;
      var core = [
        Math.round(rgb[0] + (255 - rgb[0]) * 0.7),
        Math.round(rgb[1] + (255 - rgb[1]) * 0.7),
        Math.round(rgb[2] + (255 - rgb[2]) * 0.7)
      ];
      var speed = flyer.speed || 0;
      var moving = speed > 18 * Math.max(0.7, scale);
      if (flyer.drawX >= 0 && nowMs - lastMote > (moving ? 46 : 160)) {
        var mote = motes[moteCursor];
        moteCursor = (moteCursor + 1) % motes.length;
        var back = flyer.heading + Math.PI;
        var scatter = (Math.random() - 0.5) * sprite * 0.1;
        mote.on = true;
        mote.x = flyer.drawX + Math.cos(back) * sprite * 0.05 + Math.cos(back + 1.57) * scatter;
        mote.y = flyer.drawY + Math.sin(back) * sprite * 0.05 + Math.sin(back + 1.57) * scatter;
        mote.life = moving ? 0.42 + Math.random() * 0.22 : 0.28 + Math.random() * 0.12;
        mote.max = mote.life;
        mote.size = (moving ? 1.8 + Math.random() * 2.6 : 1.4 + Math.random() * 1.4) * Math.max(0.75, scale);
        mote.soft = Math.random() < 0.55;
        lastMote = nowMs;
      }
      if (flyer.drawX >= 0) {
        wash(rgb, flyer.drawX, flyer.drawY - sprite * 0.04, sprite * 0.2, 0.22);
        wash(core, flyer.drawX, flyer.drawY - sprite * 0.04, sprite * 0.08, 0.4);
      }
      for (var n = 0; n < motes.length; n++) {
        var bit = motes[n];
        if (!bit.on) continue;
        bit.life -= dt;
        if (bit.life <= 0) {
          bit.on = false;
          continue;
        }
        var t = bit.life / bit.max;
        var fade = Math.sin(t * Math.PI);
        if (bit.soft) wash(rgb, bit.x, bit.y, bit.size * (1.3 + (1 - t)), 0.28 * fade);
        wash(core, bit.x, bit.y, bit.soft ? bit.size * 0.45 : bit.size * 0.7, 0.7 * fade);
      }
    }

    function step() {
      var nowMs = root.performance.now();
      if (!preview) root.fairyLastFrame = nowMs;
      var gap = last ? (nowMs - last) / 1000 : 0.016;
      if (gap > 0.2) {
        if (flyer.until) flyer.until += gap;
        if (flyer.flip) flyer.flip.start += gap;
        gap = 0.016;
      }
      var dt = Math.min(0.05, gap);
      last = nowMs;
      var now = nowMs / 1000;
      if (!fit()) return;
      var w = canvas.clientWidth;
      var h = canvas.clientHeight;
      var m = metrics();
      var scale = m.widthDp ? w / m.widthDp : 1;
      var sprite = 88.4 * scale;
      var box = area(m, w, h, sprite);
      steer(dt, box, now, scale);
      var motion = pose(dt, scale, now);
      ctx.clearRect(0, 0, w, h);
      drawShine(sprite, scale, dt, nowMs);
      place(sprite, motion);
    }

    function pump() {
      if (!running) return;
      if (!rafId) {
        rafId = root.requestAnimationFrame(function () {
          rafId = 0;
          if (timer) root.clearTimeout(timer);
          timer = 0;
          if (!running) return;
          step();
          if (running) pump();
        });
      }
      if (!timer) {
        timer = root.setTimeout(function () {
          timer = 0;
          if (!running || !rafId) return;
          root.cancelAnimationFrame(rafId);
          rafId = 0;
          step();
          if (running) pump();
        }, 48);
      }
    }

    function pause() {
      if (running) pausedAt = root.performance.now();
      running = false;
      if (rafId) root.cancelAnimationFrame(rafId);
      rafId = 0;
      if (timer) root.clearTimeout(timer);
      timer = 0;
    }

    function resume() {
      var nowMs = root.performance.now();
      if (pausedAt) {
        var held = (nowMs - pausedAt) / 1000;
        if (flyer.until) flyer.until += held;
        if (flyer.flip) flyer.flip.start += held;
        pausedAt = 0;
      }
      if (rafId) root.cancelAnimationFrame(rafId);
      rafId = 0;
      if (timer) root.clearTimeout(timer);
      timer = 0;
      running = true;
      last = nowMs;
      pump();
    }

    root.addEventListener("resize", fit);
    resume();
    return { pause: pause, resume: resume, refit: fit, setLook: setLook };
  }

  var overlayCanvas = document.getElementById("fairy");
  if (overlayCanvas) {
    var flight = attach(overlayCanvas, { preview: false });
    root.fairyPause = flight.pause;
    root.fairyResume = flight.resume;
    root.fairyRefit = flight.refit;
    root.fairySetLook = flight.setLook;
  }

  root.PocketFairy = { attach: attach, tintURL: tintURL };
})(window);
