#!/usr/bin/env python3
"""Builds a page of its own for every ready-made list, plus an index of all lists.

Run from the repo root after changing any list in index.html:   python3 tools/build-lists.py
It reads the lists straight out of index.html (TRIPS, CAT, BAGS, BAGOF), writes lists/*.html and
refreshes sitemap.xml. Cloudflare serves lists/school-day.html at dobytoday.com/lists/school-day.
Each page works as a tick-off checklist (hand the phone to a child); ticks stay on that phone and start fresh each morning.
"""
import html, json, os, re, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://dobytoday.com"
src = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

def js(var):
    return json.loads(re.search(r"var " + var + r" = (.*?);\n", src, re.S).group(1))

CAT, BAGS, BAGOF, TRIPS = js("CAT"), js("BAGS"), js("BAGOF"), js("TRIPS")
VER = re.search(r'<span class="ver">(v\d+)</span>', src).group(1)
e = lambda s: html.escape(str(s), quote=True)
area_of = {n: a for a, names in CAT.items() for n in names}
WHENS = {x[0] for x in BAGS}

def when(t, n):
    """Same rule as the site: the job's usual time of day (a list can move "hold" jobs with force)."""
    b = BAGOF.get(n) or BAGOF.get(area_of.get(n, ""), "hold")
    if t.get("force") and b == "hold": return t["force"]
    return b if b in WHENS else "any"

CSS = """
:root{color-scheme:light;--bg:#f7f1ec;--card:#fff;--line:#e6d6cc;--ink:#2b211c;--muted:#70605a;--main:#c4603a;--main-deep:#94452a;--wash:#f8e3d9;--gold:#e6be55;--gold-deep:#c9971f;--gold-ink:#5c430a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Atkinson Hyperlegible",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:16px;line-height:1.5}
.wrap{max-width:760px;margin:0 auto;padding:0 16px 60px}
header{padding:22px 0 12px;border-bottom:1px solid var(--line);display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.brand{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:1.45rem;color:var(--main);text-decoration:none}
.brand span{color:var(--ink)}
header .home{margin-left:auto;font-size:.9rem;color:var(--main-deep)}
.crumbs{font-size:.85rem;color:var(--muted);margin:14px 0 6px}
.crumbs a{color:var(--main-deep)}
h1{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:1.9rem;line-height:1.15;margin:4px 0 8px;color:var(--main-deep)}
.lead{margin:0 0 14px;color:var(--muted)}
.by{display:flex;align-items:center;gap:12px;margin:0 0 16px;padding:12px 14px;border-radius:12px;border:1.5px solid var(--gold);background:linear-gradient(90deg,#fff6dc,#fffdf6)}
.av{flex:none;width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--gold),var(--gold-deep));color:#fff;font-size:1.45rem;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #fff,0 0 0 3.5px var(--gold)}
.by small{display:block;font-size:.7rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#a67c14}
.by b{font-size:1.05rem;color:var(--gold-ink)}
.go{display:block;text-align:center;background:var(--main);color:#fff;text-decoration:none;font-weight:700;font-size:1.05rem;padding:14px 16px;border-radius:12px;margin:0 0 8px}
.go:hover{background:var(--main-deep)}
.acts{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;font-size:.9rem;margin:0 0 20px}
.acts a,.acts button{color:var(--main-deep);background:none;border:0;padding:0;font:inherit;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px 16px 12px;margin:0 0 14px}
h2{font-size:.8rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--main);margin:14px 0 6px}
h2 small{letter-spacing:0;text-transform:none;font-weight:400;color:var(--muted)}
ul.items{list-style:none;margin:0;padding:0}
ul.items li{display:flex;gap:10px;align-items:center;padding:7px 0;border-top:1px solid var(--line)}
ul.items li:first-child{border-top:0}
ul.items li::before{content:"";flex:none;width:18px;height:18px;border:2px solid var(--main);border-radius:5px}
ul.items li.opt{color:var(--muted)}
ul.items li.opt::before{border-style:dashed;border-color:var(--muted)}
ul.items li.opt em{font-style:normal;font-size:.8rem;margin-left:auto}
.lists{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin:8px 0 18px}
.lists a{display:block;background:var(--card);border:1.5px solid var(--line);border-radius:10px;padding:12px 13px;text-decoration:none;color:var(--ink)}
.lists a.gold{border-color:var(--gold);background:linear-gradient(180deg,#fffaf0,#fff 70%)}
.lists a b{display:block;color:var(--main-deep)}
.lists a small{display:block;font-size:.84rem;color:var(--muted);line-height:1.35;margin-top:3px}
.lists a span{display:block;font-size:.78rem;color:var(--main);font-weight:700;margin-top:5px}
footer{border-top:1px solid var(--line);margin-top:26px;padding-top:14px;font-size:.85rem;color:var(--muted)}
footer a{color:var(--main-deep)}
/* the list page doubles as a tick-off checklist (hand the phone to a child and let them tick) */
.acts2{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}
.acts2 a,.acts2 button{font:inherit;font-size:.9rem;font-weight:700;color:var(--main-deep);background:var(--card);border:1.5px solid var(--line);border-radius:999px;padding:7px 14px;text-decoration:none;cursor:pointer}
.acts2 .add{background:var(--main);border-color:var(--main);color:#fff}
.acts2 .keepb{background:#fff;color:var(--main-deep);border-color:var(--main)}
.prog{position:sticky;top:0;z-index:3;background:var(--bg);padding:10px 0 10px;margin:0 0 4px}
.pbar{height:12px;border-radius:99px;background:var(--wash);overflow:hidden}
.prog.all .pbar i{background:linear-gradient(90deg,#e6be55,#c9971f)}
.pbar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#3f9a6b,#2f7d55);border-radius:99px;transition:width .3s}
.pt{display:flex;justify-content:space-between;align-items:baseline;margin-top:5px;font-weight:700;color:var(--main-deep)}
.pt button{font:inherit;font-size:.85rem;font-weight:400;color:var(--muted);background:none;border:0;text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:0}
ul.items.chk li{padding:0}
ul.items.chk li::before{display:none}
.tk{font:inherit;font-size:1.08rem;color:var(--ink);background:none;border:0;width:100%;text-align:left;display:flex;align-items:center;gap:14px;padding:12px 2px;cursor:pointer;-webkit-tap-highlight-color:transparent}
.tk::before{content:"";flex:none;width:28px;height:28px;border:2.5px solid var(--main);border-radius:8px;background:#fff center/18px no-repeat}
.tk[aria-pressed="true"]{color:var(--muted);text-decoration:line-through;text-decoration-thickness:2px}
.tk[aria-pressed="true"]::before{background-color:#2f7d55;border-color:#2f7d55;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3 8.5l3.2 3L13 4.5' fill='none' stroke='%23fff' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")}
.extras{margin:10px 0 0;border-top:1px solid var(--line);padding-top:6px}
.extras summary{cursor:pointer;font-weight:700;color:var(--main-deep);padding:8px 0}
.extras .tk{font-size:1rem;padding:9px 2px}
.extras .tk::before{width:24px;height:24px;border-style:dashed}
.done{margin:0 0 14px;padding:16px;border-radius:12px;background:#e3f3e9;border:1.5px solid #3f9a6b;text-align:center;font-weight:700;font-size:1.15rem;color:#1f5e3d}
.done small{display:block;font-weight:400;font-size:.88rem;color:var(--muted);margin-top:2px}
@media print{header .home,.go,.acts,.acts2,.prog,.done,footer,.crumbs{display:none}body{background:#fff}.card{border:0;padding:0}.tk[aria-pressed="true"]{color:var(--ink);text-decoration:none}.tk[aria-pressed="true"]::before{background:#fff;border-color:var(--main)}}
"""

