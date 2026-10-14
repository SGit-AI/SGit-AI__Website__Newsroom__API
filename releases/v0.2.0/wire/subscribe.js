// wire/subscribe.js: subscribe to one wire alone.
//
// The same lane, the same recipient and the same envelope as the newsletter's form (assets/subscribe.js,
// sgit.ai's, vendored unedited): what the reader types is encrypted in this browser to the public key of the
// agent that manages the list (sgit's hybrid envelope v2: a fresh AES-256-GCM key wrapped with RSA-OAEP to the
// agent's key), then dropped into the write-only `subscribe` append lane of the subscribe vault, whose details
// are public in /.well-known/sgit-subscribe.json. Nothing is stored on this site. What differs is one header:
// X-SGit-List names the wire (wire:industry, wire:owasp, wire:aws), so the agent that drains the lane keeps one
// list per wire; a request without it is the newsletter, as before. The brief for that agent: wire/desk-brief.md.
(function () {
  'use strict';
  var forms = document.querySelectorAll('form[data-wire-subscribe]');
  if (!forms.length) return;
  var te = new TextEncoder();
  var root = document.documentElement.getAttribute('data-root') || '';

  function b64(bytes) { var s = ''; bytes = new Uint8Array(bytes); for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
  function pemToDer(pem) { var b = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''); var bin = atob(b); var out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out.buffer; }
  async function fingerprint(pem) {
    var h = await crypto.subtle.digest('SHA-256', pemToDer(pem));
    return 'sha256:' + Array.prototype.map.call(new Uint8Array(h), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('').slice(0, 16);
  }
  async function encrypt(recipientPem, plaintext) {
    var pub = await crypto.subtle.importKey('spki', pemToDer(recipientPem), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    var aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    var raw = await crypto.subtle.exportKey('raw', aes);
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, tagLength: 128 }, aes, te.encode(plaintext));
    var w = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, raw);
    var enc = btoa(JSON.stringify({ v: 2, w: b64(w), i: b64(iv), c: b64(c) }));
    return { enc: enc, payload: btoa(enc) };
  }

  Array.prototype.forEach.call(forms, function (form) {
    var list = form.getAttribute('data-list') || 'wire', name = form.getAttribute('data-name') || 'the wire';
    var status = form.querySelector('.sub-status'), button = form.querySelector('button[type="submit"]'), mailto = form.querySelector('.sub-mailto');
    var box = form.closest('.wire-sub');
    var say = function (text, cls) { status.textContent = text; status.className = 'sub-status' + (cls ? ' ' + cls : ''); };
    var field = function (n) { var el = form.elements[n]; return el ? String(el.value || '').trim() : ''; };
    var one = function (s) { return s.replace(/[\r\n]+/g, ' '); };
    var plain = function () { return ['Subscribe to ' + name + ' (' + list + ')', 'Email: ' + one(field('email'))].join('\n'); };

    function eml(email) {
      var id = 'sgit-subscribe-' + Date.now() + '-' + Math.random().toString(16).slice(2, 10) + '@newsroom.sgit.ai';
      var hdr = [
        'From: web form <site@newsroom.sgit.ai>',
        'To: subscribe <subscribe@sgit.ai>',
        'Subject: Subscribe: ' + one(name),
        'Date: ' + new Date().toUTCString(),
        'Message-ID: <' + id + '>',
        'X-EmailFS-Kind: notification',
        'X-SGit-Form: subscribe',
        'X-SGit-List: ' + one(list),
        'X-SGit-Reply-To: ' + one(email),
        'X-SGit-Page: ' + one(location.pathname),
        'Content-Type: text/plain; charset=utf-8'
      ];
      var body = plain() + '\n\nConsent: yes, keep this address in the subscribe vault and send ' + one(name) + "'s release notes by email"
        + '\nSent from: ' + location.href + '\n';
      return hdr.join('\r\n') + '\r\n\r\n' + body.replace(/\r?\n/g, '\r\n');
    }
    function mailtoFallback(why) {
      mailto.href = 'mailto:agent@riskmandate.ai?subject=' + encodeURIComponent('Subscribe: ' + name) + '&body=' + encodeURIComponent(plain() + '\n');
      mailto.hidden = false;
      why = String(why || '');
      if (/failed to fetch|networkerror|load failed/i.test(why)) why = 'The vault host could not be reached.';
      say((why ? why.replace(/\.?$/, '.') + ' ' : '') + 'The same request is ready as an ordinary email instead: press the link and send it from your own mail client.', 'warn');
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (field('website')) { say('Subscribed.', 'ok'); return; }                 // honeypot
      var email = field('email');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say('Please give an email address the release notes can be sent to.', 'warn'); form.elements.email.focus(); return; }
      if (!form.elements.consent.checked) { say('Please tick the box: it is your permission to keep this address and email you.', 'warn'); return; }
      button.disabled = true; say('Fetching the key and encrypting…');
      try {
        if (!window.crypto || !crypto.subtle) throw new Error('This browser cannot encrypt here.');
        var r = await fetch(root + '.well-known/sgit-subscribe.json', { cache: 'no-store' });
        if (!r.ok) throw new Error('The contact file did not load (' + r.status + ').');
        var file = await r.json();
        var inbox = file.inbox, lane = inbox && inbox.lane;
        if (!file.recipient || !inbox || !lane || inbox.status !== 'open') throw new Error('The subscribe inbox is not open.');
        var fp = await fingerprint(file.recipient.encrypt);
        if (fp !== file.recipient.fingerprint || fp !== inbox.encrypt_to) throw new Error('The key in the contact file does not match its fingerprint.');
        var env = await encrypt(file.recipient.encrypt, eml(email));
        say('Encrypted to ' + fp + '. Sending into the vault…');
        var w = await fetch(inbox.endpoint + '/api/vault/append/write/' + inbox.vault, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ append_token: lane.append_token, payload: env.payload })
        });
        var j = null; try { j = await w.json(); } catch (_) {}
        if (!w.ok || !j || j.ok !== true) throw new Error('The vault host answered ' + w.status + '.');
        form.hidden = true;
        var done = box.querySelector('.sub-done'); if (done) done.hidden = false;
        say('', 'ok');
      } catch (err) {
        button.disabled = false;
        mailtoFallback(String(err && err.message || err));
      }
    });
  });
}());
