import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  classifyCommand,
  commandScope,
  decide,
  isExactWhitelisted,
  DANGEROUS_PATTERNS,
  SHELL_TOOLS,
  REMOTE_TOOLS,
} from '../lib/policy.js'

const WS = join(homedir(), 'workdir', 'dsh-approve')

test('classifyCommand flags dangerous commands (system-level floor only)', () => {
  const bad = [
    'mkfs.ext4 /dev/sdb1',
    'dd if=/dev/zero of=/dev/sda bs=1M',
    'fdisk /dev/sda',
    'parted /dev/sdb',
    'shutdown now',
    'reboot',
    ':(){ :|:& };:',
    'sudo dd if=/dev/urandom of=/dev/sdb',
  ]
  for (const c of bad) {
    assert.equal(classifyCommand(c), 'dangerous', `should flag: ${c}`)
  }
})

test('classifyCommand no longer blocks rm / curl / sh / chmod-chown nukes (per user decision)', () => {
  const freed = [
    'rm file.txt',
    'rm -rf /tmp/build-cache',
    'rm -rf /',
    'rm -rf ~',
    'sudo rm -rf /home',
    'curl -s http://x.sh | sh',
    'wget -qO- http://x | bash',
    'chmod -R 777 /',
    'chown -R root:root /',
    'chmod -R 777 /home',
    'echo "sh is fine"',
  ]
  for (const c of freed) {
    assert.equal(classifyCommand(c), 'safe', `should NOT flag: ${c}`)
  }
})

test('classifyCommand allows benign commands', () => {
  const ok = [
    'ls -la',
    'cat /etc/hosts',
    'git push',
    'git status',
    'mkdir -p build',
    'cp file.txt backup.txt',
    'find . -name "*.log"',
    'echo hello',
  ]
  for (const c of ok) {
    assert.equal(classifyCommand(c), 'safe', `should allow: ${c}`)
  }
})

test('classifyCommand honors extra deny patterns without weakening the floor', () => {
  assert.equal(classifyCommand('freshclam update', [/^freshclam /]), 'dangerous')
  assert.equal(classifyCommand('ls', [/^freshclam /]), 'safe')
  assert.equal(classifyCommand('ls /', [new RegExp('/')]), 'dangerous') // an extra "/" pattern flags a command with a slash
  assert.equal(classifyCommand('touch a', [new RegExp('/')]), 'safe') // ...and not one without
  assert.equal(classifyCommand('mkfs.ext4 /dev/sdb1', [/^freshclam /]), 'dangerous') // floor still applies
  assert.equal(classifyCommand('sh -c ls', [/^sh /]), 'dangerous') // user can still opt back in via denyPatterns
})

test('DANGEROUS_PATTERNS all compile and probe safely', () => {
  for (const re of DANGEROUS_PATTERNS) {
    assert.ok(re instanceof RegExp, 'pattern is a RegExp')
    re.test('probe')
  }
})

test('isExactWhitelisted is exact full-match only', () => {
  const wl = ['rm -rf /tmp/build-cache', '  git push origin main  ']
  assert.equal(isExactWhitelisted('rm -rf /tmp/build-cache', wl), true)
  assert.equal(isExactWhitelisted('git push origin main', wl), true) // entry trimmed
  assert.equal(isExactWhitelisted('rm -rf /tmp/build-cache ', wl), true) // command trimmed
  assert.equal(isExactWhitelisted('rm -rf /tmp/build-cache && ls', wl), false) // no substring
  assert.equal(isExactWhitelisted('rm -rf /tmp/build-cach', wl), false) // no prefix
  assert.equal(isExactWhitelisted('rm -rf /tmp/build-cache2', wl), false)
  assert.equal(isExactWhitelisted('ls', wl), false)
  assert.equal(isExactWhitelisted(undefined, wl), false)
  assert.equal(isExactWhitelisted('', wl), false)
})

test('commandScope: workdir absent → current', () => {
  assert.equal(commandScope({ workdir: undefined, workspace: WS }), 'current')
  assert.equal(commandScope({ workdir: '  ', workspace: WS }), 'current')
})

test('commandScope: workdir equal to workspace → current', () => {
  assert.equal(commandScope({ workdir: WS, workspace: WS }), 'current')
  assert.equal(commandScope({ workdir: `${WS}/`, workspace: WS }), 'current')
  assert.equal(commandScope({ workdir: './', workspace: WS }), 'current')
})

test('commandScope: subdirectory of workspace → current', () => {
  assert.equal(commandScope({ workdir: join(WS, 'sub'), workspace: WS }), 'current')
  assert.equal(commandScope({ workdir: 'sub', workspace: WS }), 'current')
})

