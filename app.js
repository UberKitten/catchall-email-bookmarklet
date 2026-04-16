(() => {
  const PSL_URL = 'https://cdn.jsdelivr.net/gh/publicsuffix/list@master/public_suffix_list.dat';
  const PSL_CACHE_KEY = 'psl_cache_v1';
  const DOMAIN_KEY = 'email_domain';
  const PSL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  const $ = (id) => document.getElementById(id);
  const domainInput = $('domain');
  const copyBtn = $('copy');
  const bookmarkletLink = $('bookmarklet');
  const previewEl = $('preview');
  const statusEl = $('status');
  const emailIn = $('email-in');
  const decodedEl = $('decoded');
  const outDomain = $('out-domain');
  const outDate = $('out-date');
  const outRel = $('out-rel');
  const decodeStatus = $('decode-status');
  const pslMeta = $('psl-meta');
  const pslPayload = $('psl-payload');

  let pslRules = null;
  let pslCompressedB64 = null;

  // ---- PSL fetch + parse ------------------------------------------------

  async function loadPsl() {
    const cached = readPslCache();
    if (cached && Date.now() - cached.fetchedAt < PSL_TTL_MS) {
      await setPsl(cached.text, cached.fetchedAt, true);
      return;
    }
    try {
      const res = await fetch(PSL_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const fetchedAt = Date.now();
      try {
        localStorage.setItem(PSL_CACHE_KEY, JSON.stringify({ text, fetchedAt }));
      } catch {}
      await setPsl(text, fetchedAt, false);
    } catch (err) {
      if (cached) {
        await setPsl(cached.text, cached.fetchedAt, true);
        pslMeta.textContent = `PSL loaded from stale cache (${formatDate(cached.fetchedAt)}); jsDelivr unreachable.`;
      } else {
        pslMeta.textContent = 'failed to load PSL: ' + err.message;
      }
    }
  }

  function readPslCache() {
    try {
      const raw = localStorage.getItem(PSL_CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj.text || !obj.fetchedAt) return null;
      return obj;
    } catch {
      return null;
    }
  }

  async function setPsl(text, fetchedAt, fromCache) {
    pslRules = parsePsl(text);
    const minified = pslRules.join('\n');
    pslCompressedB64 = await gzipToBase64(minified);
    pslMeta.textContent = `PSL: ${pslRules.length.toLocaleString()} rules, fetched ${formatDate(fetchedAt)}${fromCache ? ' (cache)' : ''}.`;
    pslPayload.textContent = `Bookmarklet payload: ${formatBytes(pslCompressedB64.length)} (gzip+base64).`;
    refresh();
  }

  function parsePsl(text) {
    const out = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;
      out.push(trimmed.split(/\s/)[0]);
    }
    return out;
  }

  async function gzipToBase64(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  function registrable(hostname, rules) {
    const lbl = hostname.toLowerCase().split('.');
    let n = 1;
    for (const r of rules) {
      const exc = r[0] === '!';
      const rl = (exc ? r.slice(1) : r).split('.');
      if (rl.length > lbl.length) continue;
      let match = true;
      for (let i = 0; i < rl.length; i++) {
        const a = rl[rl.length - 1 - i];
        const b = lbl[lbl.length - 1 - i];
        if (a !== '*' && a !== b) { match = false; break; }
      }
      if (!match) continue;
      if (exc) { n = rl.length - 1; break; }
      if (rl.length > n) n = rl.length;
    }
    if (n >= lbl.length) return hostname;
    return lbl.slice(-(n + 1)).join('.');
  }

  // ---- Bookmarklet build ------------------------------------------------

  // Runs in the target page. Payload is the PSL, minified (one rule per line,
  // no comments), gzip-compressed, then base64-encoded. Decompressed on click
  // via DecompressionStream. Firefox rejects bookmarks with URLs over ~64KB,
  // which is why the PSL isn't embedded verbatim.
  const BOOKMARKLET_TEMPLATE = `(async()=>{try{
const B=__PSL__,D=__DOMAIN__,ts=Math.floor(Date.now()/1000).toString(36);
const bin=atob(B),arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
const rules=(await new Response(new Blob([arr]).stream().pipeThrough(new DecompressionStream('gzip'))).text()).split('\\n');
const lbl=location.hostname.toLowerCase().split('.');
let n=1;
for(const r of rules){const e=r[0]==='!',rl=(e?r.slice(1):r).split('.');if(rl.length>lbl.length)continue;let m=1;for(let i=0;i<rl.length;i++){const a=rl[rl.length-1-i],b=lbl[lbl.length-1-i];if(a!=='*'&&a!==b){m=0;break;}}if(!m)continue;if(e){n=rl.length-1;break;}if(rl.length>n)n=rl.length;}
const reg=n>=lbl.length?location.hostname:lbl.slice(-(n+1)).join('.');
await navigator.clipboard.writeText(reg+'-'+ts+'@'+D);
}catch(e){alert('bookmarklet error: '+e.message);}})()`;

  function buildBookmarklet(pslB64, emailDomain) {
    const src = BOOKMARKLET_TEMPLATE
      .replace('__PSL__', JSON.stringify(pslB64))
      .replace('__DOMAIN__', JSON.stringify(emailDomain));
    return 'javascript:' + encodeURIComponent(src);
  }

  // ---- UI wiring --------------------------------------------------------

  function getDomain() {
    return domainInput.value.trim().toLowerCase();
  }

  function validDomain(d) {
    return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(d);
  }

  function refresh() {
    const domain = getDomain();
    const hasValidDomain = validDomain(domain);
    const ready = pslCompressedB64 && hasValidDomain;

    copyBtn.disabled = !ready;
    bookmarkletLink.setAttribute('aria-disabled', ready ? 'false' : 'true');
    if (ready) {
      bookmarkletLink.href = buildBookmarklet(pslCompressedB64, domain);
    } else {
      bookmarkletLink.removeAttribute('href');
    }

    if (!pslCompressedB64) {
      previewEl.textContent = '(waiting for PSL\u2026)';
      return;
    }
    if (domain && !hasValidDomain) {
      previewEl.textContent = '(enter a valid domain like example.com)';
      return;
    }
    const previewDomain = domain || domainInput.placeholder || 'example.com';
    const here = registrable(location.hostname, pslRules);
    const ts = Math.floor(Date.now() / 1000).toString(36);
    previewEl.textContent = `${here}-${ts}@${previewDomain}`;
  }

  async function copyBookmarklet() {
    const domain = getDomain();
    if (!validDomain(domain) || !pslCompressedB64) return;
    const src = buildBookmarklet(pslCompressedB64, domain);
    try {
      await navigator.clipboard.writeText(src);
      flash(statusEl, `copied (${formatBytes(src.length)}) to clipboard.`, 'ok');
    } catch (e) {
      flash(statusEl, 'copy failed: ' + e.message, 'err');
    }
  }

  function onDomainChange() {
    const d = getDomain();
    try { localStorage.setItem(DOMAIN_KEY, d); } catch {}
    refresh();
  }

  // ---- Decoder ----------------------------------------------------------

  function decode(email) {
    const at = email.lastIndexOf('@');
    if (at < 0) return { error: 'missing @' };
    const local = email.slice(0, at).trim();
    const dash = local.lastIndexOf('-');
    if (dash < 0) return { error: 'no timestamp delimiter (-) found in local part' };
    const domain = local.slice(0, dash);
    const tsStr = local.slice(dash + 1);
    if (!/^[0-9a-z]+$/i.test(tsStr)) return { error: 'timestamp segment is not base36' };
    const secs = parseInt(tsStr, 36);
    if (!Number.isFinite(secs) || secs <= 0) return { error: 'timestamp did not parse' };
    const ms = secs * 1000;
    const now = Date.now();
    if (ms > now + 86400000) return { error: 'timestamp is in the future' };
    if (ms < new Date('2001-01-01').getTime()) return { error: 'timestamp predates this tool' };
    return { domain, date: new Date(ms) };
  }

  function onDecodeInput() {
    const val = emailIn.value.trim();
    if (!val) {
      decodedEl.hidden = true;
      decodeStatus.textContent = '';
      decodeStatus.className = 'status';
      return;
    }
    const r = decode(val);
    if (r.error) {
      decodedEl.hidden = true;
      decodeStatus.textContent = r.error;
      decodeStatus.className = 'status err';
      return;
    }
    decodeStatus.textContent = '';
    decodeStatus.className = 'status';
    outDomain.textContent = r.domain;
    outDate.textContent = r.date.toLocaleString(undefined, {
      dateStyle: 'full',
      timeStyle: 'medium'
    });
    outRel.textContent = relativeTime(r.date);
    decodedEl.hidden = false;
  }

  // ---- Helpers ----------------------------------------------------------

  function formatDate(ms) {
    return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    return (n / 1024).toFixed(1) + ' KB';
  }

  function relativeTime(date) {
    const diff = Date.now() - date.getTime();
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    const abs = Math.abs(diff);
    const sign = diff > 0 ? -1 : 1;
    const units = [
      ['year',   365 * 86400000],
      ['month',   30 * 86400000],
      ['week',     7 * 86400000],
      ['day',          86400000],
      ['hour',          3600000],
      ['minute',          60000],
      ['second',           1000]
    ];
    for (const [unit, ms] of units) {
      if (abs >= ms || unit === 'second') {
        return rtf.format(Math.round(sign * abs / ms), unit);
      }
    }
    return '';
  }

  function flash(el, msg, cls) {
    el.textContent = msg;
    el.className = 'status ' + (cls || '');
    clearTimeout(flash._t);
    flash._t = setTimeout(() => {
      if (el.textContent === msg) {
        el.textContent = '';
        el.className = 'status';
      }
    }, 3500);
  }

  // ---- Bootstrap --------------------------------------------------------

  try {
    const saved = localStorage.getItem(DOMAIN_KEY);
    if (saved) domainInput.value = saved;
  } catch {}

  domainInput.addEventListener('input', onDomainChange);
  copyBtn.addEventListener('click', copyBookmarklet);
  bookmarkletLink.addEventListener('click', (e) => {
    if (bookmarkletLink.getAttribute('aria-disabled') === 'true') {
      e.preventDefault();
      flash(statusEl, 'enter a domain first.', 'err');
    } else {
      e.preventDefault();
      flash(statusEl, 'drag this link to your bookmarks bar; clicking it here does nothing useful.', '');
    }
  });
  emailIn.addEventListener('input', onDecodeInput);

  refresh();
  loadPsl();
})();
