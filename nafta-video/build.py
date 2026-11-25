"""Gera video/index.html a partir dos tempos das cenas.

Ajuste TIMES (início de cada cena) e VO (trechos da locução) e rode:
    python3 build.py
"""
import json, pathlib

TOTAL = 35.5
# início de cada cena (s); a cena termina quando a próxima começa
TIMES = {"s1": 0.0, "s2": 3.6, "s3": 13.2, "s4": 17.0, "s5": 21.4, "s6": 25.0, "s7": 29.2, "s8": 30.8}
# trechos da locução: (início no vídeo, início no arquivo, duração)
VO = [(0.2, 0.0, 33.9)]

order = list(TIMES)
def span(k):
    i = order.index(k)
    end = TIMES[order[i + 1]] if i + 1 < len(order) else TOTAL
    return TIMES[k], round(end - TIMES[k], 3)

def attrs(k):
    s, d = span(k)
    return f'data-start="{s}" data-duration="{d}"'

vo_tags = "\n".join(
    f'      <audio id="vo{i}" src="assets/vo.mp3" data-start="{st}" data-media-start="{ms}" data-duration="{round(d,3)}" data-volume="1.15" data-track-index="3"></audio>'
    for i, (st, ms, d) in enumerate(VO)
)

import random
random.seed(11)
NOZ = (652, 454)          # bico do borrifador (coordenadas do quadro)
PUFFS = [1.2, 1.9, 2.6]   # borrifadas (s após início da cena 2)
drops = []
for p_i in range(len(PUFFS)):
    for d in range(24):
        ex = random.uniform(170, 560); ey = NOZ[1] + random.uniform(-230, 260) * (NOZ[0] - ex) / 480
        r = random.uniform(6, 18)
        drops.append((p_i, d, ex, ey, r))
drops_html = "".join(
    f'<i class="drop" id="dr{p}_{d}" style="left:{NOZ[0]-r}px;top:{NOZ[1]-r}px;width:{2*r:.0f}px;height:{2*r:.0f}px"></i>'
    for p, d, ex, ey, r in drops)
drops_js = json.dumps([[f"#dr{p}_{d}", round(ex - NOZ[0], 1), round(ey - NOZ[1], 1)] for p, d, ex, ey, r in drops])
FOAM = [(330, 140, 360), (120, 330, 420), (300, 520, 400)]  # x, y, tamanho no piso
foam_html = "".join(f'<i class="foam" id="fm{i}" style="left:{x}px;top:{y}px;width:{w}px;height:{w}px"></i>' for i, (x, y, w) in enumerate(FOAM))
SFX = [("sfx-spray.wav", 3.6 + p, 0.42, 0.9) for p in PUFFS] + [("sfx-whoosh.wav", 3.6 + 3.9, 0.9, 0.6), ("sfx-brilho.wav", 3.6 + 5.3, 1.6, 0.7)]
sfx_tags = "\n".join(f'      <audio id="fx{i}" src="assets/{f}" data-start="{round(st,2)}" data-duration="{d}" data-volume="{v}" data-track-index="4"></audio>' for i, (f, st, d, v) in enumerate(SFX))

