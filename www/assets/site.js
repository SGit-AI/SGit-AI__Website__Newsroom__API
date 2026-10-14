/* api.newsroom.sgit.ai: the menu at phone width, copy buttons on code, and the map drawn as a layered graph. No dependencies. */
(function () {
  'use strict'
  // the menu
  var menu = document.querySelector('.menu'), nav = document.getElementById('nav')
  if (menu && nav) menu.addEventListener('click', function () {
    var open = nav.classList.toggle('open'); menu.setAttribute('aria-expanded', String(open))
  })
  // copy
  document.querySelectorAll('pre.code .copy').forEach(function (b) {
    b.addEventListener('click', function () {
      var code = b.parentNode.querySelector('code'); var text = code ? code.textContent : ''
      var done = function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy' }, 1400) }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done)
      else { var r = document.createRange(); r.selectNodeContents(code); var s = getSelection(); s.removeAllRanges(); s.addRange(r); try { document.execCommand('copy') } catch (e) {} s.removeAllRanges(); done() }
    })
  })
  // the graph
  var host = document.getElementById('map-graph')
  if (!host) return
  fetch(host.getAttribute('data-src')).then(function (r) { return r.json() }).then(draw).catch(function (e) {
    host.insertAdjacentHTML('beforeend', '<p class="dim" style="padding:1rem">The graph could not be drawn: ' + String(e.message || e) + '</p>')
  })
  function draw(g) {
    var layers = g.layers, byLayer = layers.map(function () { return [] })
    g.nodes.forEach(function (n) { byLayer[n.layer].push(n) })
    var colW = 215, rowH = 22, pad = 40, top = 44
    var maxRows = Math.max.apply(null, byLayer.map(function (l) { return l.length }))
    var W = pad * 2 + colW * layers.length, H = top + Math.max(400, maxRows * rowH + 40)
    var pos = {}
    byLayer.forEach(function (list, li) {
      var step = Math.max(rowH, (H - top - 20) / Math.max(1, list.length))
      list.forEach(function (n, i) { pos[n.id] = { x: pad + li * colW, y: top + i * step + 10, n: n } })
    })
    var svgNS = 'http://www.w3.org/2000/svg'
    var svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('width', W); svg.setAttribute('height', H)
    function el(tag, attrs, parent) { var e = document.createElementNS(svgNS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e }
    layers.forEach(function (name, li) { var t = el('text', { x: pad + li * colW, y: 22, class: 'layer' }); t.textContent = name })
    var edgeEls = []
    g.edges.forEach(function (e) {
      var a = pos[e[0]], b = pos[e[1]]; if (!a || !b) return
      var x1 = a.x + 170, y1 = a.y + 8, x2 = b.x, y2 = b.y + 8, mx = (x1 + x2) / 2
      var p = el('path', { d: 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2, class: 'e' })
      p.dataset.from = e[0]; p.dataset.to = e[1]; edgeEls.push(p)
    })
    var tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; host.appendChild(tip)
    var nodeEls = {}
    g.nodes.forEach(function (n) {
      var p = pos[n.id]; var grp = el('g', { class: 'n kind-' + n.kind, transform: 'translate(' + p.x + ',' + p.y + ')' })
      el('rect', { width: 170, height: 16, rx: 4 }, grp)
      var t = el('text', { x: 6, y: 12 }, grp); var label = n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label; t.textContent = label
      nodeEls[n.id] = grp
      var what = n.what || n.text || n.shape || ''
      grp.addEventListener('mouseenter', function (ev) { light(n.id); show(n, what, ev) })
      grp.addEventListener('mousemove', function (ev) { move(ev) })
      grp.addEventListener('mouseleave', function () { unlight(); tip.hidden = true })
      grp.addEventListener('click', function (ev) { light(n.id); show(n, what, ev); if (n.kind === 'finding' && n.issue) window.open('https://github.com/SGit-AI/SGit-AI__Website__Newsroom__API/issues/' + n.issue, '_blank') })
    })
    function neighbours(id) { var s = {}; s[id] = 1; g.edges.forEach(function (e) { if (e[0] === id) s[e[1]] = 1; if (e[1] === id) s[e[0]] = 1 }); return s }
    function light(id) {
      var s = neighbours(id)
      Object.keys(nodeEls).forEach(function (k) { nodeEls[k].classList.toggle('dimmed', !s[k]) })
      edgeEls.forEach(function (p) { p.classList.toggle('lit', p.dataset.from === id || p.dataset.to === id) })
    }
    function unlight() { Object.keys(nodeEls).forEach(function (k) { nodeEls[k].classList.remove('dimmed') }); edgeEls.forEach(function (p) { p.classList.remove('lit') }) }
    function show(n, what, ev) {
      var extra = n.kind === 'file' ? ' · ' + n.lines + ' lines · ' + n.path : n.kind === 'finding' ? ' · ' + n.severity + (n.issue ? ' · issue ' + n.issue : '') : n.kind === 'contract' ? ' · ' + n.owner : ''
      tip.innerHTML = '<b>' + esc(n.label) + '</b>' + esc(what) + '<span class="dim">' + esc(extra) + '</span>'
      tip.hidden = false; move(ev)
    }
    function move(ev) { var r = host.getBoundingClientRect(); tip.style.left = Math.min(ev.clientX - r.left + host.scrollLeft + 14, host.scrollWidth - 380) + 'px'; tip.style.top = (ev.clientY - r.top + host.scrollTop + 14) + 'px' }
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] }) }
    host.insertBefore(svg, host.firstChild)
  }
}())
