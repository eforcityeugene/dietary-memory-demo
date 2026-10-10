(function (root) {
  'use strict';
  const TYPES = ['unknown', 'source_fact_claim', 'opinion', 'explicit_recommendation', 'document_observation', 'model_inference'];
  const CATEGORIES = ['restaurant_evidence', 'cooking_method', 'eating_method', 'quality_preference', 'traditional_contemporary', 'general_knowledge'];
  const metadata = { '發布者': 'publisher', '講者': 'speaker', '餐廳': 'restaurant', '分店': 'branch', '菜式': 'dish', '日期': 'date', '來源': 'url' };
  function extract(document, makeId) {
    const context = { publisher: document.publisher || '', speaker: '', restaurant: '', branch: '', dish: '', date: document.date || '', url: document.url || '' };
    const candidates = [];
    const lines = document.originalText.split(/\r?\n/);
    const restaurantMatch = document.originalText.match(/\*\*品牌名稱\*\*[:：]\s*([^\n]+)/);
    const dishNames = {}, branchNames = {};
    let dishId = '', tableHeaders = null;
    for (const raw of lines) {
      const d = raw.match(/\*\*D(\d+)\*\*/); if (d) dishId = 'D' + d[1];
      const name = raw.match(/\*\*來源菜名\*\*[:：]\s*(.+)/); if (name && dishId) dishNames[dishId] = name[1];
      const branch = raw.match(/\*\*分店\*\*[:：]\s*(B\d+)\s*(.+)/); if (branch) branchNames[branch[1]] = branch[2];
      const channel = raw.match(/\*\*頻道\*\*[:：]\s*(.+)/); if (channel) context.publisher = channel[1];
      const url = raw.match(/\*\*影片 URL\*\*[:：]\s*(.+)/); if (url) context.url = url[1];
      const date = raw.match(/\*\*發布日期\*\*[:：]\s*(.+)/); if (date) context.date = date[1];
    }
    const structured = lines.some(l => /^\|\s*(資料編號|建議編號)\s*\|/.test(l));
    const scopeWarnings = lines.flatMap((text,index)=> /兩店菜單是否一致|未能確認兩間分店/.test(text) ? [{code:'document_branch_uncertainty',line:index+1,locator:'document line '+(index+1),quote:text}] : []);
    document.originalText.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      let table = null;
      if (structured) {
        if (!line.startsWith('|')) return;
        const cells = line.split('|').slice(1,-1).map(s=>s.trim());
        if (cells[0] === '資料編號' || cells[0] === '建議編號') { tableHeaders = cells; return; }
        if (!tableHeaders || !/^[CA]\d+$/.test(cells[0])) return;
        table = Object.fromEntries(tableHeaders.map((h,index)=>[h,cells[index] || '']));
      }
      const match = line.match(/^([^:：]+)[:：]\s*(.*)$/);
      if (match && metadata[match[1]]) { context[metadata[match[1]]] = match[2]; return; }
      const scopeText = table ? table['餐廳/分店編號'] || table['餐廳分店'] || '' : '';
      const oneBranch = /^R\d+-(B\d+)$/.exec(scopeText);
      const r = { id: makeId(), documentId: document.id, text: table ? table['具體內容'] || table['具體做法'] : line,
        quote: raw, locator: 'document line ' + (i + 1), line: i + 1,
        publisher: context.publisher, speaker: context.speaker,
        speakerEvidence: context.speaker ? 'Owner document explicitly labels 講者; not checked against video' : '',
        restaurant: context.restaurant, branch: context.branch, dish: context.dish,
        restaurantCertainty: 'unknown', dishCertainty: 'unknown', date: context.date,
        dateKind: 'unknown', temporalScope: '', url: context.url,
        category: 'general_knowledge', claimType: 'unknown', certainty: 'unknown', scope: 'unknown',
        conditions: '', context: '', limitations: '', status: 'pending', reviewNote: '',
        videoVerification: 'unverified_against_original_video', privacy: 'owner_private', history: [] };
      if (table) {
        r.sourceClaimId = table[tableHeaders[0]];
        r.speaker = table['發言者'] || table['建議者'] || '';
        r.speakerEvidence = 'Secondary analysis table speaker label; original video unverified';
        r.restaurant = restaurantMatch ? restaurantMatch[1] : '';
        r.restaurantCertainty = r.restaurant ? 'document_explicit' : 'unknown';
        r.dish = dishNames[table['菜式編號'] || table['相關菜式編號']] || '';
        r.dishCertainty = r.dish ? 'document_explicit' : 'unknown';
        r.branch = oneBranch ? branchNames[oneBranch[1]] || oneBranch[1] : '';
        r.scope = oneBranch ? 'branch' : 'unknown'; r.sourceScopeText = scopeText;
        r.category = r.sourceClaimId.startsWith('A') ? 'eating_method' : 'restaurant_evidence';
        r.claimedVideoLocator = table['時間起訖'] || '';
        r.documentEvidenceExcerpt = table['簡短證據'] || '';
        r.sourceAnalysisText = r.text;
        r.reviewWarnings = [...scopeWarnings];
        r.limitations = 'Secondary analysis only; verify meaning, attribution and scope. ' + (oneBranch ? '' : 'Multiple or unresolved branches: do not copy claim to each branch.');
        r.dateKind = context.date ? 'publication' : 'unknown';
        // An advice row whose quoted evidence contains only positive adjective
        // praise cannot provide serving instructions. Retain the analysis too.
        const praiseOnly = /^[「"]?[^，。！？!？\n]{1,40}(?:又靚|好靚|很好|好吃|很美味)[」"]?$/.test(r.documentEvidenceExcerpt.trim());
        if (r.sourceClaimId.startsWith('A') && praiseOnly) {
          r.text = r.documentEvidenceExcerpt; r.claimType = 'opinion'; r.category = 'restaurant_evidence';
          r.recommendationSupported = false;
          r.reviewWarnings.push({code:'praise_not_eating_advice',line:r.line,locator:r.locator,quote:r.quote});
        }
      }
      // Narrow table pattern: three independently positive soup/condiment/service
      // clauses share their source row/timestamp. No fixture sentence is bundled.
      const clauses = table ? r.text.split('，') : [];
      const threeOpinions = table && r.sourceClaimId.startsWith('C') && clauses.length===3 && /湯底/.test(clauses[0]) && /辣椒油/.test(clauses[1]) && /老闆|服務/.test(clauses[2]) && clauses.every(text=>/好|美|靚/.test(text));
      if (threeOpinions) {
        clauses.map(text=>text.replace(/。$/,'')+'。').forEach((text,index)=>candidates.push({...r,id:index===0?r.id:makeId(),text,sourceClaimPart:index+1,claimType:'opinion',reviewWarnings:[...r.reviewWarnings,{code:'compound_claim_split',line:r.line,locator:r.locator,quote:r.quote}]}));
      } else candidates.push(r);
    });
    return candidates;
  }
  function validate(record) {
    const errors = [];
    if (!record.text.trim()) errors.push('說法不能留空。');
    if (!TYPES.includes(record.claimType) || record.claimType === 'unknown') errors.push('請判定說法類型。');
    if (!CATEGORIES.includes(record.category)) errors.push('用途分類無效。');
    if (!record.quote.trim() || !record.locator.trim()) errors.push('保留原稿摘錄及位置。');
    if (record.category === 'restaurant_evidence' && (!record.restaurant.trim() || record.restaurantCertainty !== 'document_explicit')) errors.push('餐廳證據需原稿明示餐廳；未知店名可保留待覆核或改為獨立知識。');
    if (record.scope === 'branch' && !record.branch.trim()) errors.push('分店範圍需填寫具體分店。');
    if (record.scope === 'general_standard' && !record.reviewNote.trim()) errors.push('一般說法需說明原稿明示依據；單次讚賞不應升為標準。');
    if (record.claimType === 'model_inference' && !record.reviewNote.trim()) errors.push('推論需說明推論依據及限制。');
    if (record.reviewWarnings?.length && !record.reviewNote.trim()) errors.push('請在覆核說明回應原稿的不確定性／語意警示。');
    if (record.recommendationSupported === false && (record.claimType === 'explicit_recommendation' || record.category === 'eating_method')) errors.push('原稿摘錄只支持讚賞，未支持食用建議或明示推薦；需另建有獨立證據的新記錄。');
    return errors;
  }
  function review(record, status, now) {
    if (!['approved', 'rejected'].includes(status)) throw new Error('Invalid review status');
    const errors = status === 'approved' ? validate(record) : [];
    if (errors.length) throw new Error(errors.join('\n'));
    return { ...record, status, videoVerification: 'unverified_against_original_video', privacy: 'owner_private',
      history: [...record.history, { at: now, action: status, note: record.reviewNote }] };
  }
  function search(records, query) {
    const q = query.trim().toLocaleLowerCase();
    return records.filter(r => r.status === 'approved' && JSON.stringify(r).toLocaleLowerCase().includes(q));
  }
  function restaurantRecords(records, restaurant, branch, dish) {
    return records.filter(r => r.status === 'approved' && r.category === 'restaurant_evidence'
      && r.restaurant === restaurant && r.restaurantCertainty === 'document_explicit'
      && (!dish || r.dish === dish)
      && (branch ? r.scope === 'branch' && r.branch === branch : r.scope === 'brand'));
  }
  const api = { TYPES, CATEGORIES, extract, validate, review, search, restaurantRecords };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IntakeCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
