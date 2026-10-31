// 校验：WXSS 花括号配对、孤立声明行；WXML 标签配对
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..', 'miniprogram')
function walk(d, o = []) { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); fs.statSync(p).isDirectory() ? walk(p, o) : o.push(p) } return o }
let bad = 0
for (const f of walk(root)) {
  const rel = path.relative(root, f)
  const s = fs.readFileSync(f, 'utf8')
  if (f.endsWith('.wxss')) {
    const t = s.replace(/\/\*[\s\S]*?\*\//g, '')
    let depth = 0
    t.split(/\r?\n/).forEach((line, i) => {
      for (const ch of line) { if (ch === '{') depth++; if (ch === '}') depth-- }
      if (depth < 0 || depth > 1) { console.log('WXSS', rel, i + 1, line.slice(0, 80)); bad++; depth = Math.max(0, Math.min(1, depth)) }
      if (depth === 0 && /^\s*[a-z-]+\s*:/.test(line) && !/^\s*[.#:@a-z]/.test(line.replace(/^\s*[a-z-]+\s*:\s*(hover|active|host|last-child|first-child)/, '.'))) { console.log('ORPHAN', rel, i + 1); bad++ }
    })
    if (depth !== 0) { console.log('WXSS unclosed', rel); bad++ }
  } else if (f.endsWith('.wxml')) {
    const t = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<wxs[\s\S]*?(\/>|<\/wxs>)/g, '')
    const stack = []
    const re = /<(\/?)([a-zA-Z-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
    let m
    while ((m = re.exec(t))) {
      const [, close, tag, , self] = m
      if (self) continue
      if (close) { const top = stack.pop(); if (top !== tag) { console.log('WXML', rel, 'expected </' + top + '> got </' + tag + '>'); bad++; break } }
      else stack.push(tag)
    }
    if (stack.length) { console.log('WXML unclosed', rel, stack.join(',')); bad++ }
    const lines = s.split(/\r?\n/)
    lines.forEach((l, i) => { if (/^\s*\{\{[^}]*\}\}[^<]*"\s*\/?>\s*$/.test(l)) { console.log('WXML fragment', rel, i + 1); bad++ } })
  }
}
console.log(bad ? 'PROBLEMS: ' + bad : 'ALL OK')
