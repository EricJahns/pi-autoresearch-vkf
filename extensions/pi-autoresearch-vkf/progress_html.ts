/**
 * The interactive "progress as it goes" dashboard for an autoresearch run.
 *
 * This module emits a **static HTML shell** (inline CSS + an inline vanilla-JS
 * app, no build step, no external assets, no dependencies). The shell renders from
 * a JSON payload — bootstrapped inline for the first paint, then re-fetched from a
 * `data.json` sidecar on an interval so an open tab tracks the run live *in place*,
 * preserving the user's filters, scroll, and selection (unlike a whole-page
 * `<meta refresh>`).
 *
 * Data is built separately in {@link ./progress_data.ts}; this file is the view.
 * The companion {@link ./vkf.ts} `vkf html` output (dashboard.html) remains the
 * typed idea-lineage graph; this is the metrics/search-tree view.
 */
import type { DashboardData } from "./progress_data.ts";

export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Embed JSON inside a <script> safely (neutralize `</script>` and friends). */
function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const STYLES = `
  :root {
    color-scheme: light dark;
    --bg:#f6f8fa; --fg:#1f2328; --muted:#57606a; --dim:#8c959f;
    --panel:#fff; --border:#d0d7de; --line:#eaeef2; --chip:#eaeef2; --accent:#0969da;
  }
  :root[data-theme="dark"] {
    --bg:#0d1117; --fg:#e6edf3; --muted:#9da7b3; --dim:#6e7681;
    --panel:#161b22; --border:#30363d; --line:#21262d; --chip:#21262d; --accent:#4493f8;
  }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; margin:0; background:var(--bg); color:var(--fg); }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 20px 20px 80px; }
  header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 13px; margin: 26px 0 10px; color: var(--muted); text-transform: uppercase; letter-spacing:.04em; }
  .goal { color: var(--muted); margin: 0; }
  .toolbtn { background:var(--panel); color:var(--fg); border:1px solid var(--border); border-radius:6px; padding:6px 10px; cursor:pointer; font:inherit; }
  .toolbtn:hover { border-color:var(--accent); }
  .cards { display:flex; gap:12px; flex-wrap:wrap; margin-top:14px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:10px 16px; min-width:110px; }
  .card .k { font-size:12px; color:var(--muted); }
  .card .v { font-size:22px; font-weight:600; }
  .panel { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:16px; position:relative; }
  .grid2 { display:grid; grid-template-columns: 2fr 1fr; gap:16px; align-items:start; }
  @media (max-width: 820px){ .grid2 { grid-template-columns: 1fr; } }
  .controls { display:flex; gap:14px; flex-wrap:wrap; align-items:center; margin-bottom:10px; font-size:12px; color:var(--muted); }
  .controls label { display:inline-flex; gap:4px; align-items:center; cursor:pointer; }
  select { background:var(--panel); color:var(--fg); border:1px solid var(--border); border-radius:6px; padding:3px 6px; font:inherit; }
  table { width:100%; border-collapse: collapse; }
  th, td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; cursor:pointer; user-select:none; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; }
  .dim { color:var(--dim); }
  .badge { color:#fff; border-radius:10px; padding:1px 8px; font-size:11px; text-transform:uppercase; letter-spacing:.03em; }
  .kept { color:#2ea043; font-size:11px; font-weight:600; }
  .chip { display:inline-block; background:var(--chip); border-radius:12px; padding:2px 10px; margin:2px 4px 2px 0; }
  .axis { font-size:10px; fill:var(--dim); font-family: ui-monospace, monospace; }
  .empty { color:var(--dim); padding:24px; text-align:center; }
  ul { margin:0; padding-left:18px; }
  footer { margin-top:32px; color:var(--dim); font-size:12px; }
  a { color:var(--accent); }
  .node { cursor:pointer; }
  .node:hover circle { stroke:var(--accent); stroke-width:2; }
  .node.sel circle { stroke:var(--accent); stroke-width:3; }
  .heat td { text-align:center; font-variant-numeric: tabular-nums; }
  .belief { height:8px; background:var(--line); border-radius:5px; overflow:hidden; margin-top:3px; }
  .belief > i { display:block; height:100%; background:var(--accent); }
  #tip { position:fixed; pointer-events:none; background:var(--panel); border:1px solid var(--border); border-radius:6px; padding:4px 8px; font-size:12px; box-shadow:0 2px 8px rgba(0,0,0,.18); opacity:0; transition:opacity .08s; z-index:10; }
  .live { font-size:11px; color:var(--dim); }
  .live b { color:#2ea043; }
  .pill { font-size:10px; border:1px solid var(--border); border-radius:8px; padding:0 6px; color:var(--muted); }
`;

