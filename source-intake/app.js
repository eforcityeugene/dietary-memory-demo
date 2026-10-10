'use strict';
const C = IntakeCore, ADAPTER = 'document-lines-and-known-tables-v2';
const $ = id => document.getElementById(id);
const id = () => crypto.randomUUID();
let state = { schema: 1, revision: 0, documents: [], records: [] }, selected = null;
let importedName = '', storageAvailable = true, saving = false;
const editorDrafts = new Map();
const message = text => { $('message').textContent = text; };
const ready = IntakeStore.load().then(saved=>{state=saved;render();}).catch(()=>{storageAvailable=false;message('本瀏覽器儲存不可用；未能儲存前不會顯示成功。');});
async function commit(next) {
  if (!storageAvailable) throw Error('瀏覽器儲存不可用；原稿仍留在輸入區。');
  state = await IntakeStore.save(next, state.revision);
}
function node(tag, text, className) { const n = document.createElement(tag); n.textContent = text; if (className) n.className = className; return n; }
function render() {
  const box = $('candidates'); box.replaceChildren();
  const filter = $('statusFilter').value;
  state.records.filter(r => filter === 'all' || r.status === filter).forEach(r => {
    const card = node('div', '', 'card' + (r.id === selected ? ' active' : ''));
    card.append(node('strong', r.text.slice(0, 150)), node('p', `${r.status} · ${r.speaker || '講者未知'} · ${r.locator}`, 'muted'));
    card.tabIndex = 0; card.setAttribute('role', 'button');
    const choose = () => { selected = r.id; render(); renderEditor(); };
    card.onclick = choose; card.onkeydown = e => { if (e.key === 'Enter') choose(); };
    box.append(card);
  });
  if (!box.children.length) box.append(node('p', '這個狀態沒有記錄。', 'muted'));
  const docs = $('documents'); docs.replaceChildren();
  state.documents.forEach(d => { const details = document.createElement('details');
    details.id = 'source-' + d.id;
    details.append(node('summary', `${d.title} · ${d.originalFilename || '貼上文字'}`), node('p', `${d.createdAt} · ${d.originalText.split(/\r?\n/).length} 行 · 分析稿，原影片未核實`, 'muted'), node('pre', d.originalText)); docs.append(details); });
  renderSearch();
}
const fields = [
 ['text','說法（一次只寫一個意思）'], ['speaker','實際講者（未知留空）'], ['speakerEvidence','講者身份依據'],
 ['publisher','發布者／頻道'], ['restaurant','餐廳／品牌'], ['branch','具體分店'], ['dish','來源菜式名稱'],
 ['restaurantCertainty','餐廳身份依據',['unknown','document_explicit']], ['dishCertainty','菜式身份依據',['unknown','document_explicit']],
 ['category','用途分類',C.CATEGORIES], ['claimType','說法類型',C.TYPES],
 ['scope','適用範圍',['unknown','single_instance','brand','branch','personal_preference','source_general_claim','general_standard']],
 ['certainty','來源確定程度',['unknown','source_explicit','source_uncertain','reviewer_inference']],
 ['date','日期／原有時間文字'], ['dateKind','日期性質',['unknown','publication','experience','effective_period']],
 ['temporalScope','適用時段（舊價不可當現價）'], ['conditions','適用條件'], ['context','地域／流派／傳統或近年語境'],
 ['limitations','未知、例外或相異說法'], ['claimedVideoLocator','原稿聲稱的影片時間戳（未核實）'], ['url','來源 URL'], ['reviewNote','覆核說明／推論依據'] ];
