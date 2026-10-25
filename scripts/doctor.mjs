#!/usr/bin/env node
/**
 * 只读体检：报告插件是否安装一致、播报是否还在产出、最近一次启动是否失败。
 *
 * 用法：node scripts/doctor.mjs
 * 只读取，不写任何文件；任何一步读不到都只记一行 FAIL/SKIP，不抛错。
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const home = homedir()
const profile = join(home, '.dsh', 'profiles', 'desktop')
const source = process.cwd()
// 包名从自身 package.json 读取，改一次名字不用再改脚本。
const SELF_NAME = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).name
const installed = join(profile, 'node_modules', SELF_NAME)
const rows = []
const line = (status, label, detail = '') => rows.push({ status, label, detail })

const digest = (file) => createHash('md5').update(readFileSync(file)).digest('hex')

// 1) 已安装版本与文件一致性
try {
  const pkg = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  line('OK', 'installed version', pkg.version)
  // 只比对运行时文件；package.json 的元数据（scripts 等）故意不同步，
  // 因为往运行中的 profile 目录写文件会触发 HMR 重载并可能让客户端 bundle 加载失败。
  for (const file of ['index.js', 'client.js']) {
    const a = digest(join(source, file))
    const b = digest(join(installed, file))
    line(a === b ? 'OK' : 'DIFF', 'file ' + file, a === b ? 'matches source' : a.slice(0, 8) + ' vs ' + b.slice(0, 8))
  }
} catch (error) {
  line('FAIL', 'installed copy', String(error.message))
}

// 2) 是否在 bundles 列表里
try {
  const pkg = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  const bundles = pkg?.dsh?.profile?.bundles ?? []
  line(bundles.includes(SELF_NAME) ? 'OK' : 'FAIL', 'bundle entry', bundles.includes(SELF_NAME) ? 'registered' : 'missing from dsh.profile.bundles')
} catch (error) {
  line('FAIL', 'profile package.json', String(error.message))
}

// 3) 播报是否还在产出（宿主调试日志的最后一次 publish）
try {
  const log = join(home, '.dsh', 'progress-summary-debug.log')
  const text = readFileSync(log, 'utf8')
  const publishes = text.split('\n').filter((row) => row.includes('publish record'))
  const last = publishes[publishes.length - 1] || '(none)'
  line(publishes.length > 0 ? 'OK' : 'FAIL', 'narrator publishes', last.slice(0, 140))
} catch (error) {
  line('SKIP', 'narrator log', String(error.message))
}

// 4) 最近一次会话投影里累计多少条（取最近修改的缓存文件）
try {
  const dir = join(home, '.dsh', 'storages', 'session_projcache', 'sessions')
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'))
    .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
  for (const file of files.slice(0, 3)) {
    const data = JSON.parse(readFileSync(join(dir, file.name), 'utf8'))
    const value = data?.record?.rows?.progressHistory?.val ?? {}
    const count = Array.isArray(value.lines) ? value.lines.length : 0
    line(count > 0 ? 'OK' : 'SKIP', 'session ' + file.name.slice(8, 16), count + ' lines')
  }
} catch (error) {
  line('SKIP', 'projection cache', String(error.message))
}

// 5) 最近的启动失败记录里是否点名本插件
try {
  const dir = join(home, 'AppData', 'Roaming', '@deepseek-ai', 'dsh-desktop', 'logs')
  if (existsSync(dir)) {
    const logs = readdirSync(dir).filter((name) => name.includes('web-boot'))
      .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
    const newest = logs[0]
    if (newest) {
      const text = readFileSync(join(dir, newest.name), 'utf8')
      const blamed = text.includes(SELF_NAME) || text.includes('progress-history')
      const ageMinutes = Math.round((Date.now() - newest.at) / 60000)
      // 旧记录只是历史：只有最近 10 分钟内的启动失败才值得警告。
      const status = blamed ? (ageMinutes <= 10 ? 'WARN' : 'HIST') : 'OK'
      line(status, 'newest boot log', newest.name + ' (' + ageMinutes + ' min ago)' + (blamed ? ' -> blames this plugin' : ' -> no mention'))
    } else {
      line('OK', 'newest boot log', 'none')
    }
  }
} catch (error) {
  line('SKIP', 'boot logs', String(error.message))
}

const width = Math.max(...rows.map((row) => row.label.length))
for (const row of rows) {
  console.log(row.status.padEnd(5) + row.label.padEnd(width + 2) + row.detail)
}
const failed = rows.filter((row) => row.status === 'FAIL').length
console.log('\n' + (failed === 0 ? 'VERDICT: healthy' : 'VERDICT: ' + failed + ' failing check(s)'))
process.exitCode = failed === 0 ? 0 : 1
