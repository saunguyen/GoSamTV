/* GoSamTV Lite 1.8.2 — no RSS, weather, market, apps, timers or preloaded channels. */
(function () {
'use strict';
var $ = function (s) { return document.querySelector(s); };
var STORE = 'gosamtv.vn172.v1';
var state = { sources: [], channels: [], favorites: [], recent: [], filter: 'all', last: null, launchpadEnabled: false };
var playing = false, currentIndex = -1, playingList = [], streamToken = 0;
var hls = null, hlsLoading = null, timer = null, osdTimer = null, lastFocus = null, osdAutoHideArmed = false;
var launchGuard = Date.now() + 1200;
var msgTimer = null, query = '', enterDownAt = 0, enterHeld = false;
var numberPadOpen=false, searchImeOpen=false, remoteNumberCodes={}, playerOkStarted=0;
var channelPanelOpen = false, guidePanelOpen = false, numberBuffer = '', numberTimer = null, guideToken = 0, guideCache = {};

function notify(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(function () { $('#toast').hidden = true; }, 3000);
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify({
    sources: state.sources, favorites: state.favorites, recent: state.recent, last: state.last, launchpadEnabled: state.launchpadEnabled
  })); } catch (e) { notify('Bộ nhớ TV đã đầy, không thể lưu'); }
}
function uniqueId(url) {
  var n = 0, i;
  for (i = 0; i < url.length; i++) n = ((n << 5) - n + url.charCodeAt(i)) | 0;
  return 'c' + (n >>> 0).toString(36);
}
function cleanName(name) {
  var value=String(name||'').toLowerCase();
  try {value=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'');}catch(e){}
  return value.replace(/đ/g,'d').replace(/\+/g,'plus').replace(/\b(?:hd|sd|fhd|fullhd|tv)\b/g,'')
    .replace(/[^a-z0-9]/g,'');
}
// Index once when app starts, instead of scanning hundreds of logo records per
// channel; skip ambiguous names to avoid attaching the WRONG broadcaster logo.
var metaIndexById = {}, metaIndexByName = {};
function chooseIdentifiedLogo(previous, candidate) {
  if (!previous) return candidate;
  if (!previous.logo && candidate.logo) return candidate;
  if (previous.logo && !candidate.logo) return previous;
  if (previous.logo === candidate.logo) return previous;
  // Operator-supplied branding is the strongest evidence for ON channels.
  var oldOfficial=/official-vtvcab-/.test(previous.logo||'');
  var newOfficial=/official-vtvcab-/.test(candidate.logo||'');
  if (oldOfficial !== newOfficial) return newOfficial ? candidate : previous;
  // Ambiguous stations must never acquire a random logo.
  return null;
}
function makeLogoIndex() {
  var known=window.GOSAM_META||{},keys=Object.keys(known);
  keys.forEach(function(key) {
    var item=known[key],id=cleanName(key);
    if(id)metaIndexById[id]=item;
  });
  keys.forEach(function(key) {
    var item=known[key],names=[item.name].concat(item.aliases||[]);
    names.forEach(function(value) {
      var name=cleanName(value);
      if(!name)return;
      if(!Object.prototype.hasOwnProperty.call(metaIndexByName,name)) {
        metaIndexByName[name]=item;
      } else if(metaIndexByName[name]) {
        metaIndexByName[name]=chooseIdentifiedLogo(metaIndexByName[name],item);
      }
    });
  });
  // Explicit, confirmed identities override ambiguous duplicate names from
  // historical IPTV metadata. Includes the verified 2026 regional logos and
  // broadcaster-supplied ON channel posters.
  var preferredKeys=[
    'vtv5_tnb','vtv5_tn','htvc_plus','hanoi2','haiphong1',
    'qngtv1','qngtv2','quangngai',
    'thvl1','thvl2','thvl3','thvl4','thvl5'
  ];
  keys.forEach(function(key){
    if(/^on_on/.test(key) && /official-vtvcab-/.test(known[key].logo||''))
      preferredKeys.push(key);
  });
  preferredKeys.forEach(function(key){
    var m=known[key]; if(!m||!m.logo)return;
    [m.name].concat(m.aliases||[]).forEach(function(value){
      var n=cleanName(value);
      if(n)metaIndexByName[n]=m;
    });
  });
}
function channelMeta(c){
  var id=cleanName(c.tvgId||c.tvgID||c.tvg_id||c.epgId||''),
      name=cleanName(c.name||'');
  // Prefer source-supplied stable tvg-id, then explicitly known channel name.
  var candidate=(id&&metaIndexById[id]) || null;
  var byName=(name&&metaIndexById[name]) || (name&&metaIndexByName[name]) || null;
  return candidate && candidate.logo ? candidate : (byName && byName.logo ? byName : (candidate || byName));

}
makeLogoIndex();
function normalizeChannel(c) {
  if (!c || typeof c.url !== 'string' || !/^https?:\/\//i.test(c.url)) return null;
  var meta=channelMeta(c);
  var rawLogo=typeof c.logo==='string' ? c.logo.trim() : '';
  var isBundledLogo=/^img\/lite-logos\/[a-z0-9._-]+\.png$/i.test(rawLogo);
  var isRemoteLogo=/^https?:\/\//i.test(rawLogo);
  var channelName=String(c.name||'Kênh TV').slice(0,90);
  var channelGroup=String(c.group||c.category||'Truyền hình').slice(0,70);
  var nameNorm=cleanName(channelName);
  if ((/^on(?:\s|[-+]|$)/i.test(channelName)||/^vtvcab/i.test(channelName)) &&
      (!c.group || /^(Truyền hình|TV|Live TV)$/i.test(channelGroup))) channelGroup='VTVcab';
  return { id: uniqueId(c.url), name: channelName,
    url: c.url, group: channelGroup,
    logo: isRemoteLogo||isBundledLogo ? rawLogo : (meta&&meta.logo||''),
    fallbackLogo: isBundledLogo ? (c.remoteLogo||'') : (isRemoteLogo ? (meta&&meta.logo||'') : ''),
    tvgId: String(c.tvgId || c.tvgID || c.tvg_id || c.epgId || '').slice(0,100),
    epgId: c.epgProvider==='vn-epg' ? (c.epgId||'') : (c.epgId || (meta&&meta.epg||'')), epgProvider:c.epgProvider||'',
    sourceLabel:c.sourceLabel||'', streamRestricted:c.streamRestricted===true,
    sourceStatus:c.sourceStatus||'', launchpadOriginalUrl:c.launchpadOriginalUrl||'',
    remoteLogo:c.remoteLogo||'', country: c.country||'',
    alternateUrls: Array.isArray(c.alternateUrls) ? c.alternateUrls.slice(0,12) : [],
    origin: c.origin || '', epgSource: c.epgSource || '' };
}
// Explicit one-to-one station aliases. Never collapse distinct services
// such as Hanoi 1/2, Quang Ngai 1/2, or An Giang 1/2/3.
var verifiedStationAliases = {
  'htvcdulich': 'htvcdulichvacuocsong',
  'htvctravelandlife': 'htvcdulichvacuocsong',
  'thlamdong2': 'lamdong2',
  'lamdong2': 'lamdong2',
  'thvl1': 'vinhlong1',
  'thvl2': 'vinhlong2',
  'thvl3': 'vinhlong3',
  'thvl4': 'vinhlong4',
  'thvl5': 'vinhlong5'
};
function canonicalName(value) {
  var key=cleanName(value||'');
  // Use only known identities; do not remove digits that distinguish channels.
  return verifiedStationAliases[key]||key;
}
var vietnamNames = [
  // Local stations that may exist only in the user's earlier M3U, not in
  // the current bundled 101-channel catalog.
  'HTVC Du Lịch','Hà Nội 2','Thanh Hóa','Hà Tĩnh','Huế','Quảng Ngãi 2',
  'Khánh Hòa','Đắk Lắk','Lâm Đồng 2','TH Lâm Đồng 2','Tây Ninh',
  'Đồng Nai 1','Đồng Nai 2','An Giang 3','Hải Phòng 3',
  // Exact, well-known station identities from the provider's M3U.
  'VTV1','VTV2','VTV3','VTV4','VTV5','VTV6','VTV7','VTV8','VTV9','VTV10'
];
var vietnamKnown={};
vietnamNames.forEach(function(name){vietnamKnown[canonicalName(name)]=true;});
(window.GOSAM_DEFAULT_CHANNELS||[]).forEach(function(item){
  if(item.country==='VN') {
    vietnamKnown[canonicalName(item.name)]=true;
    if(item.id)vietnamKnown[canonicalName(item.id)]=true;
  }
});
function stationKey(item) {
  // Numeric URL hashes from custom imports are not station identifiers.
  var id=String(item.originalId||item.tvgId||item.tvgID||item.tvg_id||item.epgId||'');
  var name=canonicalName(item.name||'');
  return {id:canonicalName(id),name:name};
}
function isVietnamChannel(item) {
  if(item.country==='VN')return true;
  var key=stationKey(item);
  // A known Vietnamese station remains Vietnamese even when an old playlist
  // labels its group 'World' or 'International'.
  if(vietnamKnown[key.name] || (key.id&&vietnamKnown[key.id]))return true;
  if(item.country==='INTL')return false;
  var group=cleanName(item.group||item.category||'');
  if(/^(vn|vietnam|vietnamese|kenhvietnam|truyenhinhvietnam|truyenhinhdiaphuong)$/.test(group))return true;
  // Explicitly labelled country is honored; generic station names are not
  // assumed Vietnamese solely because they are in an unclassified playlist.
  return false;
}
function rebuild() {
  // Merge same station across sources regardless of country/group/URL.
  // Distinct channel numbers remain distinct. No user playlist is deleted.
  var domestic=[],foreign=[],byId={},byName={},byUrl={};
  function insert(item,isDefault){
    var c=normalizeChannel(item);
    if(!c)return;
    if(isDefault)c.originalId=item.id;
    var vietnam=isVietnamChannel(item),identity=stationKey(item);
    c.country=vietnam?'VN':'INTL';
    c.type=item.type||(/radio|\bfm\b/i.test(item.group||'')?'radio':'tv');
    var keyId=identity.id,keyName=identity.name.length>3?identity.name:'';
    var existing=(keyId&&byId[keyId])||(keyName&&byName[keyName])||null;
    if(existing){
      if(!isDefault && c.url!==existing.url){
        // A user-imported exact-station source always has priority,
        // even if a verified test source is already available.
        existing.url=c.url;
        existing.streamRestricted=false;
        existing.sourceStatus='user-supplied';
        existing.sourceLabel='Nguồn M3U cá nhân';
        existing.streamIsUserSupplied=true;
      }
      // A user-supplied M3U channel has priority over a known mislabelled
      // built-in stream. Keep the suspect URL as a fallback for diagnostics,
      // but never start it silently under the BiBi brand.
      if(existing.originalId==='vtvcab8' && !isDefault &&
         c.url!==existing.url && /^https?:\/\//i.test(c.url)){
        var previousUrl=existing.url;
        existing.url=c.url;
        existing.streamIsUserSupplied=true;
        existing.alternateUrls=existing.alternateUrls.filter(function(x){return x!==c.url;});
        if(existing.alternateUrls.indexOf(previousUrl)<0)existing.alternateUrls.push(previousUrl);
      }
      if(c.tvgId&&!existing.tvgId)existing.tvgId=c.tvgId;
      [c.url].concat(c.alternateUrls||[]).forEach(function(url){
        if(url!==existing.url && existing.alternateUrls.indexOf(url)<0 &&
           existing.alternateUrls.length<12)existing.alternateUrls.push(url);
      });
      return;
    }
    if(!isDefault&&byUrl[c.url])return;
    (vietnam?domestic:foreign).push(c);
    if(keyId)byId[keyId]=c;
    if(keyName)byName[keyName]=c;
    if(!byUrl[c.url])byUrl[c.url]=c;
  }
  (window.GOSAM_DEFAULT_CHANNELS||[]).forEach(function(item){insert(item,true);});
  state.sources.forEach(function(source){
    (source.channels||[]).forEach(function(item){insert(item,false);});
  });
  state.channels=domestic.concat(foreign);
  state.vnCount=domestic.length;
}
function load() {
  var hadLite = false;
  try { hadLite = localStorage.getItem(STORE) !== null; } catch(e) {}
  try {
    var s = JSON.parse(localStorage.getItem(STORE) || '{}');
    if (Array.isArray(s.sources)) state.sources = s.sources;
    if (Array.isArray(s.favorites)) state.favorites = s.favorites;
    if (Array.isArray(s.recent)) state.recent = s.recent;
    state.last = s.last || null;
    state.launchpadEnabled = s.launchpadEnabled === true;
  } catch (e) {}
  // Preserve custom user playlists from 1.8.0 while loading the original channel catalog independently.
  if (false && !hadLite) {
    try {
      var old = JSON.parse(localStorage.getItem('lp.state.v2') || '{}');
      if (Array.isArray(old.custom) && old.custom.length) {
        var migrated = old.custom.map(normalizeChannel).filter(Boolean);
        if (migrated.length) {
          state.sources.push({ name: 'M3U của tôi (từ bản cũ)', url: '', channels: migrated });
          if (Array.isArray(old.favorites)) state.favorites = old.favorites.map(function (id) { var found = old.custom.filter(function (c) { return c.id === id; })[0]; return found && found.url ? uniqueId(found.url) : id; });
          save();
        }
      }
    } catch (e) {}
  }
  rebuild();
}
var groupLabels = {
  all:'178 kênh Việt Nam', working:'Kênh hoạt động', blocked:'Kênh đang chờ nguồn phát', vtv:'VTV', quocgia:'Kênh quốc gia', htv:'HTV / HTVC',
  local:'Đài địa phương', vtvcab:'VTVcab / ON', sctv:'SCTV', tv360:'TV360',
  giaitri:'Giải trí', vov:'VOV', radio:'Radio FM',
  world:'Kênh quốc tế',fav:'Kênh yêu thích',search:'Kết quả tìm kiếm'
};
var groupByFilter={
  vtv:'VTV',quocgia:'Quốc gia',htv:'HTV',local:'Địa phương',
  vtvcab:'VTVcab',sctv:'SCTV',tv360:'TV360',giaitri:'Giải trí',
  vov:'VOV',radio:'Radio',world:'Quốc tế'
};
function matchesGroup(c,group){
  if(group==='all')return true;
  if(group==='working')return c.sourceStatus==='chrome-video'||c.sourceStatus==='chrome-audio';
  if(group==='blocked')return c.streamRestricted===true;
  if(group==='fav')return state.favorites.indexOf(c.id)>=0 ||
    !!(c.originalId&&state.favorites.indexOf(c.originalId)>=0);
  if(group==='vn')return c.country==='VN';
  if(group==='launchpad')return false;
  return c.group===groupByFilter[group];
}
function list() {
  var channels=state.channels;
  if(state.filter==='search'){
    var needle=cleanName(query);
    return needle ? channels.filter(function(c){return cleanName(c.name).indexOf(needle)>=0;}) : channels;
  }
  return channels.filter(function(c){return matchesGroup(c,state.filter);});
}
function updateGroupNav(){
  var buttons=document.querySelectorAll('#channelGroups .group-chip');
  for(var i=0;i<buttons.length;i++){
    var active=buttons[i].getAttribute('data-filter')===state.filter;
    buttons[i].classList.toggle('is-active',active);
    buttons[i].setAttribute('aria-pressed',active?'true':'false');
  }
}
function chooseGroup(group,focus){
  state.filter=group;
  if(group!=='search'){
    query='';
    if($('#channelSearch'))$('#channelSearch').value='';
    if($('#clearSearch'))$('#clearSearch').hidden=true;
  }
  render();
  if(focus){
    var current=document.querySelector('#channelGroups [data-filter="'+group+'"]');
    if(current)setFocus(current);
  }
}
function setFocus(el) {
  if (!el) return;
  try { el.focus({ preventScroll: true }); } catch(e) { el.focus(); }
  if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function render() {
  var box = $('#channels'), items = list();
  box.innerHTML = '';
  $('#listTitle').textContent = state.filter==='search'?'Kết quả tìm kênh':(state.filter==='all'?'Chào mừng bạn đến với GoSamTV Lite':(groupLabels[state.filter]||'Tất cả kênh'));
  updateGroupNav();
  var workingCount=state.channels.filter(function(x){return x.sourceStatus==='chrome-video'||x.sourceStatus==='chrome-audio';}).length;
  var blockedCount=state.channels.filter(function(x){return x.streamRestricted===true;}).length;
  var workingTab=$('#channelGroups [data-filter="working"]');
  var blockedTab=$('#channelGroups [data-filter="blocked"]');
  if(workingTab)workingTab.textContent='Kênh hoạt động ('+workingCount+')';
  if(blockedTab)blockedTab.textContent='Chờ nguồn ('+blockedCount+')';
  $('#count').textContent = items.length + ' kênh';
  $('#empty').hidden = items.length > 0;
  if (!items.length) $('#empty').textContent = !state.channels.length ?
    'Chưa có kênh. Chọn “Thêm danh sách M3U” để bắt đầu.' :
    state.filter === 'search' ? 'Không tìm thấy kênh phù hợp. Hãy thử tên khác.' :
    state.filter === 'vtvcab' ? 'Nguồn M3U của bạn chưa chứa kênh VTVcab. Hãy thêm danh sách có quyền truy cập; ứng dụng không tự cấp nguồn phát.' : 'Không có kênh trong danh mục này.';
  var frag = document.createDocumentFragment();
  items.forEach(function (c, i) {
    var btn = document.createElement('button'); btn.className = 'channel'; btn.setAttribute('data-focus','');
    var tile = document.createElement('span'); tile.className='tile';
    addLogo(tile,c);btn.appendChild(tile);
    var names = document.createElement('span'); names.className='names';
    var title = document.createElement('strong'); title.textContent=c.name; names.appendChild(title);
    // Home tiles show the channel name only: category subtitles add clutter.
    btn.appendChild(names);
    var sourceStatus=document.createElement('span');
    sourceStatus.className='source-state';
    if(c.sourceStatus==='chrome-video'){sourceStatus.textContent='▶';sourceStatus.title='Truyền hình';}
    else if(c.sourceStatus==='chrome-audio'){sourceStatus.textContent='♫';sourceStatus.title='Radio';}
    else if(c.streamRestricted){sourceStatus.textContent='·';sourceStatus.title='Chưa có nguồn phát độc lập';}
    if(sourceStatus.textContent)btn.appendChild(sourceStatus);
    var fav=document.createElement('span'); fav.className='fav'; fav.textContent=state.favorites.indexOf(c.id)>=0?'★':'☆';
    btn.appendChild(fav);
    btn.addEventListener('click', function () { play(items, i); });
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); toggleFav(c); });
    frag.appendChild(btn);
  });
  box.appendChild(frag);
}
function addLogo(holder,c) {
  function plain(){
    // Neutral abbreviation, never a fabricated channel logo.
    var label=(c.name||'TV').replace(/[^A-Za-zÀ-ỹ0-9 ]/g,'').trim().split(/\s+/).slice(0,2);
    holder.textContent=label.map(function(w){return w.slice(0,3);}).join(' ').toUpperCase()||'TV';
    holder.classList.add('no-logo');
  }
  if (!c.logo) {plain();return;}
  var img=document.createElement('img');img.className='logo-img';img.alt=c.name||'';
  img.loading='lazy';
  img.onerror=function(){
    if(c.fallbackLogo && img.src.indexOf(c.fallbackLogo)<0){
      var next=c.fallbackLogo;c.fallbackLogo='';img.src=next;
    }else{holder.removeChild(img);plain();}
  };
  img.src=c.logo;holder.appendChild(img);
}
function toggleFav(c) {
  if (!c) return;
  var i=state.favorites.indexOf(c.id);
  if (i < 0) state.favorites.push(c.id); else state.favorites.splice(i, 1);
  var focused=document.activeElement, idx=Array.prototype.indexOf.call($('#channels').children,focused);
  save(); render(); if(!playing && idx>=0)setFocus($('#channels').children[idx]);
  notify(i < 0 ? 'Đã thêm vào yêu thích' : 'Đã bỏ yêu thích');
  if (playing && playingList[currentIndex] && playingList[currentIndex].id === c.id) $('#favNow').textContent=i<0?'★ Yêu thích':'☆ Yêu thích';
}
function parseM3u(text, base) {
  var lines=text.replace(/\r/g,'').split('\n'), channels=[], info=null;
  for (var i=0;i<lines.length;i++) {
    var l=lines[i].trim(); if (!l) continue;
    if (/^#EXTINF:/i.test(l)) {
      var comma=l.lastIndexOf(',');
      var name=comma>=0 ? l.slice(comma+1).trim() : 'Kênh '+(channels.length+1);
      var g=l.match(/group-title=["']([^"']*)["']/i);
      var logo=l.match(/tvg-logo=["']([^"']*)["']/i);
      var id=l.match(/tvg-id=["']([^"']*)["']/i);
      info={ name:name, group:g?g[1]:'Truyền hình',logo:logo?logo[1]:'',tvgId:id?id[1]:'' };
    } else if (l.charAt(0)!=='#') {
      try {
        var url = /^https?:\/\//i.test(l) ? l : base ? new URL(l, base).href : '';
        if (!/^https?:\/\//i.test(url)) continue;
        var c=normalizeChannel({ url:url, name:info?info.name:'Kênh '+(channels.length+1),
          group:info?info.group:'Truyền hình',logo:info?info.logo:'',tvgId:info?info.tvgId:'' });
        if (c) channels.push(c);
      } catch(e) {}
      info=null;
    }
    if (channels.length >= 1500) break;
  }
  return channels;
}
function fetchPlaylist(url) {
  return new Promise(function(resolve,reject) {
    var xhr=new XMLHttpRequest();xhr.open('GET',url,true);xhr.timeout=12000;
    xhr.onload=function(){if(xhr.status>=200&&xhr.status<300)resolve(xhr.responseText);else reject(new Error('HTTP '+xhr.status));};
    xhr.onerror=function(){reject(new Error('Lỗi mạng hoặc CORS'));};
    xhr.ontimeout=function(){reject(new Error('Hết thời gian tải'));};
    xhr.send();
  });
}
function showDialog() {
  $('#saveSource').onclick = addSource;$('#saveSource').textContent = 'Lưu danh sách';
  $('#dialogTitle').textContent = 'Thêm danh sách M3U';
  if (playing) closePlayer();
  $('#dialog').hidden=false;
  $('#sourceName').value='';$('#m3uUrl').value='';$('#m3uText').value='';
  $('#dialogMessage').textContent='Dán liên kết M3U hoặc nội dung M3U. Nếu là link .m3u8, ứng dụng thêm như một kênh.';
  setFocus($('#m3uUrl'));
}
function closeDialog(){ $('#dialog').hidden=true;$('#saveSource').onclick=addSource;$('#saveSource').textContent='Lưu danh sách';$('#dialogTitle').textContent='Thêm danh sách M3U';setFocus($('#add')); }
function addSource() {
  var name=$('#sourceName').value.trim()||'Danh sách M3U '+(state.sources.length+1);
  var url=$('#m3uUrl').value.trim(), body=$('#m3uText').value.trim();
  var btn=$('#saveSource');btn.disabled=true;btn.textContent='Đang xử lý...';
  function finish(channels) {
    if (!channels.length) { fail('Không tìm thấy kênh hợp lệ');return; }
    state.sources.push({name:name,url:url,channels:channels});
    rebuild();save();state.filter='all';render();closeDialog();
    notify('Đã thêm '+channels.length+' kênh');btn.disabled=false;btn.textContent='Lưu danh sách';
  }
  function fail(message){$('#dialogMessage').textContent=message;btn.disabled=false;btn.textContent='Lưu danh sách';}
  if (body) { finish(parseM3u(body, url));return; }
  if (!/^https?:\/\//i.test(url)) {fail('Hãy nhập đường dẫn http(s) hoặc dán nội dung M3U');return;}
  if (/\.m3u8(?:\?|$)/i.test(url)) {finish([normalizeChannel({url:url,name:name})]);return;}
  fetchPlaylist(url).then(function(txt){finish(parseM3u(txt,url));})
    .catch(function(e){fail('Không tải được: '+e.message+'. Có thể nguồn chặn CORS. Hãy dán M3U trực tiếp.');});
}
function manage() {
  if (!state.sources.length) {showDialog();return;}
  $('#dialog').hidden=false;$('#sourceName').value='';$('#m3uUrl').value='';$('#m3uText').value='';
  $('#dialogTitle').textContent='Quản lý nguồn · '+state.sources.length+' danh sách';
  $('#dialogMessage').textContent='Để xóa danh sách, chọn mục bên dưới. Việc xóa không thay đổi dữ liệu trong ứng dụng phiên bản cũ.';
  var area=$('#m3uText');area.value=state.sources.map(function(s,i){return (i+1)+'. '+s.name+' ('+s.channels.length+' kênh)';}).join('\n');
  $('#saveSource').textContent='Xóa nguồn cuối';
  var confirmed=false;
  $('#saveSource').onclick=function(){
    if(!confirmed){confirmed=true;$('#dialogMessage').textContent='Xác nhận: bấm Xóa nguồn cuối thêm một lần nữa để xóa '+state.sources[state.sources.length-1].name;return;}
    if(state.sources.length){state.sources.pop();rebuild();save();render();notify('Đã xóa nguồn cuối');}
    $('#saveSource').onclick=addSource;$('#saveSource').textContent='Lưu danh sách';$('#dialogTitle').textContent='Thêm danh sách M3U';closeDialog();
  };
  setFocus($('#cancelSource'));
}
function stopNative() {
  try {
    if (window.webapis && window.webapis.avplay) {
      window.webapis.avplay.stop();window.webapis.avplay.close();
    }
  } catch(e) {}
  document.documentElement.classList.remove('avplay-on');
}
function stopHls() {
  if (hls) {try{hls.destroy();}catch(e){} hls=null;}
  var v=$('#video');
  try{v.pause();v.removeAttribute('src');v.load();}catch(e){}
}
// Decorative waveform for audio-only channels; no AudioContext or spectrum sampling.
function syncRadioVideoMode(nativeApi) {
  var player=$('#player');
  if(!player.classList.contains('radio-mode'))return;
  var width=0;
  try {
    width=nativeApi && typeof nativeApi.getVideoWidth==='function'
      ? nativeApi.getVideoWidth() : $('#video').videoWidth;
  } catch(e){}
  var hasVideo=Number(width)>0;
  player.classList.toggle('radio-has-video',hasVideo);
  $('#radioVisual').hidden=hasVideo;
}
function setRadioLive(live) {
  var player=$('#player'),label=$('#radioLiveLabel'),caption=$('#radioCaption');
  player.classList.toggle('radio-live',!!live && player.classList.contains('radio-mode'));
  if(label)label.textContent=live?'ĐANG PHÁT TRỰC TIẾP':'ĐANG KẾT NỐI';
  if(caption)caption.textContent=live?'Bạn đang nghe phát thanh trực tuyến':'Đang kết nối nguồn phát thanh…';
}
function showRadioVisual(c) {
  var radio=c.type==='radio';
  var player=$('#player'),visual=$('#radioVisual'),logo=$('#radioLogo');
  player.classList.toggle('radio-mode',radio);
  player.classList.remove('radio-live','radio-has-video');
  visual.hidden=!radio;
  if(!radio)return;
  $('#radioChannelName').textContent=c.name;
  logo.hidden=true;logo.removeAttribute('src');
  $('#radioLogoFallback').hidden=false;
  if(c.logo){
    logo.onload=function(){logo.hidden=false;$('#radioLogoFallback').hidden=true;};
    logo.onerror=function(){logo.hidden=true;$('#radioLogoFallback').hidden=false;};
    logo.src=c.logo;
  }
  var waves=$('#radioWaves');
  if(!waves.children.length){
    for(var i=0;i<33;i++){
      var bar=document.createElement('span');bar.className='radio-bar';
      bar.style.setProperty('--radio-delay',(-((i*17)%19)/12)+'s');
      waves.appendChild(bar);
    }
  }
  setRadioLive(false);
}
function closePlayer() {
  hideNumberPad();closePlayerPanels();clearNumber();playing=false;streamToken++;clearTimeout(timer);clearTimeout(osdTimer);
  osdAutoHideArmed=false;$('#player').classList.remove('osd-hidden');
  stopNative();stopHls();$('#player').hidden=true;
  $('#player').classList.remove('radio-mode','radio-live','radio-has-video');$('#radioVisual').hidden=true;
  if (lastFocus && document.contains(lastFocus))setFocus(lastFocus);else setFocus($('#add'));
}
function hidePlayerOSD(){
  clearTimeout(osdTimer);
  if(playing)$('#player').classList.add('osd-hidden');
}
function revealPlayerOSD(duration){
  clearTimeout(osdTimer);
  $('#player').classList.remove('osd-hidden');
  if(playing && osdAutoHideArmed){
    osdTimer=setTimeout(hidePlayerOSD,duration||4000);
  }
}
function confirmPlayerStarted(){
  if(!playing)return;
  if(osdAutoHideArmed)return;
  osdAutoHideArmed=true;
  // Show the channel name briefly on entry, then fully clear the video.
  revealPlayerOSD(1800);
}
function playerStreamError(){
  osdAutoHideArmed=false;
  clearTimeout(osdTimer);
  $('#player').classList.remove('osd-hidden');
}
function updateOSD(c){
  $('#playingName').textContent=c.name;
  $('#playingStatus').textContent='Đang kết nối...';
  $('#favNow').textContent=state.favorites.indexOf(c.id)>=0?'★ Yêu thích':'☆ Yêu thích';
  osdAutoHideArmed=false;
  clearTimeout(osdTimer);
  $('#player').classList.remove('osd-hidden');
  $('#osd').style.opacity='';
}
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (hlsLoading) return hlsLoading;
  hlsLoading=new Promise(function(resolve) {
    var s=document.createElement('script');s.src='vendor/hls.min.js';
    s.onload=function(){resolve(window.Hls||null)};s.onerror=function(){resolve(null)};document.head.appendChild(s);
  });return hlsLoading;
}
function webPlay(url,token) {
  var v=$('#video');v.style.display='block';
  function attempt(){
    var p=v.play();
    if(p&&p.catch)p.catch(function(err){
      if(token===streamToken)
        $('#playingStatus').textContent='Chrome chưa tự phát được ('+(err.name||'Playback error')+'). Hãy bấm vào video để phát.';
    });
  }
  v.onloadedmetadata=function(){if(token===streamToken)syncRadioVideoMode();};
  v.onresize=function(){if(token===streamToken)syncRadioVideoMode();};
  v.onplaying=function(){if(token===streamToken){syncRadioVideoMode();$('#playingStatus').textContent='Đang phát';setRadioLive(true);confirmPlayerStarted();}};
  v.onerror=function(){if(token===streamToken){$('#playingStatus').textContent='Nguồn phát lỗi hoặc không tương thích';setRadioLive(false);playerStreamError();}};
  var hlsUrl=/\.m3u8(?:\?|$)/i.test(url);
  if (!hlsUrl || v.canPlayType('application/vnd.apple.mpegurl')) {v.src=url;attempt();return;}
  loadHls().then(function(H) {
    if (!playing||token!==streamToken)return;
    if(H&&H.isSupported()){
      hls=new H({enableWorker:false,lowLatencyMode:false});
      hls.on(H.Events.ERROR,function(event,data){
        if(!data.fatal||token!==streamToken)return;
        var reason=data.details||data.type||'unknown';
        $('#playingStatus').textContent='Nguồn phát bị lỗi: '+reason+' · Có thể cần URL khác.';setRadioLive(false);playerStreamError();
      });
      hls.loadSource(url);hls.attachMedia(v);hls.on(H.Events.MANIFEST_PARSED,attempt);
    }
    else {v.src=url;attempt();}
  });
}
function play(items, i) {
  var c=items[i];if(!c)return;
  lastFocus=document.activeElement;
  streamToken++;var token=streamToken;
  stopNative();stopHls();clearTimeout(timer);
  playing=true;playingList=items;currentIndex=i;
  $('#player').hidden=false;
  hideNumberPad();closePlayerPanels();clearNumber();
  updateOSD(c);
  showRadioVisual(c);
  if(c.sourceStatus==='chrome-video')
    $('#playingStatus').textContent='Đang kết nối truyền hình…';
  if(c.sourceStatus==='chrome-audio')
    $('#playingStatus').textContent='Đang kết nối radio…';
  if(c.origin==='launchpad')$('#playingStatus').textContent='Nguồn cộng đồng LaunchPad: chưa xác minh đường phát; lịch chỉ hiển thị nếu có nguồn đúng kênh.';
  if(c.streamRestricted && /^https:\/\/tv\.launchpad2\.app\/live\/vn\//.test(c.url)){
    $('#playingStatus').textContent='Nguồn này không thể phát trực tiếp. Hãy dùng một danh sách M3U hợp lệ.';
    playerStreamError();
    return;
  }
  state.last=c.id;state.recent=[c.id].concat(state.recent.filter(function(id){return id!==c.id;})).slice(0,20);save();
  if(c.originalId==='vtvcab8' && !c.streamIsUserSupplied &&
     /freem3u\.xyz\/api\/live\/play\.m3u8\?vid=179/.test(c.url)){
    $('#playingStatus').textContent='Nguồn BiBi trong danh sách gốc có dấu hiệu phát nhầm kênh thể thao. Đã tạm dừng nguồn này. Hãy thêm M3U BiBi có thể kiểm chứng.';
    playerStreamError();
    document.documentElement.classList.remove('avplay-on');
    return;
  }
  var api=window.webapis&&window.webapis.avplay;
  if (api) {
    try {
      document.documentElement.classList.add('avplay-on');
      api.open(c.url);
      api.setDisplayRect(0,0,1920,1080);
      try{api.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');}catch(e){}
      try{api.setBufferingParam('PLAYER_BUFFER_FOR_PLAY','PLAYER_BUFFER_SIZE_IN_SECOND',4);}catch(e){}
      api.setListener({
        onbufferingcomplete:function(){if(token===streamToken){syncRadioVideoMode(api);$('#playingStatus').textContent='Đang phát';setRadioLive(true);confirmPlayerStarted();}},
        oncurrentplaytime:function(){if(token===streamToken){syncRadioVideoMode(api);$('#playingStatus').textContent='Đang phát';setRadioLive(true);confirmPlayerStarted();}},
        onerror:function(){if(token===streamToken){$('#playingStatus').textContent='Luồng bị lỗi';setRadioLive(false);playerStreamError();}},
        onerrormsg:function(){if(token===streamToken){$('#playingStatus').textContent='Không giải mã được kênh';setRadioLive(false);playerStreamError();}}
      });
      api.prepareAsync(function(){
        if(token!==streamToken||!playing)return;
        try{api.setDisplayRect(0,0,1920,1080);api.play();}catch(e){$('#playingStatus').textContent='Không thể phát kênh';playerStreamError();}
      },function(){if(token===streamToken){$('#playingStatus').textContent='Nguồn không tương thích';playerStreamError();}});
      return;
    }catch(e){stopNative();}
  }
  webPlay(c.url,token);
}
function step(delta){if(!playingList.length)return;play(playingList,(currentIndex+delta+playingList.length)%playingList.length);}
function closePlayerPanels() {
  channelPanelOpen=false;guidePanelOpen=false;guideToken++;
  $('#channelPanel').hidden=true;$('#guidePanel').hidden=true;
}
function openChannelPanel(selected) {
  if (!playing)return;
  closePlayerPanels();clearNumber();
  hidePlayerOSD();
  channelPanelOpen=true;$('#channelPanel').hidden=false;
  var box=$('#channelPanelItems');box.innerHTML='';
  // Show every channel in the side panel, keeping the current item focused.
  var center=typeof selected==='number'?selected:currentIndex;
  var first=0,last=playingList.length;
  for(var i=first;i<last;i++){
    var c=playingList[i],item=document.createElement('button');
    item.className='panel-item'+(i===currentIndex?' is-current':'');item.setAttribute('data-focus','');item.dataset.index=String(i);
    var n=document.createElement('span');n.className='number';n.textContent=i+1;item.appendChild(n);
    var logo=document.createElement('span');logo.className='tile';addLogo(logo,c);item.appendChild(logo);
    var name=document.createElement('strong');name.textContent=c.name;item.appendChild(name);
    (function(index){item.onclick=function(){play(playingList,index);};})(i);
    box.appendChild(item);
  }
  setFocus(box.children[center-first]||box.querySelector('button'));
}
function fmtHour(t){var d=new Date(t);return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);}
// Bao Moi's publicly accessible TV schedule pages (source credited there:
// MyTV). These are schedule page slugs only, not video stream URLs.
var baoMoiGuideSlugs={
  // Restore the general TV schedule: VTV channels and primary broadcasters
  // have their own verified Bao Moi pages, not just VTVcab.
  'vtv1':'vtv1-hd',
  'vtv2':'vtv2-hd',
  'vtv3':'vtv3-hd',
  'vtv4':'vtv4-hd',
  'vtv5':'vtv5-hd',
  'vtv8':'vtv8-hd',
  'vtv9':'vtv9',
  'htv1':'htv1',
  'htv2':'htv2-hd',
  'htv3':'htv3',
  'htv4':'htv4',
  'htv7':'htv7-hd',
  'htv9':'htv9-hd',
  'htvthethao':'htv-the-thao',
  'htvcdulich':'htvc-du-lich-cuoc-song',
  'htvcdulichvacuocsong':'htvc-du-lich-cuoc-song',
  'htvcgiadinh':'htvc-gia-dinh',
  'htvcphim':'htvc-phim-hd',
  'htvcphunu':'htvc-phu-nu',
  'htvcthuanviet':'htvc-thuan-viet-hd',
  'thvl1':'vinhlongtv1-thvl1-hd',
  'thvl3':'vinhlongtv3-thvl3-hd',
  'hanoi1':'hanoitv1-hd',
  'hanoi2':'hanoitv2-hd',
  'hatinh':'hatinhtv-httv-hd',
  'quangninh1':'quangninhtv1-qtv1-hd',
  'travinh':'travinhtv-thtv',
  'ninhbinh':'ninhbinhtv-ntb',
  'vtvcab1':'vtvcab1-giai-tri-tv',
  'vtvcab2':'vtvcab2-phim-viet',
  'vtvcab3':'vtvcab3-the-thao-tv-hd',
  'vtvcab8':'vtvcab8-bibi',
  'vtvcab5':'vtvcab5-e-channel',
  'vtvcab4':'vtvcab4-hd',
  'vtvcab10':'vtvcab10',
  'vtvcab16':'vtvcab16-bong-da-tv',
  'vtvcab18':'vtvcab18-the-thao-tin-tuc-hd',
  'vtvcab20':'vtvcab20-v-family',
  'vtvcab23':'vtvcab23-the-thao-golf-hd',
  'onbibi':'vtvcab8-bibi',
  'onphimviet':'vtvcab2-phim-viet',
  'onfootball':'vtvcab16-bong-da-tv',
  'onfamily':'vtvcab20-v-family'
};
// VTVgo official channel identifiers (verified against its public channel
// catalog on 2026-11-07). Do not infer IDs from a channel's numeric suffix:
// VTV6 is 13 while VTV10 is 6, for example.
var vtvgoOfficialChannels={
  'vtv1':'1','vtv2':'2','vtv3':'3','vtv4':'4','vtv5':'5',
  'vtv5tnb':'7','vtv5tn':'163','vtv5taynambo':'7','vtv5taynguyen':'163','vtv6':'13','vtv7':'27',
  'vtv8':'36','vtv9':'39','vtv10':'6',
  'vietnamtoday':'vietnamtoday'
};
var vtvgoSchedulePage='https://www.vtvgo.vn/schedule';
function officialVtvgoId(c){
  // Bundle's original IDs take priority, so a user-entered similarly named
  // channel with its own EPG ID does not accidentally inherit another guide.
  var key=cleanName(c.originalId||c.tvgId||c.name);
  return vtvgoOfficialChannels[key]||null;
}
function vietnamDate(){
  var now=new Date();
  return now.getFullYear()+'-'+('0'+(now.getMonth()+1)).slice(-2)+'-'+('0'+now.getDate()).slice(-2);
}
function vtvgoPrograms(data,channelId){
  var days=data&&data.data&&data.data[channelId];
  if(!Array.isArray(days))throw new Error('VTVgo chưa trả lịch cho mã kênh này');
  var entries=[],seen={};
  days.forEach(function(day){
    (day.programs||[]).forEach(function(p){
      var start=Date.parse(p.startTime),stop=Date.parse(p.endTime);
      var title=String(p.title||'').trim();
      var desc=String(p.description||'').trim();
      if(!title&&desc){title=desc;desc='';}
      if(!title||!isFinite(start)||!isFinite(stop)||stop<=start)return;
      var unique=start+'|'+title;
      if(seen[unique])return;
      seen[unique]=true;
      entries.push({start:start,stop:stop,title:desc&&desc!==title?title+': '+desc:title});
    });
  });
  entries.sort(function(a,b){return a.start-b.start;});
  return entries;
}
function loadOfficialVtvgoGuide(c,token){
  var id=officialVtvgoId(c),date=vietnamDate();
  var url='https://api.vtvdigital.org/display/v21.0/epg?channelIDs='+
    encodeURIComponent(id)+'&from='+date+'&to='+date;
  currentGuideUrl=vtvgoSchedulePage;
  $('#officialGuideBtn').hidden=true;
  $('#guideProvenance').textContent='Lịch chính thức VTVgo · Giờ Việt Nam · Không xác nhận nguồn video IPTV.';
  var target=$('#guideItems');
  if(guideCache[url]&&Date.now()-guideCache[url].at<600000){
    renderGuide(guideCache[url].data);
    return;
  }
  target.textContent='Đang tải lịch chính thức VTVgo…';
  fetch(url).then(function(response){
    if(!response.ok)throw new Error('HTTP '+response.status);
    return response.json();
  }).then(function(data){
    if(token!==guideToken)return;
    var entries=vtvgoPrograms(data,id);
    if(!entries.length)throw new Error('VTVgo chưa có chương trình hôm nay');
    guideCache[url]={data:entries,at:Date.now()};
    renderGuide(entries);
  }).catch(function(e){
    if(token!==guideToken)return;
    showGuideFallback(c,'Chưa tải được lịch VTVgo ('+e.message+'). Bạn có thể mở lịch trên VTVgo để kiểm tra.',vtvgoSchedulePage);
  });
}
var vtvcabOfficialSchedulePage='https://on.vtvcab.vn/channel/epg/vtvcab';
// XMLTV matching exactly the provider-listed channel id, not a fuzzy
// title lookup. Fetch on demand, cache 20 min, parse only the requested
// programme rows (the full EPG XML is around 9 MB).
var vnEpgUrl='https://epg.io.vn/epg.xml';
var vnEpgRaw='',vnEpgLoaded=0,vnEpgPending=null;
function fetchVnXmltv(){
  if(vnEpgRaw&&Date.now()-vnEpgLoaded<1200000)return Promise.resolve(vnEpgRaw);
  if(vnEpgPending)return vnEpgPending;
  vnEpgPending=fetch(vnEpgUrl).then(function(response){
    if(!response.ok)throw new Error('HTTP '+response.status);
    return response.text();
  }).then(function(body){
    if(body.indexOf('<tv')<0||body.indexOf('<programme')<0)
      throw new Error('Không có dữ liệu chương trình XMLTV');
    vnEpgRaw=body;vnEpgLoaded=Date.now();vnEpgPending=null;return body;
  }).catch(function(error){vnEpgPending=null;throw error;});
  return vnEpgPending;
}
function parseVnXmltvTimestamp(value){
  var m=String(value||'').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-])(\d{2})(\d{2})/);
  if(!m)return NaN;
  var utc=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||'0'));
  var mins=+m[8]*60+(+m[9]);
  return utc+(m[7]==='+'?-1:1)*mins*60000;
}
function parseVnXmltvPrograms(raw,id){
  if(!id||!/^[A-Za-z0-9_-]{2,80}$/.test(id))return [];
  var tag='channel="'+id+'"',i=0,entries=[],seen={};
  while((i=raw.indexOf(tag,i))>=0){
    var startTag=raw.lastIndexOf('<programme',i);
    var endTag=raw.indexOf('>',startTag);
    if(startTag>=0&&endTag>=i&&endTag-i<400){
      var meta=raw.slice(startTag,endTag+1);
      var start=meta.match(/\bstart="([^"]+)"/),stop=meta.match(/\bstop="([^"]+)"/);
      var close=raw.indexOf('</programme>',endTag);
      if(start&&stop&&close>=0&&close-endTag<8000){
        var block=raw.slice(endTag+1,close);
        var title=block.match(/<title(?:\s+[^>]*)?>([\s\S]*?)<\/title>/i);
        if(title){
          var ts=parseVnXmltvTimestamp(start[1]),te=parseVnXmltvTimestamp(stop[1]);
          if(isFinite(ts)&&isFinite(te)&&te>ts&&!seen[ts]){
            var decoded=new DOMParser().parseFromString('<x>'+title[1]+'</x>','application/xml');
            var label=decoded.documentElement&&decoded.documentElement.textContent||'';
            label=label.trim();
            if(label){entries.push({start:ts,stop:te,title:label});seen[ts]=true;}
          }
        }
      }
      i=Math.max(i+tag.length,close>=0?close+12:i+tag.length);
    }else i+=tag.length;
    if(entries.length>320)break;
  }
  entries.sort(function(a,b){return a.start-b.start;});
  return entries;
}
function loadVn172Guide(c,token){
  var id=c.epgId;
  $('#guideProvenance').textContent='Lịch XMLTV epg.io.vn · Mã '+(id||'chưa xác định')+' · Giờ Việt Nam.';
  $('#officialGuideBtn').hidden=true;
  if(!id){
    showGuideFallback(c,'Nguồn EPG chưa cung cấp mã khớp chắc chắn với kênh này. Không gán lịch của kênh khác.','');
    if(isVtvcabGuide(c))showVtvcabOfficialLink();
    return;
  }
  currentGuideUrl='';
  var box=$('#guideItems');
  var cacheKey='vn172|'+id;
  if(guideCache[cacheKey]&&Date.now()-guideCache[cacheKey].at<600000){
    renderGuide(guideCache[cacheKey].data);
    if(isVtvcabGuide(c))showVtvcabOfficialLink();
    return;
  }
  box.textContent='Đang tải lịch XMLTV Việt Nam…';
  fetchVnXmltv().then(function(raw){
    if(token!==guideToken)return;
    var entries=parseVnXmltvPrograms(raw,id);
    if(!entries.length)throw new Error('Nguồn XMLTV chưa có chương trình cho mã '+id);
    guideCache[cacheKey]={at:Date.now(),data:entries};
    renderGuide(entries);
    if(isVtvcabGuide(c))showVtvcabOfficialLink();
  }).catch(function(error){
    if(token!==guideToken)return;
    showGuideFallback(c,'Lịch XMLTV chưa tải được ('+error.message+'). Không dùng lịch sai của kênh khác.','');
    if(isVtvcabGuide(c))showVtvcabOfficialLink();
  });
}