function renderEditor() {
  const record = state.records.find(r => r.id === selected), box = $('editor'); box.replaceChildren();
  if (!record) { box.textContent = '選擇左方候選。'; return; }
  box.append(node('p', `原稿：${state.documents.find(d => d.id === record.documentId)?.title || '未知'} · ${record.locator}`, 'muted'), node('pre', record.quote), node('p', '原稿摘錄不可覆寫；修改說法會另存 revision。批准只代表稿件覆核，原影片仍未核實。', 'muted'));
  const original = node('button','打開原稿及該行位置','secondary');original.onclick=()=>{const details=$('source-'+record.documentId);details.open=true;details.scrollIntoView(); const pre=details.querySelector('pre');pre.replaceChildren();state.documents.find(d=>d.id===record.documentId).originalText.split(/\r?\n/).forEach((line,index)=>{const row=node('div',`${index+1}: ${line}`);if(index+1===record.line){row.style.background='#fff3d3';row.id='selected-source-line';}pre.append(row);});$('selected-source-line')?.scrollIntoView({block:'center'});};box.append(original);
  if(record.sourceAnalysisText && record.sourceAnalysisText!==record.text)box.append(node('p','原分析稿的意思（保留供比較）：'+record.sourceAnalysisText,'notice'));
  const warningLabels={document_branch_uncertainty:'原稿未確認兩間分店的菜單適用性',praise_not_eating_advice:'讚賞未支持上桌食法或明示推薦',compound_claim_split:'原分析包含多個意思，已分拆但共用原稿行及聲稱時間戳'};
  for(const warning of record.reviewWarnings || [])box.append(node('p',`需覆核：${warningLabels[warning.code] || '原稿證據需覆核'} · ${warning.locator}\n${warning.quote}`,'notice'));
  fields.forEach(([key, label, choices]) => { const l = node('label', label); l.htmlFor = 'edit-' + key; box.append(l);
    const input = document.createElement(choices ? 'select' : ['text','reviewNote','limitations'].includes(key) ? 'textarea' : 'input'); input.id = 'edit-' + key;
    if (choices) choices.forEach(value => { const option = node('option', value); option.value = value; input.append(option); });
    input.value = editorDrafts.get(record.id)?.[key] ?? record[key] ?? ''; input.oninput=()=>{const draft=editorDrafts.get(record.id)||{};draft[key]=input.value;editorDrafts.set(record.id,draft);}; box.append(input);
  });
  async function save(status) {
    if(saving)return;saving=true;
    try {
      const current = state.records.find(r=>r.id===record.id);
      const draft = { ...current }; fields.forEach(([key]) => draft[key] = $('edit-' + key).value);
      const now = new Date().toISOString(); draft.updatedAt = now;
      draft.history = [...current.history, { at: now, action: 'edit', previous: { ...current, history: undefined } }];
      // Preserve an edited pending draft even if approval validation fails.
      draft.status = 'pending';
      await commit({ ...state, records: state.records.map(r => r.id === record.id ? draft : r) });
      if (status !== 'pending') {
        const reviewed = C.review(draft, status, now);
        await commit({ ...state, records: state.records.map(r => r.id === record.id ? reviewed : r) });
      }
      editorDrafts.delete(record.id);message(status === 'pending' ? '草稿已儲存。' : status === 'approved' ? '已批准稿件記錄；原影片仍未核實。' : '已拒絕，原稿及修改歷史仍保留。'); render(); renderEditor();
    } catch (error) { message(error.message); render(); } finally {saving=false;}
  }
  [['儲存草稿','pending','secondary'],['批准稿件記錄','approved',''],['拒絕','rejected','danger']].forEach(([label,status,cls]) => { const b = node('button',label,cls); b.onclick = () => save(status); box.append(b); });
  const history = document.createElement('details'); history.append(node('summary', `修改／覆核歷史：${record.history.length}`), node('pre',JSON.stringify(record.history,null,2))); box.append(history);
}
function renderSearch() {
  const box = $('results'); box.replaceChildren();
  const query=$('query').value.trim().toLocaleLowerCase();
  if(query)state.documents.filter(d=>d.originalText.toLocaleLowerCase().includes(query)||d.title.toLocaleLowerCase().includes(query)).forEach(d=>{const link=node('button',`搜尋原稿：${d.title}`,'secondary');link.onclick=()=>{const details=$('source-'+d.id);details.open=true;details.scrollIntoView();};box.append(link);});
  C.search(state.records, $('query').value).forEach(r => { const card = node('div','','card'); card.append(node('strong',r.text),node('p',`${r.category} · ${r.claimType} · 講者：${r.speaker || '未知'} · 發布者：${r.publisher || '未知'} · ${r.scope}`, 'muted'),node('p',`${r.date || '日期未知'} / ${r.temporalScope || '適用時段未知'} · ${r.locator} · 原影片未核實`, 'muted')); card.onclick=()=>{ selected=r.id;renderEditor(); }; box.append(card); });
}
$('file').onchange = async e => { const file=e.target.files[0]; if (!file) return; if (file.size > 2*1024*1024 || !/\.(txt|md)$/i.test(file.name)) { message('請選擇 2 MB 以內的 .txt 或 .md。'); return; }
  $('text').value=await file.text(); importedName=file.name; $('title').value=file.name; message('原稿已讀入，尚未儲存。'); };
