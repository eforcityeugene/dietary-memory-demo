'use strict';
// Independent database: never opens dm-receipts or reads private meal records.
globalThis.IntakeStore = {
  async connection() {
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open('provisional-food-source-intake',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('snapshots');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(Error('本地資料庫無法開啟；草稿保留。'));
    });
  },
  async load() {
    const db=await this.connection();
    return new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readonly');const req=tx.objectStore('snapshots').get('current');
      tx.oncomplete=()=>{db.close();resolve(req.result || {schema:1,revision:0,documents:[],records:[]});};
      tx.onabort=tx.onerror=()=>{db.close();reject(Error('讀取本地資料失敗。'));};
    });
  },
  async save(next, expectedRevision) {
    const db=await this.connection();
    return new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite');const store=tx.objectStore('snapshots');const req=store.get('current');let error;
      req.onsuccess=()=>{try{const revision=req.result?.revision || 0;if(revision!==expectedRevision)throw Error('另一分頁已修改資料；目前草稿保留。請匯出後重新載入。');store.put({...next,revision:revision+1},'current');}catch(e){error=e;tx.abort();}};
      tx.oncomplete=()=>{db.close();resolve({...next,revision:expectedRevision+1});};
      tx.onabort=tx.onerror=()=>{db.close();reject(error || Error('儲存失敗；草稿保留，未批准。'));};
    });
  }
};