def page(path, title, desc, body, crumbs):
    url = SITE + "/" + path
    cr = " › ".join('<a href="%s">%s</a>' % (e(h), e(t)) if h else e(t) for t, h in crumbs)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<meta name="theme-color" content="#b0611c">
<link rel="canonical" href="{e(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Do by Today">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{e(url)}">
<meta property="og:image" content="{SITE}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23b0611c'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Atkinson+Hyperlegible:wght@400;700&display=swap">
<style>{CSS}</style>
</head>
<body>
<div class="wrap">
<header><a class="brand" href="/">Do<span>by</span>Today</a><a class="home" href="/">← DobyToday home</a></header>
<p class="crumbs">{cr}</p>
{body}
<footer>
<p><a href="/"><b>DobyToday</b></a> – a to-do list for today only, sorted by when. Free, no account needed.
<a href="/">Start your own list</a> · <a href="/lists/">All ready-made lists</a></p>
<p>From Handy Little Tools – also try <a href="https://listbyaisle.com/">ListbyAisle</a> (a shopping list sorted by aisle), <a href="https://packbybag.com/">PackbyBag</a> (a packing list sorted by bag) and <a href="https://dueareset.com/">DueAReset</a> (a page of your own to change a habit). {VER}</p>
</footer>
</div>
<script>
document.addEventListener("click", function(ev){{ var sh = ev.target.closest("[data-share]"); if(sh){{ var su = sh.getAttribute("data-share"), st = document.title;
    if(navigator.share) navigator.share({{title: st, url: su}}).catch(function(){{}}); else if(navigator.clipboard) navigator.clipboard.writeText(su).then(function(){{ sh.textContent = "Link copied ✓"; setTimeout(function(){{ sh.textContent = "Share"; }}, 2200); }}, function(){{ prompt("Copy this link:", su); }}); else prompt("Copy this link:", su); return; }}
  var b = ev.target.closest("[data-copy]"); if(!b) return; var u = b.getAttribute("data-copy");
  function done(){{ b.textContent = "Link copied ✓"; setTimeout(function(){{ b.textContent = "Copy link"; }}, 2200); }}
  if(navigator.clipboard) navigator.clipboard.writeText(u).then(done, function(){{ prompt("Copy this link:", u); }}); else prompt("Copy this link:", u); }});
