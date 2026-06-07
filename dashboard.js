// ============================================================
// DASHBOARD ROUTE — server-side (Secret key works here)
// Mounts /dashboard on the bot's Express app.
// Password-protected. PC + Mobile. Live Supabase data.
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Admin password — from env, fallback to ADMIN_PHONE, else a default
const DASH_PASSWORD = process.env.DASHBOARD_PASSWORD || process.env.ADMIN_PHONE || 'smartpath2026';

function registerDashboard(app) {

  // ---- API: returns students JSON (only with correct password) ----
  app.get('/dashboard/data', async (req, res) => {
    if ((req.query.pw || '') !== DASH_PASSWORD) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      const { data, error } = await supabase
        .from('students').select('*').order('start_date', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ students: data || [] });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ---- Dashboard HTML page ----
  app.get('/dashboard', (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(DASHBOARD_HTML);
  });
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SmartPath ಕಲಿಕೆ — Admin Dashboard</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/chart.js/4.4.1/chart.umd.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=JetBrains+Mono:wght@500;700&family=Noto+Sans+Kannada:wght@600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#0a0e1a;--panel:#121829;--panel2:#1a2236;--line:#26304a;--ink:#e8edf7;--muted:#8493b0;--navy:#1b6fd4;--green:#2da844;--green2:#3dde6e;--gold:#f5b324;--red:#ef5b6b;--purple:#8b5cf6}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Sora',sans-serif;background:var(--bg);color:var(--ink);background-image:radial-gradient(900px 500px at 85% -10%,rgba(27,111,212,.12),transparent),radial-gradient(700px 400px at 0% 100%,rgba(45,168,68,.08),transparent);min-height:100vh;padding:18px}
.kn{font-family:'Noto Sans Kannada',sans-serif}
.mono{font-family:'JetBrains Mono',monospace}
.wrap{max-width:1200px;margin:0 auto}
.head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:22px}
.brand{display:flex;align-items:center;gap:12px}
.logo{width:46px;height:46px;border-radius:13px;background:linear-gradient(135deg,var(--navy),var(--green));display:flex;align-items:center;justify-content:center;font-size:24px;box-shadow:0 6px 20px rgba(27,111,212,.4)}
.brand h1{font-size:20px;font-weight:800}.brand p{font-size:12px;color:var(--muted)}
.refresh{background:var(--panel2);border:1px solid var(--line);color:var(--ink);padding:10px 18px;border-radius:11px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:7px;transition:.2s}
.refresh:hover{border-color:var(--green);color:var(--green2)}
.gate{max-width:420px;margin:60px auto;background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:34px}
.gate h2{font-size:20px;margin-bottom:6px}.gate p{font-size:13px;color:var(--muted);margin-bottom:22px}
.gate label{font-size:12px;font-weight:700;color:var(--muted);display:block;margin:14px 0 6px;text-transform:uppercase;letter-spacing:.5px}
.gate input{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:11px;padding:13px 15px;color:var(--ink);font-family:'JetBrains Mono',monospace;font-size:14px}
.gate input:focus{outline:none;border-color:var(--navy)}
.gate button{width:100%;margin-top:22px;background:linear-gradient(135deg,var(--navy),var(--green));color:#fff;border:none;padding:15px;border-radius:12px;font-weight:800;font-size:15px;cursor:pointer;font-family:inherit}
.gate .err{color:var(--red);font-size:13px;margin-top:14px;text-align:center;min-height:18px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:18px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px;position:relative;overflow:hidden}
.stat::before{content:"";position:absolute;top:0;left:0;width:100%;height:3px;background:var(--accent,var(--navy))}
.stat .ic{font-size:20px;margin-bottom:8px}.stat .num{font-size:30px;font-weight:800;font-family:'JetBrains Mono',monospace;line-height:1}
.stat .lbl{font-size:12px;color:var(--muted);margin-top:5px;font-weight:600}
.stat.g{--accent:var(--green)}.stat.gold{--accent:var(--gold)}.stat.red{--accent:var(--red)}.stat.p{--accent:var(--purple)}.stat.b{--accent:var(--navy)}
.grid{display:grid;grid-template-columns:1.3fr 1fr;gap:18px;margin-bottom:18px}
@media(max-width:880px){.grid{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px}
.card h3{font-size:15px;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px}
.card h3 .tag{margin-left:auto;font-size:11px;color:var(--muted);font-weight:600}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;padding:8px 10px;border-bottom:1px solid var(--line);font-weight:700}
td{padding:11px 10px;border-bottom:1px solid var(--line)}
tr:last-child td{border-bottom:none}tr:hover td{background:var(--panel2)}
.code-pill{font-family:'JetBrains Mono',monospace;background:var(--panel2);padding:3px 9px;border-radius:7px;font-size:12px;font-weight:700;color:var(--green2)}
.badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700}
.badge.active{background:rgba(45,222,110,.15);color:var(--green2)}
.badge.trial{background:rgba(245,179,36,.15);color:var(--gold)}
.badge.blocked{background:rgba(239,91,107,.15);color:var(--red)}
.bar-mini{height:6px;background:var(--panel2);border-radius:4px;overflow:hidden;margin-top:5px}
.bar-mini i{display:block;height:100%;background:linear-gradient(90deg,var(--navy),var(--green))}
.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.toolbar input,.toolbar select{background:var(--panel);border:1px solid var(--line);color:var(--ink);padding:10px 14px;border-radius:10px;font-family:inherit;font-size:13px}
.toolbar input{flex:1;min-width:160px}.toolbar input:focus,.toolbar select:focus{outline:none;border-color:var(--navy)}
.btn-export{background:var(--green);color:#fff;border:none;padding:10px 16px;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit}
.full-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px}
.scroll-x{overflow-x:auto}.loading{text-align:center;padding:40px;color:var(--muted)}
.empty{text-align:center;padding:30px;color:var(--muted);font-size:13px}
.chart-box{position:relative;height:240px}.hide{display:none}
.alert-row{display:flex;align-items:center;gap:10px;padding:10px;border-radius:10px;background:var(--panel2);margin-bottom:8px;font-size:13px}
.alert-row .d{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--gold)}
</style>
</head>
<body>
<div class="wrap">
  <div id="gate" class="gate">
    <h2>🎓 SmartPath Admin</h2>
    <p>Dashboard ನೋಡೋಕೆ password ಹಾಕಿ.</p>
    <label>Password</label>
    <input id="pw" type="password" placeholder="Admin password" onkeydown="if(event.key==='Enter')login()">
    <button onclick="login()">Dashboard ತೆರೆ →</button>
    <div class="err" id="loginErr"></div>
  </div>

  <div id="dash" class="hide">
    <div class="head">
      <div class="brand"><div class="logo">🎓</div><div><h1>SmartPath <span class="kn">ಕಲಿಕೆ</span></h1><p>Admin Dashboard · School-wise Report</p></div></div>
      <button class="refresh" onclick="loadAll()">🔄 Refresh</button>
    </div>
    <div class="stats" id="statCards"></div>
    <div class="grid">
      <div class="card"><h3>🏫 School-wise Report <span class="tag" id="schCount"></span></h3>
        <div class="toolbar" style="margin-bottom:12px"><input id="schFilter" placeholder="🔍 School code type ಮಾಡಿ (e.g. GHS10A) — ಆ school ಮಾತ್ರ" oninput="renderSchools()"></div>
        <div class="scroll-x"><table id="schoolTable"><thead><tr><th>Code</th><th>School</th><th>Total</th><th>Active</th><th>Trial</th><th>Rate</th></tr></thead><tbody><tr><td colspan="6" class="loading">Loading…</td></tr></tbody></table></div></div>
      <div class="card"><h3>📚 Class-wise</h3><div class="chart-box"><canvas id="classChart"></canvas></div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>💎 Plan Distribution</h3><div class="chart-box"><canvas id="planChart"></canvas></div></div>
      <div class="card"><h3>🔔 Expiring Soon (next 2 days)</h3><div id="expiringList"><div class="loading">Loading…</div></div></div>
    </div>
    <div class="full-card">
      <h3 style="margin-bottom:14px">👥 All Students</h3>
      <div class="toolbar">
        <input id="search" placeholder="🔍 Search name / phone / school code…" oninput="renderStudents()">
        <select id="fStatus" onchange="renderStudents()"><option value="">All Status</option><option value="ACTIVE">Active</option><option value="TRIAL">Trial</option><option value="BLOCKED">Blocked</option></select>
        <select id="fClass" onchange="renderStudents()"><option value="">All Class</option><option value="8">Class 8</option><option value="9">Class 9</option><option value="10">Class 10</option></select>
        <button class="btn-export" onclick="exportCSV()">📤 Export CSV</button>
      </div>
      <div class="scroll-x"><table id="studentTable"><thead><tr><th>Name</th><th>Phone</th><th>Class</th><th>School Code</th><th>RegNo</th><th>Status</th><th>Plan</th><th>Expiry</th></tr></thead><tbody></tbody></table></div>
    </div>
  </div>