html = f"""<!doctype html>
<html lang="pt-BR" data-resolution="portrait">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&display=swap" rel="stylesheet" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      :root {{
        --navy: #283a92; --navy-dark: #1a2766; --navy-deep: #121c4d;
        --teal: #3fb7a0; --pink: #e27ab6; --cyan: #3bb9e8; --yellow: #f6c51b; --purple: #8a5cb8;
        --white: #ffffff; --tile: #cfeaf6; --font-display: "Nunito", sans-serif;
      }}
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ width: 1080px; height: 1920px; overflow: hidden; background: var(--navy); }}
      #root {{ position: relative; width: 100%; height: 100%; overflow: hidden; font-family: var(--font-display);
        background: radial-gradient(circle at 50% 35%, #3550b8 0%, var(--navy) 45%, var(--navy-deep) 100%); }}
      .clip {{ position: absolute; inset: 0; }}
      .scene {{ display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 140px 110px 360px; }}

      /* leaves decor (brand) */
      .leaf {{ position: absolute; border-radius: 0 70% 0 70%; }}

      /* headline styles */
      .h {{ color: var(--white); font-weight: 900; text-align: center; line-height: 1.02; letter-spacing: -0.01em; }}
      .hl {{ color: var(--yellow); }}
      .chip {{ display: inline-block; background: var(--yellow); color: var(--navy-deep); border-radius: 22px;
        padding: 8px 34px 14px; font-weight: 900; }}
      .chip.teal {{ background: #1f8a77; color: #fff; }}
      .chip.pink {{ background: #b84d8f; color: #fff; }}
      .chip.cyan {{ background: var(--cyan); color: var(--navy-deep); }}

      /* piso grande */
      .piso {{ position: absolute; left: 100px; top: 300px; width: 880px; height: 880px; border-radius: 30px; overflow: hidden;
        box-shadow: 0 0 0 10px rgba(255,255,255,.08), 0 50px 90px rgba(0,0,0,.5); }}
      .piso .img {{ position: absolute; left: 0; top: 0; width: 880px; height: 880px; background-size: 880px 880px; }}
      .sujo {{ background-image: url(assets/piso-sujo.png); }}
      .limpo {{ background-image: url(assets/piso-limpo.png); }}
      #wipe {{ position: absolute; left: 0; top: 0; height: 880px; width: 0; overflow: hidden; }}
      #glare {{ position: absolute; left: 0; top: -260px; width: 190px; height: 1400px; transform: rotate(18deg);
        background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.95) 45%, rgba(255,255,255,.95) 55%, rgba(255,255,255,0)); }}
      .foam {{ position: absolute; border-radius: 50%;
        background: radial-gradient(circle, rgba(255,255,255,.75) 0%, rgba(235,248,255,.55) 45%, rgba(255,255,255,0) 70%); }}
      .drop {{ position: absolute; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #fff 0%, rgba(210,240,255,.9) 50%, rgba(160,215,245,.6) 100%); }}
      #mist {{ position: absolute; left: {NOZ[0]-560}px; top: {NOZ[1]-260}px; width: 560px; height: 520px; transform-origin: 100% 50%; filter: blur(6px) drop-shadow(0 0 20px rgba(255,255,255,.8)); }}
      .spark {{ position: absolute; width: 140px; height: 140px; filter: drop-shadow(0 0 10px #3bb9e8) drop-shadow(0 0 22px #3bb9e8); }}

      #footer-logo {{ position: absolute; left: 50%; bottom: 100px; width: 230px; margin-left: -115px; z-index: 8;
        filter: drop-shadow(0 10px 20px rgba(0,0,0,.4)); }}

      /* S1 */
      #s1-q {{ position: absolute; left: 0; right: 0; bottom: 330px; padding: 0 90px; }}
      #s1-h {{ font-size: 84px; background: rgba(18,28,77,.92); border-radius: 40px; padding: 34px 40px 42px; box-shadow: 0 30px 60px rgba(0,0,0,.4); }}

      /* S2 */
      #s2-title {{ position: absolute; top: 100px; left: 0; right: 0; text-align: center; z-index: 4; }}
      #s2-title > .h {{ display: inline-block; background: rgba(18,28,77,.94); border-radius: 36px; padding: 18px 46px 26px; box-shadow: 0 24px 50px rgba(0,0,0,.4); }}
      #s2-title .h {{ font-size: 66px; }}
      #s2-spray {{ position: absolute; height: 640px; left: 650px; top: 400px; z-index: 5; filter: drop-shadow(0 30px 40px rgba(0,0,0,.45)); transform-origin: 50% 90%; }}
      #s2-tags {{ position: absolute; left: 60px; right: 60px; top: 1240px; display: flex; flex-wrap: wrap; justify-content: center; gap: 22px; }}
      #s2-tags .chip {{ font-size: 64px; }}
      #fx-layer {{ position: absolute; inset: 0; z-index: 6; pointer-events: none; }}

      /* S3 */
      #s3-badge {{ width: 360px; height: 360px; border-radius: 50%; background: var(--yellow);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        box-shadow: 0 0 0 18px rgba(246,197,27,.25), 0 30px 60px rgba(0,0,0,.35); color: var(--navy-deep); }}
      #s3-badge svg {{ width: 170px; height: 170px; margin-top: -10px; }}
      #s3-badge b {{ font-size: 46px; font-weight: 900; line-height: 1; margin-top: 8px; text-align: center; }}
      #s3-h {{ font-size: 96px; margin-top: 80px; }}

      /* S4 / S5 product */
      .prod {{ position: relative; display: flex; align-items: center; justify-content: center; width: 900px; height: 1000px; }}
      .halo {{ position: absolute; width: 760px; height: 760px; border-radius: 50%;
        background: radial-gradient(circle, rgba(59,185,232,.55) 0%, rgba(59,185,232,0) 70%); }}
      .prod img {{ position: relative; filter: drop-shadow(0 40px 50px rgba(0,0,0,.5)); }}
      #s4-img {{ height: 920px; }}
      #s5-img {{ height: 860px; }}
      .size {{ position: absolute; top: 380px; font-size: 150px; font-weight: 900; color: var(--yellow); line-height: 1;
        text-shadow: 0 10px 0 var(--navy-deep); z-index: 3; }}
      #s4 .size {{ left: 0; }}
      #s5 .size {{ right: 0; }}
      .cap {{ margin-top: 10px; text-align: center; }}
      .cap .chip {{ font-size: 50px; }}
      .cap p {{ color: #fff; font-size: 52px; font-weight: 800; margin-top: 22px; }}

      /* S6 */
      #s6-duo {{ position: relative; width: 900px; height: 820px; }}
      #s6-gal {{ position: absolute; left: 70px; bottom: 0; height: 760px; filter: drop-shadow(0 30px 40px rgba(0,0,0,.5)); }}
      #s6-spr {{ position: absolute; right: 90px; bottom: 0; height: 800px; filter: drop-shadow(0 30px 40px rgba(0,0,0,.5)); }}
      #s6-list {{ margin-top: 60px; display: flex; flex-direction: column; align-items: center; gap: 18px; }}
      #s6-list .h {{ font-size: 78px; }}

      /* S7 */
      #s7-h {{ font-size: 150px; }}
      #s7-burst {{ position: absolute; width: 1400px; height: 1400px; left: -160px; top: 120px; }}

      /* S8 */
      #s8-logo {{ width: 860px; filter: drop-shadow(0 30px 50px rgba(0,0,0,.45)); }}
      #s8-h {{ font-size: 64px; margin-top: 70px; }}
      #s8-prods {{ display: flex; gap: 30px; align-items: flex-end; margin-top: 60px; }}
      #s8-prods img {{ filter: drop-shadow(0 20px 30px rgba(0,0,0,.5)); }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{TOTAL}" data-width="1080" data-height="1920">

      <div id="decor" class="clip" data-start="0" data-duration="{TOTAL}" data-track-index="0">
        <div class="leaf" id="lf1" style="width:220px;height:220px;left:-70px;top:120px;background:var(--teal);opacity:.22"></div>
        <div class="leaf" id="lf2" style="width:140px;height:140px;right:-30px;top:520px;background:var(--pink);opacity:.22"></div>
        <div class="leaf" id="lf3" style="width:180px;height:180px;right:60px;bottom:120px;background:var(--yellow);opacity:.18"></div>
        <div class="leaf" id="lf4" style="width:110px;height:110px;left:80px;bottom:300px;background:var(--cyan);opacity:.22"></div>
      </div>

      <div id="footer" class="clip" data-start="0" data-duration="{TIMES['s8'] + 0.4}" data-track-index="5" style="z-index:8;pointer-events:none"><img id="footer-logo" src="assets/logo.png" alt="Nafta" /></div>

      <!-- S1: piso sujo em destaque -->
      <div id="s1" class="clip" {attrs("s1")} data-track-index="1">
        <div class="piso" id="s1-piso"><div class="img sujo"></div></div>
        <div id="s1-q"><div id="s1-h" class="h">Seus pisos e rejuntes precisam de uma <span class="hl">limpeza profunda?</span></div></div>
      </div>

      <!-- S2: borrifa, brilho, limpo -->
      <div id="s2" class="clip" {attrs("s2")} data-track-index="1">
        <div class="piso" id="s2-piso">
          <div class="img sujo"></div>
          {foam_html}
          <div id="wipe"><div class="img limpo"></div></div>
          <div id="glare"></div>
          <svg class="spark" id="sp1" style="left:150px;top:140px" viewBox="0 0 100 100"><path d="M50 0 C54 38 62 46 100 50 C62 54 54 62 50 100 C46 62 38 54 0 50 C38 46 46 38 50 0Z" fill="#fff"/></svg>
          <svg class="spark" id="sp2" style="left:600px;top:300px;width:90px;height:90px" viewBox="0 0 100 100"><path d="M50 0 C54 38 62 46 100 50 C62 54 54 62 50 100 C46 62 38 54 0 50 C38 46 46 38 50 0Z" fill="#fff"/></svg>
          <svg class="spark" id="sp3" style="left:320px;top:620px;width:100px;height:100px" viewBox="0 0 100 100"><path d="M50 0 C54 38 62 46 100 50 C62 54 54 62 50 100 C46 62 38 54 0 50 C38 46 46 38 50 0Z" fill="#fff"/></svg>
          <svg class="spark" id="sp4" style="left:700px;top:720px;width:70px;height:70px" viewBox="0 0 100 100"><path d="M50 0 C54 38 62 46 100 50 C62 54 54 62 50 100 C46 62 38 54 0 50 C38 46 46 38 50 0Z" fill="#fff"/></svg>
        </div>
        <div id="s2-title"><div class="h"><span class="chip">Limpa Rejuntes</span><br/>e Pisos Frios</div></div>
        <div id="s2-tags">
          <span class="chip teal" id="tg1">Praticidade</span>
          <span class="chip pink" id="tg2">Eficiência</span>
          <span class="chip cyan" id="tg3">Ambientes renovados</span>
        </div>
        <img id="s2-spray" src="assets/spray.png" alt="Nafta Limpa Rejuntes 500ml" />
        <div id="fx-layer">
          <svg id="mist" viewBox="0 0 520 460"><defs><radialGradient id="mg" cx="1" cy="0.5" r="1"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".55" stop-color="#eaf8ff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><path d="M520 230 L0 0 Q-40 230 0 460 Z" fill="url(#mg)"/></svg>
          {drops_html}
        </div>
      </div>

      <!-- S3: aplicação direta, 2 versões -->
      <div id="s3" class="clip scene" {attrs("s3")} data-track-index="1">
        <div id="s3-badge">
          <svg viewBox="0 0 100 100" style="overflow:visible">
            <g transform="translate(-9 0)">
            <g fill="#121c4d">
              <rect x="36" y="20" width="12" height="9" rx="2.5"/>
              <path d="M46 16 H76 Q82 16 82 22 V28 Q82 34 76 34 H46 Z"/>
              <path d="M55 34 L47 52 Q45 57 50 57 L54 57 L61 38 Z"/>
              <rect x="63" y="34" width="14" height="9" rx="1.5"/>
              <path d="M60 43 H80 Q87 43 87 51 V88 Q87 95 80 95 H60 Q53 95 53 88 V56 Q53 47 60 43 Z"/>
            </g>
            <rect x="58" y="60" width="24" height="20" rx="4" fill="#f6c51b"/>
            <g id="s3-mist" fill="#121c4d">
              <circle class="mz" cx="29" cy="24.5" r="2.6"/>
              <circle class="mz" cx="21" cy="17" r="2.4"/><circle class="mz" cx="20" cy="25" r="2.8"/><circle class="mz" cx="21" cy="33" r="2.4"/>
              <circle class="mz" cx="11" cy="10" r="2.2"/><circle class="mz" cx="10" cy="20" r="2.6"/><circle class="mz" cx="9" cy="30" r="2.6"/><circle class="mz" cx="11" cy="40" r="2.2"/>
            </g>
            </g>
          </svg>
          <b>Aplicação<br/>direta</b>
        </div>
        <div id="s3-h" class="h">Disponível em<br/><span class="hl">2 versões</span></div>
      </div>

      <!-- S4: 500ml -->
      <div id="s4" class="clip scene" {attrs("s4")} data-track-index="1">
        <div class="prod"><div class="halo"></div><div class="size">500<small style="font-size:70px">ml</small></div><img id="s4-img" src="assets/spray.png" alt="Nafta 500ml com borrifador" /></div>
        <div class="cap"><span class="chip">Com borrifador</span><p>Praticidade no dia a dia</p></div>
      </div>

      <!-- S5: 5L -->
      <div id="s5" class="clip scene" {attrs("s5")} data-track-index="1">
        <div class="prod"><div class="halo" style="background:radial-gradient(circle, rgba(63,183,160,.55) 0%, rgba(63,183,160,0) 70%)"></div><div class="size">5<small style="font-size:90px">L</small></div><img id="s5-img" src="assets/galao.png" alt="Nafta 5 litros" /></div>
        <div class="cap"><span class="chip teal">Galão de 5 litros</span><p>Para limpezas de maior volume</p></div>
      </div>

      <!-- S6: benefícios -->
      <div id="s6" class="clip scene" {attrs("s6")} data-track-index="1">
        <div id="s6-duo"><img id="s6-gal" src="assets/galao.png" alt="" /><img id="s6-spr" src="assets/spray.png" alt="" /></div>
        <div id="s6-list">
          <div class="h" id="b1">Mais <span class="chip teal">praticidade</span></div>
          <div class="h" id="b2">Mais <span class="chip pink">eficiência</span></div>
          <div class="h" id="b3">Muito mais <span class="chip">limpeza!</span></div>
        </div>
      </div>

      <!-- S7: garanta -->
      <div id="s7" class="clip scene" {attrs("s7")} data-track-index="1">
        <svg id="s7-burst" viewBox="0 0 100 100"><g id="burst-g" fill="rgba(246,197,27,.12)">{''.join(f'<path d="M50 50 L{50+70*__import__("math").cos(i*0.3927):.2f} {50+70*__import__("math").sin(i*0.3927):.2f} L{50+70*__import__("math").cos(i*0.3927+0.19):.2f} {50+70*__import__("math").sin(i*0.3927+0.19):.2f}Z"/>' for i in range(16))}</g></svg>
        <div id="s7-h" class="h">Garanta<br/><span class="hl">já o seu!</span></div>
      </div>

      <!-- S8: logo -->
      <div id="s8" class="clip scene" {attrs("s8")} data-track-index="1">
        <img id="s8-logo" src="assets/logo.png" alt="Nafta" />
        <div id="s8-h" class="h">Qualidade que <span class="hl">transforma</span><br/>a sua limpeza</div>
        <div id="s8-prods"><img src="assets/spray.png" style="height:420px" alt="" /><img src="assets/galao.png" style="height:380px" alt="" /></div>
      </div>

      <audio id="music" src="assets/music.wav" data-start="0" data-duration="{TOTAL}" data-volume="0.16" data-fade-in="0.3" data-fade-out="1.5" data-track-index="2"></audio>
{vo_tags}
{sfx_tags}
    </div>

    <script>
      window.__timelines = window.__timelines || {{}};
      const T = {json.dumps(TIMES)};
      const END = {TOTAL};
      const tl = gsap.timeline({{ paused: true }});
      const out = (sel, k) => tl.to(sel, {{ opacity: 0, duration: 0.3, ease: "power2.in" }}, k - 0.3);
      const nextOf = (k) => {{ const ks = Object.keys(T); const i = ks.indexOf(k); return i + 1 < ks.length ? T[ks[i+1]] : END; }};

      // decor leaves drift
      ["#lf1","#lf2","#lf3","#lf4"].forEach((l, i) => tl.fromTo(l, {{ rotation: 0, y: 0 }}, {{ rotation: i % 2 ? -40 : 40, y: i % 2 ? 60 : -60, duration: END, ease: "none" }}, 0));

      // S1 — piso sujo já visível no frame 0
      tl.fromTo("#s1-piso", {{ scale: 1.0 }}, {{ scale: 1.04, duration: nextOf("s1"), ease: "none" }}, 0);
      tl.fromTo("#s1-h", {{ y: 0 }}, {{ y: -10, duration: 0.4, yoyo: true, repeat: 1, ease: "sine.inOut" }}, 0.8);
      tl.to("#s1-q", {{ opacity: 0, y: 40, duration: 0.25 }}, nextOf("s1") - 0.25);

      // S2 — borrifar, espuma, brilho, limpo
      let t = T.s2;
      const PUFFS = {json.dumps(PUFFS)};
      const DROPS = {drops_js};
      tl.set("#s2-piso", {{ scale: 1.04 }}, t);
      tl.fromTo("#s2-title", {{ y: -120, opacity: 0 }}, {{ y: 0, opacity: 1, duration: 0.5, ease: "back.out(1.7)" }}, t + 0.1);
      tl.fromTo("#s2-spray", {{ x: 600, rotation: 15 }}, {{ x: 0, rotation: 0, duration: 0.6, ease: "back.out(1.3)" }}, t + 0.3);
      tl.set("#mist", {{ opacity: 0, scaleX: 0 }}, t);
      DROPS.forEach(([id]) => tl.set(id, {{ opacity: 0 }}, t));
      PUFFS.forEach((p, i) => {{
        const k = t + p;
        tl.to("#s2-spray", {{ rotation: -4, x: -10, duration: 0.08, ease: "power2.out" }}, k - 0.05);
        tl.to("#s2-spray", {{ rotation: 0, x: 0, duration: 0.25, ease: "power2.out" }}, k + 0.05);
        tl.fromTo("#mist", {{ opacity: 1, scaleX: 0.1, scaleY: 0.4 }}, {{ opacity: 0, scaleX: 1, scaleY: 1.15, duration: 0.7, ease: "power2.out", immediateRender: false }}, k);
        DROPS.filter(d => d[0].startsWith("#dr" + i + "_")).forEach(([id, dx, dy], j) => {{
          tl.fromTo(id, {{ x: 0, y: 0, opacity: 1, scale: 0.4 }}, {{ x: dx, y: dy, scale: 1, duration: 0.35 + (j % 4) * 0.05, ease: "power2.out", immediateRender: false }}, k);
          tl.to(id, {{ opacity: 0, duration: 0.6 }}, k + 0.5 + (j % 5) * 0.05);
        }});
        tl.fromTo("#fm" + i, {{ scale: 0.2, opacity: 0 }}, {{ scale: 1, opacity: 1, duration: 0.5, ease: "power2.out" }}, k + 0.2);
      }});
      tl.to("#s2-spray", {{ x: 650, rotation: 12, duration: 0.5, ease: "power2.in" }}, t + 3.3);
      // brilho varre e deixa limpo
      tl.fromTo("#wipe", {{ width: 0 }}, {{ width: 880, duration: 1.4, ease: "power1.inOut" }}, t + 3.9);
      tl.fromTo("#glare", {{ x: -260, opacity: 1 }}, {{ x: 1000, duration: 1.4, ease: "power1.inOut" }}, t + 3.9);
      ["#fm0", "#fm1", "#fm2"].forEach(f => tl.to(f, {{ opacity: 0, duration: 0.6 }}, t + 4.5));
      [["#sp1",5.3],["#sp2",5.5],["#sp3",5.7],["#sp4",5.9]].forEach(([s, d]) => {{
        tl.fromTo(s, {{ scale: 0, rotation: 0 }}, {{ scale: 1, rotation: 90, duration: 0.5, ease: "back.out(3)" }}, t + d);
        tl.to(s, {{ scale: 0.5, rotation: 180, opacity: 0.6, duration: 0.6, yoyo: true, repeat: 3, ease: "sine.inOut" }}, t + d + 0.5);
      }});
      tl.to("#s2-piso", {{ scale: 1.0, duration: 4, ease: "sine.inOut" }}, t + 5.3);
      [["#tg1",3.6],["#tg2",4.5],["#tg3",7.4]].forEach(([s, d]) => tl.fromTo(s, {{ y: 80, opacity: 0 }}, {{ y: 0, opacity: 1, duration: 0.45, ease: "back.out(1.6)" }}, t + d));
      out("#s2", nextOf("s2"));

      // S3
      t = T.s3;
      tl.fromTo("#s3-badge", {{ scale: 0, rotation: -40 }}, {{ scale: 1, rotation: 0, duration: 0.6, ease: "back.out(2.2)" }}, t + 0.05);
      tl.to("#s3-badge", {{ scale: 1.06, duration: 0.4, yoyo: true, repeat: 3, ease: "sine.inOut" }}, t + 0.8);
      for (let r = 0; r < 3; r++) tl.fromTo("#s3-mist .mz", {{ opacity: 0, x: 8, scale: 0.4, transformOrigin: "50% 50%" }}, {{ opacity: 1, x: 0, scale: 1, duration: 0.35, stagger: 0.05, ease: "power2.out", immediateRender: r === 0 }}, t + 0.5 + r * 0.9);
      tl.fromTo("#s3-h", {{ y: 80, opacity: 0 }}, {{ y: 0, opacity: 1, duration: 0.45, ease: "power3.out" }}, t + 1.9);
      out("#s3", nextOf("s3"));

      // S4
      t = T.s4;
      tl.fromTo("#s4-img", {{ y: 400, opacity: 0, rotation: 10 }}, {{ y: 0, opacity: 1, rotation: 0, duration: 0.7, ease: "back.out(1.5)" }}, t + 0.05);
      tl.fromTo("#s4 .halo", {{ scale: 0.6 }}, {{ scale: 1.1, duration: nextOf("s4") - t, ease: "sine.out" }}, t);
      tl.fromTo("#s4 .size", {{ x: -300, opacity: 0 }}, {{ x: 0, opacity: 1, duration: 0.5, ease: "back.out(1.6)" }}, t + 0.5);
      tl.fromTo("#s4 .cap", {{ y: 60, opacity: 0 }}, {{ y: 0, opacity: 1, duration: 0.45, ease: "power3.out" }}, t + 1.0);
      out("#s4", nextOf("s4"));

      // S5
      t = T.s5;
      tl.fromTo("#s5-img", {{ y: 400, opacity: 0, rotation: -8 }}, {{ y: 0, opacity: 1, rotation: 0, duration: 0.7, ease: "back.out(1.5)" }}, t + 0.05);
      tl.fromTo("#s5 .halo", {{ scale: 0.6 }}, {{ scale: 1.1, duration: nextOf("s5") - t, ease: "sine.out" }}, t);
      tl.fromTo("#s5 .size", {{ x: 300, opacity: 0 }}, {{ x: 0, opacity: 1, duration: 0.5, ease: "back.out(1.6)" }}, t + 0.5);
      tl.fromTo("#s5 .cap", {{ y: 60, opacity: 0 }}, {{ y: 0, opacity: 1, duration: 0.45, ease: "power3.out" }}, t + 1.0);
      out("#s5", nextOf("s5"));

      // S6
      t = T.s6;
      tl.fromTo("#s6-gal", {{ x: -600 }}, {{ x: 0, duration: 0.6, ease: "power3.out" }}, t + 0.05);
      tl.fromTo("#s6-spr", {{ x: 600 }}, {{ x: 0, duration: 0.6, ease: "power3.out" }}, t + 0.15);
      ["#b1","#b2","#b3"].forEach((s, i) => tl.fromTo(s, {{ scale: 0.4, opacity: 0 }}, {{ scale: 1, opacity: 1, duration: 0.4, ease: "back.out(2)" }}, t + 0.1 + i * 1.15));
      out("#s6", nextOf("s6"));

      // S7
      t = T.s7;
      tl.fromTo("#s7-burst", {{ rotation: 0, scale: 0.6 }}, {{ rotation: 45, scale: 1, duration: nextOf("s7") - t, ease: "none" }}, t);
      tl.fromTo("#s7-h", {{ scale: 0 }}, {{ scale: 1, duration: 0.45, ease: "back.out(2.4)" }}, t + 0.05);
      tl.to("#s7-h", {{ scale: 1.07, duration: 0.3, yoyo: true, repeat: 3, ease: "sine.inOut" }}, t + 0.6);
      out("#s7", nextOf("s7"));

      // S8
      t = T.s8;
      tl.fromTo("#s8-logo", {{ scale: 0, rotation: -6 }}, {{ scale: 1, rotation: 0, duration: 0.7, ease: "back.out(1.8)" }}, t + 0.05);
      tl.fromTo("#s8-h", {{ y: 60, opacity: 0 }}, {{ y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }}, t + 0.7);
      tl.fromTo("#s8-prods", {{ y: 300, opacity: 0 }}, {{ y: 0, opacity: 1, duration: 0.6, ease: "back.out(1.4)" }}, t + 1.1);

      tl.to("#footer-logo", {{ opacity: 0, y: 30, duration: 0.35, ease: "power2.in" }}, T.s8);
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
"""
pathlib.Path(__file__).with_name("video").joinpath("index.html").write_text(html)
print("ok")