// Tick-off checklist: ticks stay on this phone. Every list starts fresh each morning.
(function(){{ var P = document.getElementById("prog"); if(!P) return; var slug = P.getAttribute("data-slug"), daily = P.getAttribute("data-daily") === "1", K = "dobytoday-ticks";
  var d = new Date(), today = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  function all(){{ try{{ return JSON.parse(localStorage.getItem(K) || "{{}}") || {{}}; }}catch(e){{ return {{}}; }} }}
  var me = all()[slug] || {{}}, T = (daily && me.d !== today) ? {{}} : (me.t || {{}});
  function store(){{ var A = all(); if(Object.keys(T).length) A[slug] = {{d: today, t: T}}; else delete A[slug]; try{{ localStorage.setItem(K, JSON.stringify(A)); }}catch(e){{}} }}
  function draw(){{ var n = 0, k = 0, any = false; document.querySelectorAll(".tk").forEach(function(b){{ var on = !!T[b.getAttribute("data-n")]; b.setAttribute("aria-pressed", String(on)); if(on) any = true; if(!b.closest(".extras")){{ n++; if(on) k++; }} }});
    P.querySelector("i").style.width = (n ? Math.round(100 * k / n) : 0) + "%"; P.querySelector(".pn").textContent = n && k === n ? "All done! ⭐" : k + " of " + n + " done"; P.classList.toggle("all", !!n && k === n);
    P.querySelector("[data-again]").hidden = !any; document.getElementById("done").hidden = !(n && k === n); }}
  document.addEventListener("click", function(ev){{ var b = ev.target.closest(".tk"); if(b){{ var nm = b.getAttribute("data-n"); if(T[nm]) delete T[nm]; else T[nm] = 1; store(); draw(); return; }}
    if(ev.target.closest("[data-again]")){{ T = {{}}; store(); draw(); window.scrollTo({{top: 0, behavior: "smooth"}}); }} }});
  draw(); }})();
</script>
</body>
</html>
"""

def card(t):
    return f'<a href="/lists/{e(t["slug"])}"><b>{e(t["name"])}</b><small>{e(t["blurb"])}</small><span>{len(t["items"])} jobs</span></a>'

out = os.path.join(ROOT, "lists")
os.makedirs(out, exist_ok=True)
for f in os.listdir(out):
    if f.endswith(".html"): os.remove(os.path.join(out, f))   # only pages this script made
pages = []

for t in TRIPS:
    groups = []
    for b in BAGS:
        its = [n for n in t["items"] if when(t, n) == b[0]]
        if its: groups.append((b, its))
    assert sum(len(i) for _, i in groups) == len(t["items"]), t["name"]
    link = f'{SITE}/lists/{t["slug"]}'
    body = [f'<h1>{e(t["name"])}</h1><p class="lead">{e(t["blurb"])}</p>']
    body.append(f'<p class="acts2"><a class="add" href="/#list={e(t["slug"])}">＋ Add to my list</a><a class="add keepb" href="/#keep={e(t["slug"])}">★ Save to Projects</a><button type="button" data-share="{e(link)}">Share</button><button type="button" onclick="print()">Print</button></p>')
    body.append(f'<div class="prog" id="prog" data-slug="{e(t["slug"])}" data-daily="1"><div class="pbar"><i></i></div><div class="pt"><span class="pn">0 done</span><button type="button" data-again="1" hidden>Start again</button></div></div>')
    body.append('<div class="card">')
    tk = lambda n: f'<li><button class="tk" type="button" data-n="{e(n)}" aria-pressed="false">{e(n)}</button></li>'
    for b, its in groups:
        sub = f' <small>– {e(b[2])}</small>' if b[2] else ""
        body.append(f'<h2>{e(b[1])}{sub}</h2><ul class="items chk">{"".join(tk(n) for n in its)}</ul>')
    body.append("</div>")
    body.append('<div class="done" id="done" hidden>All done! ⭐<small>Well done. It starts fresh again tomorrow.</small></div>')
    others = [x for x in TRIPS if x is not t and bool(x.get("named")) == bool(t.get("named"))]
    body.append('<h2>More ready-made lists</h2><div class="lists">' + "".join(card(x) for x in others) + "</div>")
    desc = f'{t["name"]}: {t["blurb"]} {len(t["items"])} jobs, sorted by when. Tick them off on your phone – free, no account.'
    open(os.path.join(out, t["slug"] + ".html"), "w", encoding="utf-8").write(
        page("lists/" + t["slug"], f'{t["name"]} – to-do list | DobyToday', desc, "\n".join(body),
             [("DobyToday", "/"), ("Ready-made lists", "/lists/"), (t["name"], None)]))
    pages.append("lists/" + t["slug"])

body = ('<h1>Ready-made lists</h1><p class="lead">Open one and tick the jobs off as you go, or add it to your own list for today. Everything is sorted by when.</p>'
        '<h2>Days</h2><div class="lists">' + "".join(card(t) for t in TRIPS if not t.get("named")) + "</div>"
        '<h2>Lists for particular people</h2><div class="lists">' + "".join(card(t) for t in TRIPS if t.get("named")) + "</div>")
open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(
    page("lists/", "Ready-made to-do lists | DobyToday", "Free ready-made to-do lists sorted by when: a school day, a Sunday reset, an Airbnb changeover, chores and more.", body,
         [("DobyToday", "/"), ("Ready-made lists", None)]))
pages.insert(0, "lists/")


# ---------- my-list.html: a tick-off page for a list someone saved themselves (the list travels in the link: /my-list#…) ----------
def build_my_list(site_name, word, daily):
    body = """<h1 id="mlT">Your list</h1><p class="lead" id="mlL">Tick things off as you go – the ticks stay on this phone.</p>