// The client app. Each entry is one line; using double-quoted entries lets the
// client code use backticks/`${...}` template literals freely (they are literal
// characters here, not interpolated by this module's own template strings).
const APP_JS: string = [
  "(function(){",
  "  'use strict';",
  "  var OUTCOME = {win:'#2ea043', loss:'#cf222e', inconclusive:'#9a6700', pending:'#57606a'};",
  "  var PALETTE = ['#0969da','#8250df','#bf3989','#1a7f37','#9a6700','#cf222e'];",
  "  var boot = document.getElementById('vkf-data');",
  "  var state = {}; try { state = JSON.parse(boot.textContent||'{}'); } catch(e){}",
  "  var ui = loadUI();",
  "",
  "  function defaults(){ return {theme:'auto', series:null, log:false, fOutcome:'all', fLever:'all', fKept:'all', sortKey:'id', sortDir:1, selected:null}; }",
  "  function loadUI(){ try { return Object.assign(defaults(), JSON.parse(localStorage.getItem('vkfui')||'{}')); } catch(e){ return defaults(); } }",
  "  function saveUI(){ try { localStorage.setItem('vkfui', JSON.stringify(ui)); } catch(e){} }",
  "  function esc(s){ return String(s==null?'':s).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c];}); }",
  "  function num(v){ return (v==null||isNaN(v))?'\\u2014':(Number.isInteger(v)?String(v):String(Number(v.toFixed(4)))); }",
  "  function byId(id){ return document.getElementById(id); }",
  "  function expsById(){ var m={}; (state.experiments||[]).forEach(function(e){ m[e.id]=e; }); return m; }",
  "",
  "  // Default series visibility: primary metric only, first time we see the list.",
  "  function ensureSeries(){ if(ui.series && typeof ui.series==='object'){ (state.metricNames||[]).forEach(function(n){ if(!(n in ui.series)) ui.series[n] = (n===state.metricName); }); return; } ui.series={}; (state.metricNames||[]).forEach(function(n){ ui.series[n] = (n===state.metricName); }); }",
  "",
  "  function applyTheme(){ var t = ui.theme; if(t==='auto'){ document.documentElement.removeAttribute('data-theme'); } else { document.documentElement.setAttribute('data-theme', t); } }",
  "",
  "  // ---- stat cards ----",
  "  function renderCards(){ var e=state.experiments||[]; var w=0,l=0,inc=0; e.forEach(function(x){ if(x.outcome==='win')w++; else if(x.outcome==='loss')l++; else if(x.outcome==='inconclusive')inc++; });",
  "    byId('cards').innerHTML = card('Best '+esc(state.metricName)+' ('+esc(state.direction)+')', num(state.best)) + card('Wins', w, OUTCOME.win) + card('Losses', l, OUTCOME.loss) + card('Inconclusive', inc, OUTCOME.inconclusive) + card('Experiments', e.length); }",
  "  function card(k,v,color){ return \"<div class='card'><div class='k'>\"+k+\"</div><div class='v' \"+(color?(\"style='color:\"+color+\"'\"):'')+\">\"+v+\"</div></div>\"; }",
  "",
  "  // ---- metric chart ----",
  "  function renderSeriesToggles(){ var names=state.metricNames||[]; var html = names.map(function(n,i){ var on = ui.series[n]?'checked':''; var c = (n===state.metricName)?'#0969da':PALETTE[i%PALETTE.length]; return \"<label><input type='checkbox' \"+on+\" onchange=\\\"VKF.series('\"+esc(n)+\"',this.checked)\\\"><span style='color:\"+c+\"'>\\u25cf</span>\"+esc(n)+\"</label>\"; }).join(' ');",
  "    html += \"<label><input type='checkbox' \"+(ui.log?'checked':'')+\" onchange='VKF.log(this.checked)'>log scale</label>\";",
  "    byId('series').innerHTML = html; }",
  "  function renderChart(){ var W=760,H=260,pad={l:52,r:18,t:14,b:28}; var iw=W-pad.l-pad.r, ih=H-pad.t-pad.b; var exps=state.experiments||[];",
  "    var sel = (state.metricNames||[]).filter(function(n){ return ui.series[n]; }); if(sel.length===0) sel=[state.metricName];",
  "    var vals=[]; exps.forEach(function(e){ sel.forEach(function(n){ var v=e.metrics&&e.metrics[n]; if(v!=null&&!isNaN(v)) vals.push(v); }); }); if(state.baseline!=null) vals.push(state.baseline);",
  "    if(vals.length===0){ byId('chart').innerHTML = \"<div class='empty'>No measured experiments yet \\u2014 the chart appears once results are logged.</div>\"; return; }",
  "    var useLog = ui.log && vals.every(function(v){ return v>0; });",
  "    var tf = function(v){ return useLog?Math.log10(v):v; }; var tvals=vals.map(tf); var min=Math.min.apply(null,tvals), max=Math.max.apply(null,tvals); if(min===max){ min-=1; max+=1; }",
  "    var n=exps.length; var x=function(i){ return pad.l + (n<=1?iw/2:(i/(n-1))*iw); }; var y=function(v){ return pad.t + ih - ((tf(v)-min)/(max-min))*ih; };",
  "    var svg = \"<svg id='chartsvg' viewBox='0 0 \"+W+\" \"+H+\"' width='100%' preserveAspectRatio='xMidYMid meet'>\";",
  "    svg += \"<rect x='\"+pad.l+\"' y='\"+pad.t+\"' width='\"+iw+\"' height='\"+ih+\"' fill='none' stroke='var(--border)'/>\";",
  "    [min,(min+max)/2,max].forEach(function(tv){ var rv = useLog?Math.pow(10,tv):tv; var yy=(pad.t+ih-((tv-min)/(max-min))*ih); svg += \"<text x='\"+(pad.l-6)+\"' y='\"+(yy+3).toFixed(1)+\"' text-anchor='end' class='axis'>\"+num(rv)+\"</text>\"; });",
  "    if(state.baseline!=null){ var yb=y(state.baseline); svg += \"<line x1='\"+pad.l+\"' y1='\"+yb.toFixed(1)+\"' x2='\"+(W-pad.r)+\"' y2='\"+yb.toFixed(1)+\"' stroke='var(--dim)' stroke-dasharray='4 3'/><text x='\"+(W-pad.r)+\"' y='\"+(yb-4).toFixed(1)+\"' text-anchor='end' class='axis'>baseline \"+num(state.baseline)+\"</text>\"; }",
  "    sel.forEach(function(name,si){ var color = (name===state.metricName)?'#0969da':PALETTE[si%PALETTE.length]; var pts=[]; exps.forEach(function(e,i){ var v=e.metrics&&e.metrics[name]; if(v!=null&&!isNaN(v)) pts.push({i:i,v:v,e:e}); }); if(pts.length===0) return;",
  "      var d = pts.map(function(p,k){ return (k===0?'M':'L')+x(p.i).toFixed(1)+','+y(p.v).toFixed(1); }).join(' '); svg += \"<path d='\"+d+\"' fill='none' stroke='\"+color+\"' stroke-width='2'/>\";",
  "      pts.forEach(function(p){ var fill = (name===state.metricName)?(OUTCOME[p.e.outcome]||color):color; svg += \"<circle class='pt' cx='\"+x(p.i).toFixed(1)+\"' cy='\"+y(p.v).toFixed(1)+\"' r='4' fill='\"+fill+\"' data-label='\"+esc(p.e.id+' \\u00b7 '+name+'='+num(p.v)+' ('+p.e.outcome+')')+\"'/>\"; }); });",
  "    svg += \"<text x='\"+pad.l+\"' y='\"+(H-8)+\"' class='axis'>exp 1</text><text x='\"+(W-pad.r)+\"' y='\"+(H-8)+\"' text-anchor='end' class='axis'>exp \"+n+\"</text></svg>\";",
  "    byId('chart').innerHTML = svg; bindTips(byId('chart')); }",
  "",
  "  // ---- search tree ----",
  "  function renderTree(){ var exps=state.experiments||[]; if(exps.length===0){ byId('tree').innerHTML=\"<div class='empty'>The search tree appears once experiments are logged.</div>\"; return; }",
  "    var map=expsById(); var kids={}; var roots=[]; exps.forEach(function(e){ var p=e.parent_id; if(p&&map[p]){ (kids[p]=kids[p]||[]).push(e); } else { roots.push(e); } });",
  "    var maxDepth=0; exps.forEach(function(e){ if((e.depth||0)>maxDepth) maxDepth=e.depth||0; });",
  "    var order=[]; (function walk(list){ list.forEach(function(e){ order.push(e); walk(kids[e.id]||[]); }); })(roots);",
  "    var rowH=34, colW=150, pad=20; var W=pad*2+Math.max(1,maxDepth)*colW+120, H=pad*2+order.length*rowH;",
  "    var yOf={}; order.forEach(function(e,i){ yOf[e.id]=pad+i*rowH+10; });",
  "    var svg=\"<svg viewBox='0 0 \"+W+\" \"+H+\"' width='100%' preserveAspectRatio='xMinYMin meet' style='min-height:\"+Math.min(H,520)+\"px'>\";",
  "    exps.forEach(function(e){ if(e.parent_id&&map[e.parent_id]){ var x1=pad+(map[e.parent_id].depth||0)*colW+8, y1=yOf[e.parent_id], x2=pad+(e.depth||0)*colW+8, y2=yOf[e.id]; svg += \"<path d='M\"+x1+\",\"+y1+\" C\"+(x1+colW/2)+\",\"+y1+\" \"+(x2-colW/2)+\",\"+y2+\" \"+x2+\",\"+y2+\"' fill='none' stroke='var(--border)'/>\"; } });",
  "    order.forEach(function(e){ var cx=pad+(e.depth||0)*colW+8, cy=yOf[e.id]; var fill=OUTCOME[e.outcome]||'#57606a'; var selc=(ui.selected===e.id)?' sel':''; svg += \"<g class='node\"+selc+\"' onclick=\\\"VKF.sel('\"+esc(e.id)+\"')\\\">\";",
  "      svg += \"<circle cx='\"+cx+\"' cy='\"+cy+\"' r='6' fill='\"+fill+\"' stroke='var(--panel)'/>\"; svg += \"<text x='\"+(cx+12)+\"' y='\"+(cy+4)+\"' style='font-size:12px;fill:var(--fg)'>\"+esc(e.id)+(e.kept?' \\u2713':'')+\"</text>\";",
  "      svg += \"<text x='\"+(cx+12)+\"' y='\"+(cy+17)+\"' class='axis'>\"+esc((e.node_kind||'')+(e.value!=null?(' \\u00b7 '+num(e.value)):''))+\"</text></g>\"; });",
  "    svg += \"</svg>\"; byId('tree').innerHTML = svg; }",
  "",
  "  // ---- detail panel ----",
  "  function renderDetail(){ var box=byId('detail'); if(!ui.selected){ box.innerHTML=\"<div class='dim'>Click a node in the tree to inspect it.</div>\"; return; } var e=expsById()[ui.selected]; if(!e){ box.innerHTML=\"<div class='dim'>(node not found)</div>\"; return; }",
  "    var rows=''; rows += drow('id', e.id); rows += drow('outcome', e.outcome + (e.kept?' (kept)':'')); rows += drow('node', (e.node_kind||'\\u2014')+' \\u00b7 depth '+(e.depth||0)); rows += drow('parent', e.parent_id||'root'); rows += drow('claim', e.claim_id||'\\u2014'); rows += drow('value', num(e.value)+(e.baseline!=null?(' (baseline '+num(e.baseline)+')'):'')); if(e.lever||e.altitude) rows += drow('bucket', (e.lever||'?')+' \\u00b7 '+(e.altitude||'?')); if(e.commit) rows += drow('commit', e.commit);",
  "    var metrics = e.metrics?Object.keys(e.metrics).map(function(k){ return esc(k)+'='+num(e.metrics[k]); }).join(', '):'';",
  "    box.innerHTML = \"<div style='font-weight:600;margin-bottom:6px'>\"+esc(e.description)+\"</div><table>\"+rows+\"</table>\"+(metrics?(\"<div class='mono dim' style='margin-top:8px'>\"+metrics+\"</div>\"):'')+(e.notes?(\"<div style='margin-top:8px'>\"+esc(e.notes)+\"</div>\"):''); }",
  "  function drow(k,v){ return \"<tr><td class='dim' style='width:78px'>\"+k+\"</td><td class='mono'>\"+esc(v)+\"</td></tr>\"; }",
  "",
  "  // ---- coverage heatmap ----",
  "  function renderHeatmap(){ var cov=state.coverage; if(!cov){ byId('heatmap').innerHTML=''; return; } var max=0; Object.keys(cov.counts||{}).forEach(function(k){ if(cov.counts[k]>max) max=cov.counts[k]; });",
  "    var h=\"<table class='heat'><thead><tr><th></th>\"+cov.altitudes.map(function(a){ return \"<th>\"+esc(a)+\"</th>\"; }).join('')+\"</tr></thead><tbody>\";",
  "    cov.levers.forEach(function(l){ h += \"<tr><th style='text-align:left'>\"+esc(l)+\"</th>\"; cov.altitudes.forEach(function(a){ var key=l+'|'+a; var c=(cov.counts&&cov.counts[key])||0; var alpha = max>0?(0.12+0.7*c/max):0; var bg = c>0?(\"background:rgba(9,105,218,\"+alpha.toFixed(2)+\")\"):''; h += \"<td style='\"+bg+\"' title='\"+esc(l+' \\u00b7 '+a+': '+c)+\"'>\"+(c||'')+\"</td>\"; }); h += \"</tr>\"; });",
  "    h += \"</tbody></table><div class='dim' style='margin-top:6px;font-size:12px'>Experiments per lever \\u00d7 altitude bucket \\u2014 a hot row means the search is stuck in one corner.</div>\"; byId('heatmap').innerHTML=h; }",
  "",
  "  // ---- memory + beliefs ----",
  "  function renderMemory(){ var mem=state.memory||{}; var chips=Object.keys(mem).filter(function(k){ return mem[k]>0; }).map(function(k){ return \"<span class='chip'>\"+esc(k)+\": <b>\"+mem[k]+\"</b></span>\"; }).join(' ');",
  "    var claims=(state.claims||[]).map(function(c){ var pct=Math.round((c.belief||0)*100); return \"<li><b>\"+esc(c.title)+\"</b> <span class='dim'>\\u2014 \"+esc(c.state)+\"</span><div class='belief'><i style='width:\"+pct+\"%'></i></div><span class='dim' style='font-size:12px'>belief \"+pct+\"%</span></li>\"; }).join('');",
  "    byId('memory').innerHTML = (chips||\"<span class='dim'>empty \\u2014 gather and verify some claims</span>\") + (claims?(\"<ul style='margin-top:12px;list-style:none;padding:0'>\"+claims+\"</ul>\"):''); }",
  "",
  "  // ---- experiment table ----",
  "  function levers(){ var s={}; (state.experiments||[]).forEach(function(e){ if(e.lever) s[e.lever]=1; }); return Object.keys(s); }",
  "  function renderFilters(){ var f=\"Outcome <select onchange='VKF.filter(\\\"fOutcome\\\",this.value)'>\"+opts(['all','win','loss','inconclusive','pending'],ui.fOutcome)+\"</select>\";",
  "    f += \" Lever <select onchange='VKF.filter(\\\"fLever\\\",this.value)'>\"+opts(['all'].concat(levers()),ui.fLever)+\"</select>\";",
  "    f += \" Kept <select onchange='VKF.filter(\\\"fKept\\\",this.value)'>\"+opts(['all','yes','no'],ui.fKept)+\"</select>\"; byId('filters').innerHTML=f; }",
  "  function opts(arr,cur){ return arr.map(function(o){ return \"<option \"+(o===cur?'selected':'')+\" value='\"+esc(o)+\"'>\"+esc(o)+\"</option>\"; }).join(''); }",
  "  function filteredRows(){ var rows=(state.experiments||[]).slice(); rows=rows.filter(function(e){ if(ui.fOutcome!=='all'&&e.outcome!==ui.fOutcome) return false; if(ui.fLever!=='all'&&e.lever!==ui.fLever) return false; if(ui.fKept!=='all'&&((ui.fKept==='yes')!==(e.kept===true))) return false; return true; });",
  "    var k=ui.sortKey, dir=ui.sortDir; rows.sort(function(a,b){ var va=a[k], vb=b[k]; if(k==='value'){ va=va==null?-Infinity:va; vb=vb==null?-Infinity:vb; } if(va<vb) return -dir; if(va>vb) return dir; return 0; }); return rows; }",
  "  function renderTable(){ var rows=filteredRows(); var head=['id','outcome','value','description','claim_id'].map(function(h){ var ar=ui.sortKey===h?(ui.sortDir>0?' \\u25b2':' \\u25bc'):''; return \"<th onclick=\\\"VKF.sort('\"+h+\"')\\\">\"+h+ar+\"</th>\"; }).join('');",
  "    var body = rows.length? rows.map(function(e){ var b=\"<span class='badge' style='background:\"+(OUTCOME[e.outcome]||'#57606a')+\"'>\"+esc(e.outcome)+\"</span>\"+(e.kept?\" <span class='kept'>kept</span>\":''); return \"<tr style='cursor:pointer' onclick=\\\"VKF.sel('\"+esc(e.id)+\"')\\\"><td class='mono'>\"+esc(e.id)+\"</td><td>\"+b+\"</td><td class='mono'>\"+num(e.value)+\"</td><td>\"+esc(e.description)+\"</td><td class='mono dim'>\"+esc(e.claim_id||'')+\"</td></tr>\"; }).join('') : \"<tr><td colspan='5' class='empty'>No experiments match the filters.</td></tr>\";",
  "    byId('table').innerHTML = \"<table><thead><tr>\"+head+\"</tr></thead><tbody>\"+body+\"</tbody></table>\"; }",
  "",
  "  // ---- chart tooltip ----",
  "  function bindTips(scope){ var tip=byId('tip'); scope.querySelectorAll('.pt').forEach(function(c){ c.addEventListener('mousemove',function(ev){ tip.textContent=c.getAttribute('data-label'); tip.style.left=(ev.clientX+12)+'px'; tip.style.top=(ev.clientY+12)+'px'; tip.style.opacity=1; }); c.addEventListener('mouseleave',function(){ tip.style.opacity=0; }); }); }",
  "",
  "  function render(){ ensureSeries(); renderCards(); renderSeriesToggles(); renderChart(); renderTree(); renderDetail(); renderHeatmap(); renderMemory(); renderFilters(); renderTable(); var g=byId('gen'); if(g) g.textContent=state.generatedAt||''; var v=byId('ver'); if(v) v.textContent=state.version?('v'+state.version):''; }",
  "",
  "  window.VKF = {",
  "    series:function(n,on){ ui.series[n]=on; saveUI(); renderSeriesToggles(); renderChart(); },",
  "    log:function(on){ ui.log=on; saveUI(); renderChart(); },",
  "    sel:function(id){ ui.selected=id; saveUI(); renderTree(); renderDetail(); },",
  "    filter:function(k,v){ ui[k]=v; saveUI(); renderTable(); },",
  "    sort:function(k){ if(ui.sortKey===k) ui.sortDir=-ui.sortDir; else { ui.sortKey=k; ui.sortDir=1; } saveUI(); renderTable(); },",
  "    theme:function(){ ui.theme = ui.theme==='dark'?'light':(ui.theme==='light'?'auto':'dark'); saveUI(); applyTheme(); var b=byId('themebtn'); if(b) b.textContent='Theme: '+ui.theme; }",
  "  };",
  "",
  "  applyTheme(); var tb=byId('themebtn'); if(tb) tb.textContent='Theme: '+ui.theme; render();",
  "",
  "  // ---- live polling of the data.json sidecar ----",
  "  var rs = state.refreshSeconds||0; if(rs>0){ setInterval(function(){ fetch('data.json?t='+Date.now(),{cache:'no-store'}).then(function(r){ return r.ok?r.json():null; }).then(function(d){ if(d){ state=d; render(); var li=byId('live'); if(li){ li.innerHTML='<b>\\u25cf</b> live'; setTimeout(function(){ if(li) li.textContent='updated '+new Date().toLocaleTimeString(); }, 800); } } }).catch(function(){}); }, rs*1000); }",
  "})();",
].join("\n");