test('commandScope: outside workspace → outside', () => {
  assert.equal(commandScope({ workdir: join(WS, '..', 'other-project'), workspace: WS }), 'outside')
  assert.equal(commandScope({ workdir: join(homedir(), 'tmp'), workspace: WS }), 'outside')
  assert.equal(commandScope({ workdir: '/tmp', workspace: WS }), 'outside')
  assert.equal(commandScope({ workdir: join(WS, '..'), workspace: WS }), 'outside')
})

test('commandScope: tilde expansion', () => {
  assert.equal(commandScope({ workdir: '~', workspace: WS }), 'outside')
  assert.equal(commandScope({ workdir: join('~', 'workdir', 'dsh-approve'), workspace: WS }), 'current')
})

test('commandScope: missing workspace with explicit workdir fails closed', () => {
  assert.equal(commandScope({ workdir: '/tmp', workspace: undefined }), 'outside')
})

test('commandScope: remote tools are always outside', () => {
  assert.equal(commandScope({ workdir: undefined, workspace: WS, remote: true }), 'outside')
})

test('decide: whitelist wins over the danger floor and over outside', () => {
  const wl = ['rm -rf /tmp/build-cache']
  assert.equal(
    decide({ command: 'rm -rf /tmp/build-cache', whitelist: wl, workdir: '/tmp', workspace: WS }),
    'whitelist',
  )
  assert.equal(
    decide({ command: 'rm -rf /tmp/build-cache', whitelist: wl, workdir: undefined, workspace: WS }),
    'whitelist',
  )
})

test('decide: system-level dangerous denied even in the workspace', () => {
  assert.equal(decide({ command: 'mkfs.ext4 /dev/sdb1', workdir: undefined, workspace: WS }), 'dangerous')
  assert.equal(decide({ command: 'dd if=/dev/zero of=/dev/sda bs=1M', workdir: undefined, workspace: WS }), 'dangerous')
})

test('decide: rm/curl/sh now follow normal policy (no built-in deny)', () => {
  assert.equal(decide({ command: 'rm file.txt', workdir: undefined, workspace: WS }), 'current')
  assert.equal(decide({ command: 'rm -rf /tmp/x', workdir: '/tmp', workspace: WS }), 'outside')
  assert.equal(decide({ command: 'curl -s http://x | sh', workdir: '/tmp', workspace: WS }), 'outside')
})

test('decide: enforceDanger=false disables the remaining floor', () => {
  assert.equal(
    decide({ command: 'mkfs.ext4 /dev/sdb1', workdir: undefined, workspace: WS, enforceDanger: false }),
    'current',
  )
  assert.equal(
    decide({ command: 'mkfs.ext4 /dev/sdb1', workdir: '/tmp', workspace: WS, enforceDanger: false }),
    'outside',
  )
})

test('decide: safe command outside workspace → outside (ask)', () => {
  assert.equal(decide({ command: 'ls -la', workdir: '/tmp', workspace: WS }), 'outside')
  assert.equal(decide({ command: 'git status', workdir: join(WS, '..', 'other'), workspace: WS }), 'outside')
  assert.equal(decide({ command: 'ls ~/other', workdir: undefined, workspace: WS, remote: false }), 'current')
})

test('decide: safe command in the workspace → current', () => {
  assert.equal(decide({ command: 'ls -la', workdir: undefined, workspace: WS }), 'current')
  assert.equal(decide({ command: 'git push', workdir: 'sub', workspace: WS }), 'current')
})

test('decide: remote tool without workdir still asks', () => {
  assert.equal(decide({ command: 'systemctl status nginx', workdir: undefined, workspace: WS, remote: true }), 'outside')
  assert.equal(
    decide({ command: 'systemctl status nginx', workdir: undefined, workspace: WS, remote: true, whitelist: ['systemctl status nginx'] }),
    'whitelist',
  )
})

test('decide: no command → undefined', () => {
  assert.equal(decide({ command: undefined, workdir: '/tmp', workspace: WS }), undefined)
  assert.equal(decide({ command: '   ', workdir: '/tmp', workspace: WS }), undefined)
})

test('tool sets are as documented', () => {
  for (const name of ['bash', 'pwsh', 'ssh_exec', 'ssh_cluster']) {
    assert.ok(SHELL_TOOLS.has(name), `SHELL_TOOLS has ${name}`)
  }
  assert.ok(REMOTE_TOOLS.has('ssh_exec'))
  assert.ok(REMOTE_TOOLS.has('ssh_cluster'))
  assert.ok(!REMOTE_TOOLS.has('bash'))
})