var currentGuideUrl='';
function baoMoiGuideUrl(c){
  var keys=[c.originalId,c.tvgId,c.name].filter(Boolean), key,slug;
  for(var i=0;i<keys.length;i++){
    key=cleanName(keys[i]);
    slug=baoMoiGuideSlugs[key];
    if(slug)return 'https://baomoi.com/tien-ich-lich-truyen-hinh-'+slug+'.epi';
  }
  return '';
}
function isVtvcabGuide(c){
  return /vtvcab|^on(?:\s|[-+]|$)/i.test(c.name||'') ||
    /vtvcab/i.test(c.group||'');
}
function showGuideFallback(c,message,url){
  var box=$('#guideItems');
  box.textContent=message;
  currentGuideUrl=url||'';
  var btn=$('#officialGuideBtn');
  btn.hidden=!(currentGuideUrl||isVtvcabGuide(c));
  btn.textContent=isVtvcabGuide(c)?'Mở lịch chính thức VTVcab':
    (currentGuideUrl.indexOf('vtvgo.vn')>=0?'Mở lịch chính thức VTVgo':'Xem lịch tại trang nguồn');
}
function parseBaoMoiGuide(raw){
  var doc=new DOMParser().parseFromString(raw,'text/html');
  var text=doc.body ? doc.body.textContent : '';
  var dateText=text.match(/Kênh\s+[^\n]{1,100}?Ngày\s+(\d{2})-(\d{2})-(\d{4})/i);
  if(!dateText){
    var all=raw.match(/Ngày\s+(\d{2})-(\d{2})-(\d{4})/);
    dateText=all;
  }
  if(!dateText)throw new Error('Không tìm thấy ngày lịch');
  var day=+dateText[1],month=+dateText[2]-1,year=+dateText[3];
  var rows=doc.querySelectorAll('.rc-table-tbody tr');
  var entries=[],seen={};
  for(var i=0;i<rows.length;i++){
    var cells=rows[i].querySelectorAll('td');
    if(cells.length<2)continue;
    var time=cells[0].textContent.trim();
    var program=cells[1].textContent.trim();
    if(!/^\d{2}:\d{2}$/.test(time)||!program)continue;
    var parts=time.split(':');
    var timestamp=new Date(year,month,day,+parts[0],+parts[1]).getTime();
    if(!isFinite(timestamp))continue;
    var unique=time+'|'+program;
    if(seen[unique])continue;
    seen[unique]=true;
    entries.push({start:timestamp,title:program});
  }
  entries.sort(function(a,b){return a.start-b.start;});
  for(var j=0;j<entries.length;j++){
    entries[j].stop=j+1<entries.length?entries[j+1].start:entries[j].start+1800000;
  }
  if(!entries.length)throw new Error('Trang chưa có chương trình');
  return entries;
}
function openGuidePanel(){
  if(!playing)return;
  closePlayerPanels();clearNumber();guidePanelOpen=true;
  $('#guidePanel').hidden=false;
  var c=playingList[currentIndex],target=$('#guideItems');
  $('#guideChannelName').textContent=c.name;
  $('#guideProvenance').textContent='Lịch tham khảo theo kênh · Không xác nhận nguồn video IPTV.';
  if(isVtvcabGuide(c)){
    $('#guideProvenance').textContent='Lịch tham khảo Báo Mới · Có thể đối chiếu lịch VTVcab chính thức bên dưới.';
    $('#officialGuideBtn').hidden=false;
    $('#officialGuideBtn').textContent='Mở lịch chính thức VTVcab';
  }
  var token=++guideToken;
  // VTV remains on the broadcaster's verified official VTVgo guide.
  if(officialVtvgoId(c)){
    loadOfficialVtvgoGuide(c,token);
    return;
  }
  // Remaining stations use the XMLTV file declared in the verified
  // LaunchPad Vietnam 172-channel playlist, never guessed guide IDs.
  if(c.epgProvider==='vn-epg'){
    loadVn172Guide(c,token);
    return;
  }
  var url=baoMoiGuideUrl(c);
  currentGuideUrl=url;
  $('#officialGuideBtn').hidden=true;
  if(!url){
    if(c.origin==='launchpad')
      showGuideFallback(c,'Chưa có lịch phát sóng được xác minh cho kênh LaunchPad này. Tệp EPG mẫu trong repository không khớp đa số mã kênh Mỹ, nên GoSamTV không hiển thị lịch giả.',url);
    else
      showGuideFallback(c,'Chưa tìm được lịch phát sóng phù hợp cho kênh này. Không ảnh hưởng đến việc xem truyền hình.',url);
    if(isVtvcabGuide(c))showVtvcabOfficialLink();
    return;
  }
  if(guideCache[url] && Date.now()-guideCache[url].at<600000){
    renderGuide(guideCache[url].data);
    if(isVtvcabGuide(c))showVtvcabOfficialLink();
    return;
  }
  target.textContent='Đang tải lịch tham khảo theo tên kênh từ Báo Mới…';
  fetchPlaylist(url).then(function(raw){
    if(token!==guideToken)return;
    var entries=parseBaoMoiGuide(raw);
    guideCache[url]={data:entries,at:Date.now()};
    renderGuide(entries);
    if(isVtvcabGuide(c))showVtvcabOfficialLink();
  }).catch(function(e){
    if(token===guideToken){
      showGuideFallback(c,'Lịch tham khảo hiện không tải được ('+e.message+'). Hãy kiểm tra trên VTVcab chính thức.',url);
      if(isVtvcabGuide(c))showVtvcabOfficialLink();
    }
  });
}
function showVtvcabOfficialLink(){
  $('#officialGuideBtn').hidden=false;
  $('#officialGuideBtn').textContent='Mở lịch chính thức VTVcab';
}
$('#officialGuideBtn').onclick=function(){
  var c=playingList[currentIndex];
  var url=c&&isVtvcabGuide(c)?vtvcabOfficialSchedulePage:
    (currentGuideUrl||vtvcabOfficialSchedulePage);
  try{
    var tab=window.open(url,'_blank');
    if(!tab)notify('Đường dẫn lịch: '+url);
  }catch(e){notify('Đường dẫn lịch: '+url);}
};
function renderGuide(entries){
  var box=$('#guideItems');box.innerHTML='';
  if(!entries.length){box.textContent='Chưa có lịch phát sóng cho kênh này.';return;}
  var now=Date.now(),start=new Date();start.setHours(0,0,0,0);
  var end=start.getTime()+86400000,count=0;
  entries.forEach(function(e){
    var ts=new Date(e.start).getTime(),te=new Date(e.stop).getTime();
    if(!ts||ts>=end||te<=start.getTime())return;
    if(count++>100)return;
    var row=document.createElement('div');row.className='guide-entry'+(ts<=now&&now<te?' live':'');
    var time=document.createElement('strong');time.textContent=fmtHour(ts);row.appendChild(time);
    var label=document.createElement('span');label.textContent=e.title||'Chưa có tên chương trình';row.appendChild(label);
    box.appendChild(row);
  });
  if(count){
    var current=box.querySelector('.guide-entry.live');
    if(current){
      var program=current.querySelector('span');
      // Keep the channel heading compact; the highlighted row already shows the on-air program.
      $('#guideChannelName').textContent=playingList[currentIndex].name;
      current.scrollIntoView({block:'center'});
    }
  }
  if(!count){
    box.textContent='Lịch trên trang nguồn chưa được cập nhật cho ngày hôm nay. Bạn có thể kiểm tra trực tiếp tại Báo Mới.';
    if(currentGuideUrl){
      $('#officialGuideBtn').hidden=false;
      $('#officialGuideBtn').textContent=isVtvcabGuide(playingList[currentIndex])?
        'Mở lịch chính thức VTVcab':'Xem lịch tại trang nguồn';
    }
  }
}
function clearNumber(){numberBuffer='';clearTimeout(numberTimer);$('#numberHud').hidden=true;if(numberPadOpen)updateNumberPadValue();}
function collectNumber(digit){
  if(!playing)return;
  if(numberPadOpen){padDigit(digit);return;}
  closePlayerPanels();
  numberBuffer=(numberBuffer+digit).slice(-3);
  $('#numberHud').textContent='Kênh '+numberBuffer;$('#numberHud').hidden=false;
  clearTimeout(numberTimer);
  numberTimer=setTimeout(commitNumber,1300);
}
function commitNumber(){
  var n=parseInt(numberBuffer,10);
  if(numberPadOpen)hideNumberPad();else clearNumber();
  if(!playing||!n||n>state.channels.length){notify('Không có kênh số '+n);return;}
  // Always use the full catalog: searches/favorites must not renumber channels.
  play(state.channels,n-1);
}
function panelMove(delta){
  var index=parseInt((document.activeElement&&document.activeElement.dataset.index)||currentIndex,10);
  if(isNaN(index))index=currentIndex;
  var target=Math.max(0,Math.min(playingList.length-1,index+delta));
  var found=$('#channelPanelItems').querySelector('[data-index="'+target+'"]');
  if(found)setFocus(found);
  else openChannelPanel(target);
}
function move(dir){
  var root=numberPadOpen?$('#numberPad'):(!$('#aboutDialog').hidden?$('#aboutDialog'):(!$('#dialog').hidden?$('#dialog'):$('#home')));
  var list=Array.prototype.slice.call(root.querySelectorAll('button:not([disabled]),input,textarea,a[href]')).filter(function(el){return el.getClientRects().length>0;});
  var cur=document.activeElement;if(list.indexOf(cur)<0){setFocus(list[0]);return;}
  var a=cur.getBoundingClientRect(),cx=a.left+a.width/2,cy=a.top+a.height/2,best=null,score=1e9;
  list.forEach(function(el){if(el===cur)return;var r=el.getBoundingClientRect(),dx=r.left+r.width/2-cx,dy=r.top+r.height/2-cy;
    if((dir==='left'&&dx>=-3)||(dir==='right'&&dx<=3)||(dir==='up'&&dy>=-3)||(dir==='down'&&dy<=3))return;
    var primary=dir==='left'||dir==='right'?Math.abs(dx):Math.abs(dy),secondary=dir==='left'||dir==='right'?Math.abs(dy):Math.abs(dx);
    var s=primary+secondary*1.7;if(s<score){score=s;best=el;}
  });if(best)setFocus(best);
}
function showAbout(){
  $('#aboutCount').textContent=state.channels.length+' kênh';
  $('#aboutDialog').hidden=false;
  setFocus($('#closeAbout'));
}
function closeAbout(){
  $('#aboutDialog').hidden=true;
  setFocus($('#infoBtn'));
}
function back(){if(!$('#aboutDialog').hidden){closeAbout();return;}if(playing){closePlayer();return;}if(!$('#dialog').hidden){$('#saveSource').onclick=addSource;$('#saveSource').textContent='Lưu danh sách';$('#dialogTitle').textContent='Thêm danh sách M3U';closeDialog();return;}
  if(state.filter!=='all'){chooseGroup('all',true);return;}
  try{window.tizen.application.getCurrentApplication().exit();}catch(e){}
}
function registerRemoteNumberKeys(){
  try{
    if(!window.tizen || !tizen.tvinputdevice)return;
    var tv=tizen.tvinputdevice;
    var supported=tv.getSupportedKeys();
    for(var i=0;i<supported.length;i++){
      var item=supported[i],name=item.name;
      if(/^[0-9]$/.test(name)){
        remoteNumberCodes[item.code]=name;
        try{tv.registerKey(name);}catch(e){}
      }
    }
    ['Extra','Info'].forEach(function(name){try{tv.registerKey(name);}catch(e){}});
  }catch(e){}
}
function numberDigitFromEvent(e){
  var k=e.keyCode;
  if(k>=48&&k<=57)return String(k-48);
  if(k>=96&&k<=105)return String(k-96);
  if(Object.prototype.hasOwnProperty.call(remoteNumberCodes,k))return remoteNumberCodes[k];
  if(e.key&&/^[0-9]$/.test(e.key))return e.key;
  return null;
}
function showNumberPad(){
  if(!playing)return;
  closePlayerPanels();clearNumber();hidePlayerOSD();
  numberPadOpen=true;
  $('#numberPad').hidden=false;
  updateNumberPadValue();
  setFocus($('#numberPadGrid button'));
}
function hideNumberPad(){
  numberPadOpen=false;$('#numberPad').hidden=true;
  clearNumber();
}
function updateNumberPadValue(){
  $('#numberPadValue').textContent=numberBuffer ? 'Kênh '+numberBuffer : 'Nhập số kênh (1–'+state.channels.length+')';
}
function padDigit(digit){
  if(numberBuffer.length>=3)return;
  numberBuffer+=digit;
  updateNumberPadValue();
}
function exitChannelSearch(){
  var el=$('#channelSearch');
  if(document.activeElement===el)el.blur();
  searchImeOpen=false;
  var first=$('#channels .channel');
  setFocus(first || $('#channelGroups .group-chip:not([style*="display:none"])') || $('#add'));
}
function onKey(e) {
  var k=e.keyCode;
  if(!playing && k===13&&Date.now()<launchGuard){e.preventDefault();return;}
  if(k===10009||k===27||k===65385){
    if(document.activeElement===$('#channelSearch') || searchImeOpen){
      e.preventDefault();exitChannelSearch();return;
    }
    if(numberPadOpen){e.preventDefault();hideNumberPad();return;}
    e.preventDefault();
    if(playing&&(channelPanelOpen||guidePanelOpen)){closePlayerPanels();return;}
    back();return;
  }
  if(!$('#aboutDialog').hidden){
    if(k===13){
      e.preventDefault();
      if(document.activeElement&&document.activeElement.click)document.activeElement.click();
      return;
    }
    if(k===37||k===38||k===39||k===40){
      e.preventDefault();move({37:'left',38:'up',39:'right',40:'down'}[k]);return;
    }
    return;
  }
  if(playing){
    var digit=numberDigitFromEvent(e);
    if(digit!==null){e.preventDefault();collectNumber(digit);return;}
    if(numberPadOpen){
      if(k===13){e.preventDefault();if(document.activeElement&&document.activeElement.click)document.activeElement.click();return;}
      if(k===37||k===38||k===39||k===40){e.preventDefault();move({37:'left',38:'up',39:'right',40:'down'}[k]);return;}
      return;
    }
    if(k===10253){e.preventDefault();showNumberPad();return;} // "Extra" key where available

    if(channelPanelOpen){
      if(k===13){e.preventDefault();var chosen=document.activeElement;if(chosen&&chosen.click)chosen.click();return;}
      if(k===38||k===40){e.preventDefault();panelMove(k===38?-1:1);return;}
      if(k===39){e.preventDefault();openGuidePanel();return;}
      if(k===37){e.preventDefault();closePlayerPanels();return;}
      return;
    }
    if(guidePanelOpen){
      if(k===13 && !document.getElementById('officialGuideBtn').hidden && getComputedStyle(document.getElementById('officialGuideBtn')).display!=='none'){e.preventDefault();document.getElementById('officialGuideBtn').click();return;}
      if(k===37){e.preventDefault();openChannelPanel();return;}
      if(k===39){e.preventDefault();closePlayerPanels();return;}
      if(k===38||k===40){e.preventDefault();$('#guideItems').scrollTop+=(k===38?-100:100);return;}
      return;
    }
    if(k===37){e.preventDefault();openChannelPanel();return;}
    if(k===39){e.preventDefault();openGuidePanel();return;}
    if(k===38||k===427){e.preventDefault();step(-1);return;}
    if(k===40||k===428){e.preventDefault();step(1);return;}
    if(k===13){
      e.preventDefault();
      if(numberBuffer){commitNumber();return;}
      if($('#player').classList.contains('osd-hidden')){
        revealPlayerOSD(5000);
        setFocus($('#openNumberPad'));
      }else if(document.activeElement===$('#openNumberPad')){
        showNumberPad();
      }else hidePlayerOSD();
      return;
    }
    return;
  }
  if((k===65376||k===65385) && (searchImeOpen||document.activeElement===$('#channelSearch'))){
    e.preventDefault();exitChannelSearch();return;
  }
  var dirs={37:'left',38:'up',39:'right',40:'down'};
  if(dirs[k]){if(document.activeElement&&/INPUT|TEXTAREA/.test(document.activeElement.tagName))return;e.preventDefault();move(dirs[k]);return;}
  if(k===13){
    var el=document.activeElement;
    if(el&&el.classList&&el.classList.contains('channel')) {
      e.preventDefault();
      if (!enterDownAt) enterDownAt=Date.now();
      if (e.repeat && Date.now()-enterDownAt>650) enterHeld=true;
      return;
    }
    if(el&&el.click&&!/INPUT|TEXTAREA/.test(el.tagName)){e.preventDefault();el.click();}
  }
}
$('#infoBtn').onclick=showAbout;
$('#closeAbout').onclick=closeAbout;
$('#add').onclick=showDialog;
$('#cancelSource').onclick=back;
$('#saveSource').onclick=addSource;
$('#manageBtn').onclick=manage;
Array.prototype.forEach.call(document.querySelectorAll('#channelGroups .group-chip'),function(button){
  button.onclick=function(){chooseGroup(button.getAttribute('data-filter'),true);};
});
$('#favoritesBtn').onclick=function(){chooseGroup('fav',true);};
function applyChannelSearch(value) {
  query=String(value||'').trim();
  state.filter=query?'search':'all';
  $('#clearSearch').hidden=!query;
  render();
}
$('#channelSearch').addEventListener('focus',function(){searchImeOpen=true;});
$('#channelSearch').addEventListener('blur',function(){searchImeOpen=false;});
$('#exitSearch').onclick=exitChannelSearch;
$('#openNumberPad').onclick=showNumberPad;
$('#numPadClose').onclick=hideNumberPad;
$('#numPadDelete').onclick=function(){numberBuffer=numberBuffer.slice(0,-1);updateNumberPadValue();};
$('#numPadGo').onclick=commitNumber;
Array.prototype.forEach.call(document.querySelectorAll('#numberPadGrid [data-digit]'),function(btn){
  btn.onclick=function(){padDigit(btn.getAttribute('data-digit'));};
});
$('#channelSearch').addEventListener('input',function(){
  applyChannelSearch(this.value);
});
$('#channelSearch').addEventListener('keydown',function(e){
  if(e.keyCode===13 || e.keyCode===65376){
    e.preventDefault();
    exitChannelSearch();
    var first=$('#channels .channel');
    if(first)setFocus(first);
  }
});
$('#clearSearch').onclick=function(){
  $('#channelSearch').value='';
  applyChannelSearch('');
  setFocus($('#channelSearch'));
};
$('#favNow').onclick=function(){toggleFav(playingList[currentIndex]);};
document.addEventListener('keydown',onKey);
document.addEventListener('keyup',function(e){
  if(e.keyCode!==13 || !enterDownAt)return;
  var held=enterHeld || (Date.now()-enterDownAt>650), el=document.activeElement;
  enterDownAt=0;enterHeld=false;
  if(!el||!el.classList||!el.classList.contains('channel'))return;
  var idx=Array.prototype.indexOf.call($('#channels').children,el);
  var c=list()[idx];
  if(c){if(held)toggleFav(c);else el.click();}
});
document.addEventListener('visibilitychange',function(){if(document.hidden)closePlayer();});
function clock(){var d=new Date();$('#time').textContent=('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);}
load();render();clock();registerRemoteNumberKeys();setInterval(clock,60000);setFocus($('#add'));
window.GoSamLite={parseM3u:parseM3u,getChannels:function(){return state.channels.slice();},isPlaying:function(){return playing;},getSources:function(){return state.sources.slice();}};
})();