/**
 * Render the full interactive dashboard document. The payload is bootstrapped
 * inline for the first paint; the page then polls `data.json` (written next to it)
 * every `refreshSeconds` and re-renders in place.
 */
export function renderDashboardHtml(data: DashboardData): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>pi-autoresearch-vkf — ${escapeHtml(data.name)}</title>
<style>${STYLES}</style>
</head>
<body>
<div id="tip"></div>
<div class="wrap">
  <header>
    <div>
      <h1>pi-autoresearch-vkf · ${escapeHtml(data.name)}</h1>
      <p class="goal">${escapeHtml(data.goal)}</p>
    </div>
    <div style="text-align:right">
      <button id="themebtn" class="toolbtn" onclick="VKF.theme()">Theme</button>
      <div id="live" class="live" style="margin-top:6px">${data.refreshSeconds > 0 ? `auto-refreshes every ${data.refreshSeconds}s` : "static"}</div>
    </div>
  </header>

  <div id="cards" class="cards"></div>

  <div class="grid2" style="margin-top:10px">
    <div>
      <h2>${escapeHtml(data.metricName)} over time</h2>
      <div class="panel">
        <div id="series" class="controls"></div>
        <div id="chart"></div>
      </div>

      <h2>Search tree</h2>
      <div class="panel" style="overflow:auto; max-height:560px"><div id="tree"></div></div>
    </div>

    <div>
      <h2>Selected node</h2>
      <div class="panel"><div id="detail"></div></div>

      <h2>Coverage</h2>
      <div class="panel"><div id="heatmap"></div></div>

      <h2>Research memory</h2>
      <div class="panel"><div id="memory"></div></div>
    </div>
  </div>

  <h2>Experiments</h2>
  <div class="panel">
    <div id="filters" class="controls"></div>
    <div id="table"></div>
  </div>

  <footer>
    <span id="ver" class="pill"></span>
    Generated <span id="gen"></span> ·
    full idea-lineage graph (paper → claim → experiment): open <span class="mono">dashboard.html</span> (<span class="mono">vkf html</span>).
  </footer>
</div>
<script id="vkf-data" type="application/json">${embedJson(data)}</script>
<script>${APP_JS}</script>
</body>
</html>`;
}