$('import').onclick = async () => { try {
  await ready;
  const originalText=$('text').value; if (!originalText.trim()) throw Error('請先貼上文字。');
  if (new TextEncoder().encode(originalText).length > 2*1024*1024) throw Error('原稿超過 2 MB。');
  const hashBytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(originalText));
  const hash=Array.from(new Uint8Array(hashBytes),x=>x.toString(16).padStart(2,'0')).join('');
  if (state.documents.some(d=>d.inputHash===hash && d.adapterVersion===ADAPTER)) throw Error('同一原稿及抽取版本已存在；請編輯現有候選。');
  const d={id:id(),title:$('title').value||'未命名原稿',originalFilename:importedName,originalText,url:$('sourceUrl').value,publisher:$('publisher').value,date:$('sourceDate').value,inputHash:hash,adapterVersion:ADAPTER,createdAt:new Date().toISOString(),privacy:'owner_private',videoVerification:'unverified_against_original_video'};
  const records=C.extract(d,id); await commit({...state,documents:[...state.documents,d],records:[...state.records,...records]});
  message(`原稿已儲存，建立 ${records.length} 個待覆核候選。請判定用途及說法類型。`); $('text').value=''; importedName=''; render();
} catch(error){message(error.message);} };
$('sample').onclick=()=>{ importedName=''; $('title').value='合成示例 · 未知店名的雲吞'; $('publisher').value='合成頻道'; $('sourceUrl').value=''; $('sourceDate').value='昔日（確切日期未知）'; $('text').value='菜式：雲吞\n講者：合成嘉賓甲\n我喜歡這次蝦肉與豬肉約七比三的比例。\n講者：\n原稿描述蒸製時加醬，未提供上桌後食法。'; message('合成資料，並非真實影片紀錄。'); };
$('statusFilter').onchange=render; $('query').oninput=renderSearch;
function download(reviewedOnly) { const records=reviewedOnly?state.records.filter(r=>r.status==='approved'):state.records;
  const documentIds=new Set(records.map(r=>r.documentId)); const docs=reviewedOnly?state.documents.filter(d=>documentIds.has(d.id)):state.documents;
  const data={schema:1,module:'provisional-food-source-intake',notProductionMigration:true,privacy:'owner_private',exportedAt:new Date().toISOString(),documents:docs,records,...(!reviewedOnly?{unsavedEditorDrafts:Object.fromEntries(editorDrafts)}:{})};
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); a.download=reviewedOnly?'food-source-reviewed-private.json':'food-source-backup-private.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
$('export').onclick=()=>download(false); $('exportReviewed').onclick=()=>download(true);
$('restore').onchange=async e=>{try { await ready; const f=e.target.files[0]; if(!f)return; if(f.size>10*1024*1024)throw Error('備份超過 10 MB。');
  const data=JSON.parse(await f.text()); if(data.schema!==1||data.module!=='provisional-food-source-intake'||!Array.isArray(data.documents)||!Array.isArray(data.records))throw Error('不是本 prototype 備份格式。');
  const ids=new Set(state.documents.map(d=>d.id)); const docs=[];
  for(const d of data.documents){if(typeof d.id!=='string'||typeof d.originalText!=='string'||typeof d.title!=='string'||typeof d.inputHash!=='string')throw Error('原稿格式不完整。');
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(d.originalText));const hash=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');if(hash!==d.inputHash)throw Error('備份原稿 hash 不符；沒有寫入。');
    const existing=state.documents.find(x=>x.id===d.id);if(existing&&existing.originalText!==d.originalText)throw Error('相同原稿 ID 的內容不同；沒有覆寫。');
    if(!ids.has(d.id)){docs.push({...d,privacy:'owner_private',videoVerification:'unverified_against_original_video'});ids.add(d.id);}}
  const recordIds=new Set(state.records.map(r=>r.id)); const records=[];
  for(const r of data.records){if(typeof r.id!=='string'||!ids.has(r.documentId)||typeof r.quote!=='string'||typeof r.locator!=='string'||typeof r.text!=='string'||!Array.isArray(r.history))throw Error('記錄格式不完整。');const source=[...state.documents,...docs].find(x=>x.id===r.documentId);if(!Number.isInteger(r.line)||source.originalText.split(/\r?\n/)[r.line-1]!==r.quote)throw Error('備份摘錄不符合原稿行；沒有寫入。');if(!recordIds.has(r.id)){records.push({...r,status:'pending',privacy:'owner_private',videoVerification:'unverified_against_original_video',history:[...r.history,{at:new Date().toISOString(),action:'restored_requires_review'}]});recordIds.add(r.id);}}
  await ready;await commit({...state,documents:[...state.documents,...docs],records:[...state.records,...records]});
  for(const [recordId,draft] of Object.entries(data.unsavedEditorDrafts || {})){if(state.records.some(r=>r.id===recordId)&&draft&&typeof draft==='object'){const accepted={};for(const [key] of fields)if(typeof draft[key]==='string')accepted[key]=draft[key];editorDrafts.set(recordId,accepted);}}
  message('已還原新 ID；匯入記錄需重新覆核。未儲存編輯另行保留為草稿。');render();
}catch(error){message(error.message);}};
render();
window.addEventListener('beforeunload',e=>{if(editorDrafts.size||saving||$('text').value.trim()){e.preventDefault();e.returnValue='';}});