<p class="acts2"><button type="button" id="mlShare" data-share="">Share</button><button type="button" onclick="print()">Print</button></p>
<div class="prog" id="prog" data-slug="my" data-daily="DAILY"><div class="pbar"><i></i></div><div class="pt"><span class="pn">0 WORD</span><button type="button" data-again="1" hidden>Start again</button></div></div>
<div class="card" id="mlBody"></div>
<div class="done" id="done" hidden>DONE<small>DONESUB</small></div>
<p class="lead" style="font-size:.88rem">This is a list someone saved on SITE. Only people with this link can see it.</p>
<script>
(function(){ var d = null; try{ d = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(1).replace(/-/g, "+").replace(/_/g, "/"))))); }catch(e){}
  function $(i){ return document.getElementById(i); } function x(s){ var t = document.createElement("i"); t.textContent = s; return t.innerHTML.replace(/"/g, "&quot;"); }
  if(!d || !d.g){ $("mlT").textContent = "This link looks incomplete"; $("mlL").textContent = "Ask the person who sent it to share it again."; $("mlBody").hidden = true; $("prog").hidden = true; $("mlShare").parentNode.hidden = true; return; }
  $("mlT").textContent = d.n; document.title = d.n + " – checklist | SITE";
  $("prog").setAttribute("data-slug", "my-" + (d.i || d.n)); $("mlShare").setAttribute("data-share", location.href);
  $("mlBody").innerHTML = d.g.map(function(g){ return "<h2>" + x(g[0]) + (g[1] ? " <small>– " + x(g[1]) + "</small>" : "") + "</h2><ul class=\\"items chk\\">"
    + g[2].map(function(r){ return "<li><button class=\\"tk\\" type=\\"button\\" data-n=\\"" + x(r[0] + (r[1] ? " – " + r[1] : "")) + "\\" aria-pressed=\\"false\\"><span>" + x(r[0]) + (r[1] ? "<small class=\\"tn\\">" + x(r[1]) + "</small>" : "") + "</span></button></li>"; }).join("") + "</ul>"; }).join(""); })();
</script>"""
    done = "All " + word + "! ⭐"
    body = (body.replace("DAILY", "1" if daily else "0").replace("DONESUB", "Well done. It starts fresh again tomorrow." if daily else "Well done. Press Start again to use it next time.")
            .replace("DONE", done).replace("WORD", word).replace("SITE", site_name))
    h = page("my-list", "Your list | " + site_name, "A list saved on " + site_name + ", to tick off on your phone.", body, [(site_name, "/"), ("Your list", None)])
    h = h.replace('<meta name="viewport"', '<meta name="robots" content="noindex">\n<meta name="viewport"', 1)
    h = h.replace("</style>", ".tk .tn{display:block;font-size:.85rem;color:var(--muted);text-decoration:none;font-weight:400}\n</style>", 1)
    open(os.path.join(ROOT, "my-list.html"), "w", encoding="utf-8").write(h)
build_my_list("DobyToday", "done", True)

today = datetime.date.today().isoformat()
urls = [""] + pages
open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8").write(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + "".join(f"  <url>\n    <loc>{SITE}/{u}</loc>\n    <lastmod>{today}</lastmod>\n  </url>\n" for u in urls) + "</urlset>\n")
print(f"Built {len(pages)} pages in lists/ and updated sitemap.xml")