</div>
<script>
let PW='',students=[],classChart=null,planChart=null;
async function login(){
  PW=document.getElementById('pw').value.trim();
  const err=document.getElementById('loginErr');
  if(!PW){err.textContent='Password ಹಾಕಿ';return;}
  err.textContent='Checking…';
  const r=await fetch('/dashboard/data?pw='+encodeURIComponent(PW));
  if(r.status===401){err.textContent='❌ Password ತಪ್ಪು';return;}
  if(!r.ok){err.textContent='⚠️ Error, ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ';return;}
  const j=await r.json();
  students=j.students||[];
  document.getElementById('gate').classList.add('hide');
  document.getElementById('dash').classList.remove('hide');
  renderAll();
}
async function loadAll(){
  const r=await fetch('/dashboard/data?pw='+encodeURIComponent(PW));
  if(!r.ok){alert('Reload failed');return;}
  const j=await r.json();students=j.students||[];renderAll();
}
function renderAll(){renderStats();renderSchools();renderClassChart();renderPlanChart();renderExpiring();renderStudents();}
function isExpired(s){return s.expiry_date&&new Date()>new Date(s.expiry_date);}
function effStatus(s){const st=(s.status||'').toUpperCase();if(st==='BLOCKED')return 'BLOCKED';if(st==='TRIAL'&&isExpired(s))return 'BLOCKED';return st;}
function renderStats(){
  const total=students.length;
  const active=students.filter(s=>effStatus(s)==='ACTIVE').length;
  const trial=students.filter(s=>effStatus(s)==='TRIAL').length;
  const blocked=students.filter(s=>effStatus(s)==='BLOCKED').length;
  const today=new Date().toISOString().split('T')[0];
  const newToday=students.filter(s=>(s.start_date||'')===today).length;
  const revenue=active*299;const rate=total?Math.round(active/total*100):0;
  const cards=[{ic:'👥',num:total,lbl:'Total Students',cls:'b'},{ic:'🟢',num:active,lbl:'Active (Paid)',cls:'g'},{ic:'🎁',num:trial,lbl:'On Trial',cls:'gold'},{ic:'🔒',num:blocked,lbl:'Blocked/Expired',cls:'red'},{ic:'🆕',num:newToday,lbl:'New Today',cls:'p'},{ic:'💰',num:'₹'+revenue.toLocaleString('en-IN'),lbl:'Est. Revenue/mo',cls:'g'},{ic:'📈',num:rate+'%',lbl:'Activation Rate',cls:'b'}];
  document.getElementById('statCards').innerHTML=cards.map(c=>'<div class="stat '+c.cls+'"><div class="ic">'+c.ic+'</div><div class="num">'+c.num+'</div><div class="lbl">'+c.lbl+'</div></div>').join('');
}
function renderSchools(){
  const map={};
  for(const s of students){const code=s.school_code||'(no code)';if(!map[code])map[code]={code,school:s.school||'—',total:0,active:0,trial:0};map[code].total++;const st=effStatus(s);if(st==='ACTIVE')map[code].active++;else if(st==='TRIAL')map[code].trial++;}
  let rows=Object.values(map).sort((a,b)=>b.total-a.total);
  // School code filter — type code → only that school
  const q=(document.getElementById('schFilter')?document.getElementById('schFilter').value:'').trim().toLowerCase();
  if(q){rows=rows.filter(r=>r.code.toLowerCase().includes(q)||(r.school||'').toLowerCase().includes(q));}
  document.getElementById('schCount').textContent=q?(rows.length+' match'):(rows.length+' schools');
  const tb=document.querySelector('#schoolTable tbody');
  if(!rows.length){tb.innerHTML='<tr><td colspan="6" class="empty">'+(q?'ಆ code ನ school ಇಲ್ಲ':'No data yet')+'</td></tr>';return;}
  tb.innerHTML=rows.map(r=>{const rate=r.total?Math.round(r.active/r.total*100):0;return '<tr><td><span class="code-pill">'+r.code+'</span></td><td>'+r.school+'</td><td><b>'+r.total+'</b></td><td><span class="badge active">'+r.active+'</span></td><td><span class="badge trial">'+r.trial+'</span></td><td style="min-width:90px">'+rate+'%<div class="bar-mini"><i style="width:'+rate+'%"></i></div></td></tr>';}).join('');
}
function renderClassChart(){
  const c={8:0,9:0,10:0};students.forEach(s=>{const cl=String(s.class||'').replace(/[^0-9]/g,'');if(c[cl]!==undefined)c[cl]++;});
  if(classChart)classChart.destroy();
  classChart=new Chart(document.getElementById('classChart'),{type:'bar',data:{labels:['Class 8','Class 9','Class 10'],datasets:[{data:[c[8],c[9],c[10]],backgroundColor:['#1b6fd4','#8b5cf6','#2da844'],borderRadius:8}]},options:{plugins:{legend:{display:false}},scales:{y:{ticks:{color:'#8493b0'},grid:{color:'#26304a'}},x:{ticks:{color:'#8493b0'},grid:{display:false}}}}});
}
function renderPlanChart(){
  let p299=0,p199=0,pTrial=0;
  students.forEach(s=>{const st=effStatus(s);if(st==='ACTIVE'){if(String(s.plan)==='299')p299++;else p199++;}else if(st==='TRIAL')pTrial++;});
  if(planChart)planChart.destroy();
  planChart=new Chart(document.getElementById('planChart'),{type:'doughnut',data:{labels:['₹299 Active','₹199 Active','Trial'],datasets:[{data:[p299,p199,pTrial],backgroundColor:['#2da844','#1b6fd4','#f5b324'],borderColor:'#121829',borderWidth:3}]},options:{plugins:{legend:{position:'bottom',labels:{color:'#8493b0',padding:14,font:{size:12}}}},cutout:'62%'}});
}
function renderExpiring(){
  const now=new Date();
  const soon=students.filter(s=>{if(effStatus(s)!=='TRIAL')return false;if(!s.expiry_date)return false;const d=(new Date(s.expiry_date)-now)/86400000;return d>=0&&d<=2;}).sort((a,b)=>new Date(a.expiry_date)-new Date(b.expiry_date));
  const box=document.getElementById('expiringList');
  if(!soon.length){box.innerHTML='<div class="empty">No trials expiring soon ✅</div>';return;}
  box.innerHTML=soon.map(s=>'<div class="alert-row">🔔 <b>'+(s.name||'—')+'</b> · '+s.phone+' <span class="d">'+s.expiry_date+'</span></div>').join('');
}
function renderStudents(){
  const q=(document.getElementById('search').value||'').toLowerCase();
  const fs=document.getElementById('fStatus').value;const fc=document.getElementById('fClass').value;
  let list=students.filter(s=>{if(fs&&effStatus(s)!==fs)return false;if(fc&&String(s.class||'').replace(/[^0-9]/g,'')!==fc)return false;if(q){const hay=((s.name||'')+' '+(s.phone||'')+' '+(s.school_code||'')+' '+(s.school||'')+' '+(s.regno||'')).toLowerCase();if(!hay.includes(q))return false;}return true;});
  const tb=document.querySelector('#studentTable tbody');
  if(!list.length){tb.innerHTML='<tr><td colspan="8" class="empty">No students match</td></tr>';return;}
  tb.innerHTML=list.map(s=>{const st=effStatus(s);const b=st==='ACTIVE'?'active':st==='TRIAL'?'trial':'blocked';return '<tr><td><b>'+(s.name||'—')+'</b></td><td class="mono">'+(s.phone||'')+'</td><td>'+(s.class||'—')+'</td><td>'+(s.school_code?'<span class="code-pill">'+s.school_code+'</span>':'—')+'</td><td>'+(s.regno||'—')+'</td><td><span class="badge '+b+'">'+(st||'—')+'</span></td><td>'+(s.plan?'₹'+s.plan:'—')+'</td><td class="mono" style="font-size:12px">'+(s.expiry_date||'—')+'</td></tr>';}).join('');
}
function exportCSV(){
  const cols=['name','phone','class','school','school_code','regno','status','plan','start_date','expiry_date'];
  let csv=cols.join(',')+String.fromCharCode(10);
  students.forEach(s=>{csv+=cols.map(c=>'"'+((s[c]||'')+'').replace(/"/g,'""')+'"').join(',')+String.fromCharCode(10);});
  const blob=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='smartpath_students_'+new Date().toISOString().split('T')[0]+'.csv';a.click();
}
</script>
</body>
</html>`;

module.exports = { registerDashboard };
