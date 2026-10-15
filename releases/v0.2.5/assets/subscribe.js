// subscribe.js — the "subscribe to the newsletter" form.
//
// What the reader types is encrypted in this browser to the public key of the agent that
// manages the list (sgit's hybrid envelope v2, built with Web Crypto: a fresh AES-256-GCM key,
// wrapped with RSA-OAEP to the agent's 4096-bit key), then dropped into the write-only
// `subscribe` append lane of the subscribe vault. The vault host sees ciphertext, a size and a
// time. Nothing is stored on this site. If any step fails the same text is offered as an
// ordinary email to the same agent, so a subscribe request is never lost to a script error.
//
// The contact details (vault id, lane token, public key, fingerprint) are public on purpose and
// live in /.well-known/sgit-subscribe.json; the briefing for the agent that drains the lane is
// /docs/briefs/subscribe-lane-agent-brief.html. The only secret is the vault key, and it is not on this site.
//
// Matches sgit_ai/crypto/PKI__Crypto.hybrid_encrypt and the contact form on riskmandate.ai:
// {v:2, w, i, c} as base64 fields; the .enc text is base64 of that JSON; the lane payload is
// base64 of the .enc text's bytes (encoded twice, as the append-lanes API page documents).
// Unsigned: a person filling in a form holds no key, so the drain files it as a web-form kind.
(function () {
  'use strict';
  var forms = document.querySelectorAll('form[data-subscribe]');
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
    var enc = btoa(JSON.stringify({ v: 2, w: b64(w), i: b64(iv), c: b64(c) }));   // the .enc text
    return { enc: enc, payload: btoa(enc) };                                         // payload = base64(bytes of .enc)
  }

  Array.prototype.forEach.call(forms, function (form) {
    var status = form.querySelector('.sub-status');
    var button = form.querySelector('button[type="submit"]');
    var mailto = form.querySelector('.sub-mailto');
    var box = form.closest('.subscribe');
    var say = function (text, cls) { status.textContent = text; status.className = 'sub-status' + (cls ? ' ' + cls : ''); };
    var field = function (n) { var el = form.elements[n]; return el ? String(el.value || '').trim() : ''; };
    var one = function (s) { return s.replace(/[\r\n]+/g, ' '); };
    var plain = function () {
      var lines = ['Subscribe to the SGit Newsroom newsletter', 'Email: ' + one(field('email'))];
      if (field('name')) lines.push('Name: ' + one(field('name')));
      return lines.join('\n');
    };

    function eml(email) {
      var id = 'sgit-subscribe-' + Date.now() + '-' + Math.random().toString(16).slice(2, 10) + '@sgit.ai';
      var hdr = [
        'From: web form <site@sgit.ai>',
        'To: subscribe <subscribe@sgit.ai>',
        'Subject: Subscribe: SGit Newsroom newsletter',
        'Date: ' + new Date().toUTCString(),
        'Message-ID: <' + id + '>',
        'X-EmailFS-Kind: notification',
        'X-SGit-Form: subscribe',
        'X-SGit-Reply-To: ' + one(email),
        'X-SGit-Page: ' + one(location.pathname),
        'Content-Type: text/plain; charset=utf-8'
      ];
      var body = plain() + '\n\nConsent: yes, keep this address in the subscribe vault and send the SGit Newsroom newsletter by email'
        + '\nSent from: ' + location.href + '\n';
      return hdr.join('\r\n') + '\r\n\r\n' + body.replace(/\r?\n/g, '\r\n');
    }

    function mailtoFallback(why) {
      mailto.href = 'mailto:agent@riskmandate.ai?subject=' + encodeURIComponent('Subscribe: SGit Newsroom newsletter')
        + '&body=' + encodeURIComponent(plain() + '\n');
      mailto.hidden = false;
      why = String(why || '');
      if (/failed to fetch|networkerror|load failed/i.test(why)) why = 'The vault host could not be reached.';
      say((why ? why.replace(/\.?$/, '.') + ' ' : '') + 'The same request is ready as an ordinary email instead: press the link and send it from your own mail client.', 'warn');
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (field('website')) { say('Subscribed.', 'ok'); return; }                 // honeypot: bots fill it, people never see it
      var email = field('email');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say('Please give an email address the newsletter can be sent to.', 'warn'); form.elements.email.focus(); return; }
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
