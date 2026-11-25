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

TILE_COUNT = 6 * 11
tiles = "".join('<i></i>' for _ in range(TILE_COUNT))

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

      /* tiles */
      .tiles {{ position: absolute; left: 90px; top: 240px; width: 900px; height: 1210px; border-radius: 40px; overflow: hidden;
        box-shadow: 0 40px 80px rgba(0,0,0,.35); }}
      .grid {{ position: absolute; left: 0; top: 0; width: 900px; height: 1210px; display: grid;
        grid-template-columns: repeat(6, 1fr); gap: 10px; padding: 10px; }}
      .grid i {{ display: block; border-radius: 6px; }}
      .dirty {{ background: #6e5a3e; }}
      .dirty i {{ background:
          radial-gradient(circle at 30% 40%, rgba(110,85,50,.55) 0 18%, transparent 30%),
          radial-gradient(circle at 70% 75%, rgba(90,70,40,.5) 0 14%, transparent 26%),
          linear-gradient(135deg, #b9c3b8, #a3ab9c); }}
      .clean {{ background: #ffffff; }}
      .clean i {{ background: linear-gradient(135deg, #e9f8ff 0%, #bfe6f7 55%, #d9f2fc 100%); }}
      #wipe {{ position: absolute; left: 0; top: 0; height: 1210px; width: 0; overflow: hidden; }}
      #wipe-edge {{ position: absolute; top: 0; width: 26px; height: 1210px; margin-left: -13px; left: 0;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,.95), transparent); }}
      .spark {{ position: absolute; width: 110px; height: 110px; }}

      /* S1 */
      #s1-q {{ position: absolute; left: 0; right: 0; bottom: 330px; padding: 0 90px; }}
      #s1-h {{ font-size: 84px; background: rgba(18,28,77,.92); border-radius: 40px; padding: 34px 40px 42px; box-shadow: 0 30px 60px rgba(0,0,0,.4); }}

      /* S2 */
      #s2-title {{ position: absolute; top: 110px; left: 0; right: 0; text-align: center; z-index: 4; }}
      #s2-title > .h {{ display: inline-block; background: rgba(18,28,77,.94); border-radius: 36px; padding: 22px 46px 30px; box-shadow: 0 24px 50px rgba(0,0,0,.4); }}
      #s2-title .h {{ font-size: 74px; }}
      #s2-spray {{ position: absolute; width: 360px; right: 40px; bottom: 360px; filter: drop-shadow(0 30px 40px rgba(0,0,0,.45)); }}
      #s2-tags {{ position: absolute; left: 90px; bottom: 380px; display: flex; flex-direction: column; gap: 22px; align-items: flex-start; }}
      #s2-tags .chip {{ font-size: 54px; }}

      /* S3 */
      #s3-badge {{ width: 360px; height: 360px; border-radius: 50%; background: var(--yellow);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        box-shadow: 0 0 0 18px rgba(246,197,27,.25), 0 30px 60px rgba(0,0,0,.35); color: var(--navy-deep); }}
      #s3-badge svg {{ width: 150px; height: 150px; }}
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

      <!-- S1: pergunta sobre piso sujo -->
      <div id="s1" class="clip" {attrs("s1")} data-track-index="1">
        <div class="tiles" id="s1-tiles"><div class="grid dirty">{tiles}</div></div>
        <div id="s1-q"><div id="s1-h" class="h">Seus pisos e rejuntes precisam de uma <span class="hl">limpeza profunda?</span></div></div>
      </div>

      <!-- S2: produto + transformação -->
      <div id="s2" class="clip" {attrs("s2")} data-track-index="1">
        <div class="tiles" id="s2-tiles">
          <div class="grid dirty">{tiles}</div>
          <div id="wipe"><div class="grid clean">{tiles}</div></div>
          <div id="wipe-edge"></div>
          <svg class="spark" id="sp1" style="left:120px;top:220px" viewBox="0 0 100 100"><path d="M50 0 C54 38 62 46 100 50 C62 54 54 62 50 100 C46 62 38 54 0 50 C38 46 46 38 50 0Z" fill="#fff"/></svg>
          <svg class="spark" id="sp2" style="left:520px;top:520px;width:80px;height:80px" viewBox="0 0 100 100"><path d="M50 0 C54 38 62 46 100 50 C62 54 54 62 50 100 C46 62 38 54 0 50 C38 46 46 38 50 0Z" fill="#fff"/></svg>
          <svg class="spark" id="sp3" style="left:260px;top:860px;width:90px;height:90px" viewBox="0 0 100 100"><path d="M50 0 C54 38 62 46 100 50 C62 54 54 62 50 100 C46 62 38 54 0 50 C38 46 46 38 50 0Z" fill="#fff"/></svg>
        </div>
        <div id="s2-title"><div class="h"><span class="chip">Limpa Rejuntes</span><br/>e Pisos Frios</div></div>
        <div id="s2-tags">
          <span class="chip teal" id="tg1">Praticidade</span>
          <span class="chip pink" id="tg2">Eficiência</span>
          <span class="chip cyan" id="tg3">Ambientes renovados</span>
        </div>
        <img id="s2-spray" src="assets/spray.png" alt="Nafta Limpa Rejuntes 500ml" />
      </div>

      <!-- S3: aplicação direta, 2 versões -->
      <div id="s3" class="clip scene" {attrs("s3")} data-track-index="1">
        <div id="s3-badge">
          <svg viewBox="0 0 100 100"><path d="M30 40 H62 V30 H72 V48 H62 V44 H44 V86 Q44 92 38 92 H30Z" fill="#121c4d"/><path d="M74 36 l12 -6 M74 40 h14 M74 44 l12 6" stroke="#121c4d" stroke-width="4" stroke-linecap="round"/></svg>
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

      // S1 — visible on frame 0
      tl.fromTo("#s1-tiles", {{ scale: 1.0 }}, {{ scale: 1.08, duration: nextOf("s1"), ease: "none" }}, 0);
      tl.fromTo("#s1-h", {{ y: 0 }}, {{ y: -10, duration: 0.4, yoyo: true, repeat: 1, ease: "sine.inOut" }}, 0.8);
      out("#s1", nextOf("s1"));

      // S2 — wipe transformation
      let t = T.s2;
      tl.fromTo("#s2-title", {{ y: -120, opacity: 0 }}, {{ y: 0, opacity: 1, duration: 0.5, ease: "back.out(1.7)" }}, t + 0.1);
      tl.fromTo("#s2-spray", {{ x: 500, rotation: 20 }}, {{ x: 0, rotation: -8, duration: 0.7, ease: "back.out(1.4)" }}, t + 0.3);
      tl.fromTo("#wipe", {{ width: 0 }}, {{ width: 900, duration: 4.4, ease: "power1.inOut" }}, t + 1.0);
      tl.fromTo("#wipe-edge", {{ x: 0, opacity: 1 }}, {{ x: 900, duration: 4.4, ease: "power1.inOut" }}, t + 1.0);
      tl.to("#wipe-edge", {{ opacity: 0, duration: 0.2 }}, t + 5.4);
      tl.to("#s2-spray", {{ rotation: -14, duration: 0.25, yoyo: true, repeat: 9, ease: "sine.inOut" }}, t + 1.0);
      ["#sp1","#sp2","#sp3"].forEach((s, i) => tl.fromTo(s, {{ scale: 0, rotation: 0 }}, {{ scale: 1, rotation: 90, duration: 0.6, ease: "back.out(3)", yoyo: true, repeat: 1 }}, t + 3.0 + i * 0.9));
      [["#tg1",3.6],["#tg2",4.5],["#tg3",7.4]].forEach(([s, d]) => tl.fromTo(s, {{ x: -700, opacity: 0 }}, {{ x: 0, opacity: 1, duration: 0.45, ease: "back.out(1.6)" }}, t + d));
      out("#s2", nextOf("s2"));

      // S3
      t = T.s3;
      tl.fromTo("#s3-badge", {{ scale: 0, rotation: -40 }}, {{ scale: 1, rotation: 0, duration: 0.6, ease: "back.out(2.2)" }}, t + 0.05);
      tl.to("#s3-badge", {{ scale: 1.06, duration: 0.4, yoyo: true, repeat: 3, ease: "sine.inOut" }}, t + 0.8);
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

      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
"""
pathlib.Path(__file__).with_name("video").joinpath("index.html").write_text(html)
print("ok")
